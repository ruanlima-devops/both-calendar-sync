import { mapOAuthError } from '../crypto/tokens.ts';
import { googleDateToNormalized } from '../sync/dates.ts';
import { isSyncTokenInvalid } from '../sync/engine.ts';
import { buildUnifyPrivateProps, optionalUuidOrUndefined } from '../sync/metadata.ts';
import { attachRecurringKind } from '../sync/recurring.ts';
import { googleIdempotentEventId, providerFetch, type ProviderOperation, type RetrySafety } from './http-retry.ts';
import {
  UNIFY_PROP_GROUP,
  UNIFY_PROP_ROLE,
  type CalendarInfo,
  type CalendarProvider,
  type CreateEventInput,
  type NormalizedEvent,
  type SyncPage,
  type WatchInfo,
} from '../sync/types.ts';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
].join(' ');

export function parseGoogleEvent(raw: Record<string, unknown>, fallbackTz: string): NormalizedEvent {
  const start = raw.start as { date?: string; dateTime?: string; timeZone?: string } | undefined;
  const end = raw.end as { date?: string; dateTime?: string; timeZone?: string } | undefined;
  const range = googleDateToNormalized(start, end, fallbackTz);
  const privateProps =
    ((raw.extendedProperties as { private?: Record<string, string> } | undefined)?.private) ?? {};
  const status = raw.status === 'cancelled' ? 'cancelled' : raw.status === 'tentative' ? 'tentative' : 'confirmed';
  const rec = raw.recurrence as string[] | undefined;
  return attachRecurringKind({
    providerEventId: String(raw.id ?? ''),
    title: String(raw.summary ?? '(sem título)'),
    description: raw.description ? String(raw.description) : undefined,
    location: raw.location ? String(raw.location) : undefined,
    ...range,
    status,
    etag: raw.etag ? String(raw.etag) : undefined,
    updatedAt: raw.updated ? String(raw.updated) : undefined,
    recurrenceRule: rec?.[0],
    recurringEventId: raw.recurringEventId ? String(raw.recurringEventId) : undefined,
    unifySyncGroupId: optionalUuidOrUndefined(privateProps[UNIFY_PROP_GROUP]),
    unifyEventRole: privateProps[UNIFY_PROP_ROLE] as NormalizedEvent['unifyEventRole'],
    isDeleted: status === 'cancelled',
    busyTransparency: raw.transparency ? String(raw.transparency) : 'opaque',
  });
}

export class GoogleCalendarProvider implements CalendarProvider {
  name = 'GOOGLE' as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  getAuthorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string {
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${AUTH}?${p.toString()}`;
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }) {
    const res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw Object.assign(new Error(body.error ?? 'google_exchange_failed'), {
        status: mapOAuthError(res.status, body.error),
      });
    }
    const profile = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${body.access_token}` },
    }).then((r) => r.json());
    return {
      accessToken: body.access_token as string,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
      expiresAt: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString(),
      accountId: String(profile.id ?? profile.email),
      accountEmail: String(profile.email ?? ''),
    };
  }

  async refreshAccessToken(refreshToken: string) {
    const res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw Object.assign(new Error(body.error ?? 'google_refresh_failed'), {
        status: mapOAuthError(res.status, body.error),
      });
    }
    return {
      accessToken: body.access_token as string,
      refreshToken: body.refresh_token as string | undefined,
      expiresAt: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString(),
    };
  }

  async listCalendars(accessToken: string): Promise<CalendarInfo[]> {
    const res = await gfetch(`${API}/users/me/calendarList?maxResults=250`, accessToken, {
      operation: 'list_calendars',
      safety: 'read',
    });
    const items = (res.items ?? []) as Array<Record<string, unknown>>;
    return items.map((c) => ({
      providerCalendarId: String(c.id),
      name: String(c.summary ?? c.id),
      color: String(c.backgroundColor ?? '#2563eb'),
      timezone: c.timeZone ? String(c.timeZone) : undefined,
      isPrimary: Boolean(c.primary),
      accessRole: String(c.accessRole ?? 'reader'),
    }));
  }

  async initialSync(
    accessToken: string,
    calendarId: string,
    pageToken?: string,
    range?: { timeMin: string; timeMax: string },
  ): Promise<SyncPage> {
    const params = new URLSearchParams({
      maxResults: '250',
      showDeleted: 'true',
      singleEvents: 'true',
    });
    if (range?.timeMin) params.set('timeMin', range.timeMin);
    if (range?.timeMax) params.set('timeMax', range.timeMax);
    if (pageToken) params.set('pageToken', pageToken);
    return this.listEvents(accessToken, calendarId, params);
  }

  async incrementalSync(
    accessToken: string,
    calendarId: string,
    token: string,
    pageToken?: string,
  ): Promise<SyncPage> {
    const params = new URLSearchParams({
      showDeleted: 'true',
      singleEvents: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    else params.set('syncToken', token);
    try {
      return await this.listEvents(accessToken, calendarId, params);
    } catch (err) {
      const status = (err as { httpStatus?: number }).httpStatus ?? 0;
      if (isSyncTokenInvalid(status, String(err))) {
        return { events: [], needsFullResync: true };
      }
      throw err;
    }
  }

  async createEvent(accessToken: string, calendarId: string, input: CreateEventInput) {
    const body = toGoogleBody(input);
    // Ensure a stable Calendar insert id so transient retries cannot duplicate events.
    if (!body.id) body.id = googleIdempotentEventId();
    const eventId = String(body.id);
    try {
      const res = await gfetch(`${API}/calendars/${encodeURIComponent(calendarId)}/events`, accessToken, {
        method: 'POST',
        body: JSON.stringify(body),
        operation: 'create_event',
        safety: 'idempotent_write',
      });
      return { providerEventId: String(res.id), etag: res.etag ? String(res.etag) : undefined };
    } catch (err) {
      // Lost response after success → retry hits 409 for the same insert id; treat as idempotent success.
      if ((err as { httpStatus?: number }).httpStatus === 409) {
        const existing = await gfetch(
          `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
          accessToken,
          { operation: 'list_events', safety: 'read' },
        );
        return { providerEventId: String(existing.id ?? eventId), etag: existing.etag ? String(existing.etag) : undefined };
      }
      throw err;
    }
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    providerEventId: string,
    input: Partial<CreateEventInput> & { startAt: string; endAt: string; allDay: boolean; timezone: string },
  ) {
    await gfetch(
      `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(providerEventId)}`,
      accessToken,
      {
        method: 'PATCH',
        body: JSON.stringify(toGoogleBody(input as CreateEventInput)),
        operation: 'update_event',
        safety: 'idempotent_write',
      },
    );
  }

  async deleteEvent(accessToken: string, calendarId: string, providerEventId: string) {
    await gfetch(
      `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(providerEventId)}`,
      accessToken,
      { method: 'DELETE', allowEmpty: true, notFoundOk: true, operation: 'delete_event', safety: 'idempotent_write' },
    );
  }

  async createWebhookSubscription(
    accessToken: string,
    calendarId: string,
    webhookUrl: string,
    clientState?: string,
  ): Promise<WatchInfo> {
    const id = crypto.randomUUID();
    const expiration = Date.now() + 6 * 24 * 60 * 60 * 1000;
    const res = await gfetch(
      `${API}/calendars/${encodeURIComponent(calendarId)}/events/watch`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          id,
          type: 'web_hook',
          address: webhookUrl,
          expiration: String(expiration),
          ...(clientState ? { token: clientState } : {}),
        }),
        operation: 'watch_create',
        // Same channel id across local retries; only rate-limit retries (see subscription_create).
        safety: 'subscription_create',
      },
    );
    return {
      externalSubscriptionId: String(res.id),
      externalResourceId: res.resourceId ? String(res.resourceId) : undefined,
      expiresAt: res.expiration
        ? new Date(Number(res.expiration)).toISOString()
        : new Date(expiration).toISOString(),
    };
  }

  async renewWebhookSubscription(
    accessToken: string,
    subscription: WatchInfo,
    webhookUrl: string,
    calendarId?: string,
  ): Promise<WatchInfo> {
    if (calendarId) {
      try {
        await this.deleteWebhookSubscription(accessToken, subscription);
      } catch {
        /* expired channels can 404 */
      }
      return this.createWebhookSubscription(accessToken, calendarId, webhookUrl);
    }
    return this.createWebhookSubscription(accessToken, 'primary', webhookUrl);
  }

  async deleteWebhookSubscription(accessToken: string, subscription: WatchInfo): Promise<void> {
    await gfetch(`${API}/channels/stop`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        id: subscription.externalSubscriptionId,
        resourceId: subscription.externalResourceId,
      }),
      allowEmpty: true,
      notFoundOk: true,
      operation: 'watch_stop',
      safety: 'idempotent_write',
    });
  }

  private async listEvents(accessToken: string, calendarId: string, params: URLSearchParams): Promise<SyncPage> {
    const url = `${API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
    const res = await gfetch(url, accessToken, { operation: 'list_events', safety: 'read' });
    const items = (res.items ?? []) as Array<Record<string, unknown>>;
    const tz = String(res.timeZone ?? 'UTC');
    return {
      events: items.filter((i) => i.id).map((i) => parseGoogleEvent(i, tz)),
      nextSyncToken: res.nextSyncToken ? String(res.nextSyncToken) : undefined,
      nextPageToken: res.nextPageToken ? String(res.nextPageToken) : undefined,
    };
  }
}

export function toGoogleBody(input: CreateEventInput): Record<string, unknown> {
  const startDay = input.startAt.slice(0, 10);
  let endDay = input.endAt.slice(0, 10);
  // Google all-day end is exclusive; ensure at least one day span.
  if (input.allDay && endDay <= startDay) {
    const next = new Date(`${startDay}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    endDay = next.toISOString().slice(0, 10);
  }
  const startEnd = input.allDay
    ? {
        start: { date: startDay },
        end: { date: endDay },
      }
    : {
        start: { dateTime: input.startAt, timeZone: input.timezone },
        end: { dateTime: input.endAt, timeZone: input.timezone },
      };
  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.description,
    location: input.location,
    ...startEnd,
    transparency: 'opaque',
    visibility: input.role === 'MIRROR' ? 'private' : undefined,
    extendedProperties: {
      private: buildUnifyPrivateProps({ syncGroupId: input.syncGroupId, role: input.role }),
    },
  };
  if (input.clientEventId && /^[a-v0-9]{5,1024}$/.test(input.clientEventId)) {
    body.id = input.clientEventId;
  }
  if (input.attendees?.length) {
    body.attendees = input.attendees.map((a) => ({
      email: a.email,
      displayName: a.displayName,
    }));
  }
  return body;
}

async function gfetch(
  url: string,
  accessToken: string,
  init: RequestInit & {
    allowEmpty?: boolean;
    notFoundOk?: boolean;
    operation: ProviderOperation;
    safety: RetrySafety;
  },
): Promise<Record<string, unknown>> {
  const { allowEmpty, notFoundOk, operation, safety, ...rest } = init;
  try {
    const result = await providerFetch({
      provider: 'GOOGLE',
      operation,
      safety,
      url,
      allowEmpty,
      notFoundOk,
      init: {
        ...rest,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(rest.headers ?? {}),
        },
      },
    });
    return result.body;
  } catch (err) {
    const status = (err as { httpStatus?: number }).httpStatus;
    if (status != null) (err as { httpStatus?: number }).httpStatus = status;
    throw err;
  }
}
