import { mapOAuthError } from '../crypto/tokens.ts';
import { microsoftDateToNormalized } from '../sync/dates.ts';
import { isDeltaLinkInvalid } from '../sync/engine.ts';
import { optionalUuidOrUndefined } from '../sync/metadata.ts';
import { attachRecurringKind } from '../sync/recurring.ts';
import { providerFetch, type ProviderOperation, type RetrySafety } from './http-retry.ts';
import {
  MS_PROP_GUID,
  UNIFY_PROP_GROUP,
  UNIFY_PROP_ROLE,
  type CalendarInfo,
  type CalendarProvider,
  type CreateEventInput,
  type NormalizedEvent,
  type SyncPage,
  type WatchInfo,
} from '../sync/types.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'offline_access User.Read Calendars.ReadWrite';
const GROUP_PROP = `String {${MS_PROP_GUID}} Name ${UNIFY_PROP_GROUP}`;
const ROLE_PROP = `String {${MS_PROP_GUID}} Name ${UNIFY_PROP_ROLE}`;

export function inspectMicrosoftClientId(clientId: string): { isUuid: boolean; looksLikeSecret: boolean } {
  const value = clientId.trim();
  return {
    isUuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    looksLikeSecret: value.includes('~') || (value.length > 36 && !value.includes('-')),
  };
}

export function microsoftValidationToken(url: URL): string | null {
  return url.searchParams.get('validationToken');
}

export function parseMicrosoftEvent(raw: Record<string, unknown>, fallbackTz: string): NormalizedEvent {
  const start = raw.start as { dateTime?: string; timeZone?: string } | undefined;
  const end = raw.end as { dateTime?: string; timeZone?: string } | undefined;
  const range = microsoftDateToNormalized(start, end, Boolean(raw.isAllDay), fallbackTz);
  const props = (raw.singleValueExtendedProperties as Array<{ id: string; value: string }> | undefined) ?? [];
  const group = props.find((p) => p.id === GROUP_PROP)?.value;
  const role = props.find((p) => p.id === ROLE_PROP)?.value as NormalizedEvent['unifyEventRole'];
  const removed = Boolean(raw['@removed']) ||
    (raw['@removed'] as { reason?: string } | undefined)?.reason === 'deleted';
  const status: NormalizedEvent['status'] = removed || raw.isCancelled ? 'cancelled' : 'confirmed';
  const providerEventType = raw.type ? String(raw.type) : undefined;
  return attachRecurringKind({
    providerEventId: String(raw.id ?? ''),
    title: String(raw.subject ?? '(sem título)'),
    description: raw.bodyPreview ? String(raw.bodyPreview) : undefined,
    location: (raw.location as { displayName?: string } | undefined)?.displayName,
    ...range,
    status,
    etag: raw['@odata.etag'] ? String(raw['@odata.etag']) : undefined,
    updatedAt: raw.lastModifiedDateTime ? String(raw.lastModifiedDateTime) : undefined,
    recurrenceRule: raw.recurrence ? JSON.stringify(raw.recurrence) : undefined,
    recurringEventId: raw.seriesMasterId ? String(raw.seriesMasterId) : undefined,
    providerEventType,
    unifySyncGroupId: optionalUuidOrUndefined(group),
    unifyEventRole: role,
    isDeleted: removed || status === 'cancelled',
    busyTransparency: raw.showAs ? String(raw.showAs) : 'busy',
  });
}

export class MicrosoftCalendarProvider implements CalendarProvider {
  name = 'MICROSOFT' as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tenant = 'common',
  ) {}

  getAuthorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string {
    const tenant = this.tenant.trim() || 'common';
    const params = new URLSearchParams({
      client_id: this.clientId.trim(),
      response_type: 'code',
      redirect_uri: input.redirectUri.trim(),
      scope: SCOPES,
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }) {
    const body = await requestToken(this.tenant, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
      scope: SCOPES,
    });
    const me = await graphFetch(body.access_token, '/me?$select=id,mail,userPrincipalName', {
      operation: 'other',
      safety: 'read',
    });
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString(),
      accountId: String(me.id ?? me.userPrincipalName ?? ''),
      accountEmail: String(me.mail ?? me.userPrincipalName ?? ''),
    };
  }

  async refreshAccessToken(refreshToken: string) {
    const body = await requestToken(this.tenant, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: SCOPES,
    });
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString(),
    };
  }

  async listCalendars(accessToken: string): Promise<CalendarInfo[]> {
    const res = await graphFetch(accessToken, '/me/calendars', {
      operation: 'list_calendars',
      safety: 'read',
    });
    const items = (res.value ?? []) as Array<Record<string, unknown>>;
    return items.map((calendar) => ({
      providerCalendarId: String(calendar.id),
      name: String(calendar.name ?? calendar.id),
      color: hexFromMsColor(calendar.hexColor, calendar.color),
      timezone: calendar.timeZone ? String(calendar.timeZone) : undefined,
      isPrimary: Boolean(calendar.isDefaultCalendar),
      accessRole: calendar.canEdit === false ? 'reader' : 'writer',
    }));
  }

  async initialSync(
    accessToken: string,
    calendarId: string,
    pageToken?: string,
    range?: { timeMin: string; timeMax: string },
  ): Promise<SyncPage> {
    const start = range?.timeMin ?? new Date(Date.now() - 90 * 86400000).toISOString();
    const end = range?.timeMax ?? new Date(Date.now() + 180 * 86400000).toISOString();
    const path = pageToken ??
      `/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`;
    return this.readDelta(accessToken, path);
  }

  async incrementalSync(
    accessToken: string,
    calendarId: string,
    token: string,
    pageToken?: string,
  ): Promise<SyncPage> {
    try {
      const path = pageToken ?? (token.startsWith('http') ? token : '');
      if (!path) return this.initialSync(accessToken, calendarId);
      return await this.readDelta(accessToken, path);
    } catch (err) {
      const status = (err as { httpStatus?: number }).httpStatus ?? 0;
      if (isDeltaLinkInvalid(status, String(err))) {
        return { events: [], needsFullResync: true };
      }
      throw err;
    }
  }

  async createEvent(accessToken: string, calendarId: string, input: CreateEventInput) {
    // Graph calendar create has no supported idempotency key in this codebase → only rate-limit retries.
    const res = await graphFetch(accessToken, `/me/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify(toMicrosoftBody(input)),
      operation: 'create_event',
      safety: 'create',
    });
    return {
      providerEventId: String(res.id),
      etag: res['@odata.etag'] ? String(res['@odata.etag']) : undefined,
    };
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    providerEventId: string,
    input: Partial<CreateEventInput> & { startAt: string; endAt: string; allDay: boolean; timezone: string },
  ) {
    await graphFetch(
      accessToken,
      `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(providerEventId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(toMicrosoftBody(input as CreateEventInput)),
        operation: 'update_event',
        safety: 'idempotent_write',
      },
    );
  }

  async deleteEvent(accessToken: string, calendarId: string, providerEventId: string) {
    await graphFetch(
      accessToken,
      `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(providerEventId)}`,
      { method: 'DELETE', operation: 'delete_event', safety: 'idempotent_write', notFoundOk: true },
    );
  }

  async createWebhookSubscription(
    accessToken: string,
    calendarId: string,
    webhookUrl: string,
    clientState?: string,
  ): Promise<WatchInfo> {
    const expiresAt = new Date(Date.now() + 2.5 * 24 * 60 * 60 * 1000).toISOString();
    const state = clientState ?? crypto.randomUUID();
    const res = await graphFetch(accessToken, '/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        changeType: 'created,updated,deleted',
        notificationUrl: webhookUrl,
        lifecycleNotificationUrl: webhookUrl,
        resource: `/me/calendars/${calendarId}/events`,
        expirationDateTime: expiresAt,
        clientState: state,
      }),
      operation: 'subscription_create',
      safety: 'subscription_create',
    });
    return {
      externalSubscriptionId: String(res.id),
      expiresAt: String(res.expirationDateTime ?? expiresAt),
      clientState: state,
    };
  }

  async renewWebhookSubscription(
    accessToken: string,
    subscription: WatchInfo,
    _webhookUrl: string,
  ): Promise<WatchInfo> {
    const expiresAt = new Date(Date.now() + 2.5 * 24 * 60 * 60 * 1000).toISOString();
    const res = await graphFetch(accessToken, `/subscriptions/${subscription.externalSubscriptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ expirationDateTime: expiresAt }),
      operation: 'subscription_renew',
      safety: 'idempotent_write',
    });
    return { ...subscription, expiresAt: String(res.expirationDateTime ?? expiresAt) };
  }

  async deleteWebhookSubscription(accessToken: string, subscription: WatchInfo): Promise<void> {
    await graphFetch(accessToken, `/subscriptions/${subscription.externalSubscriptionId}`, {
      method: 'DELETE',
      operation: 'subscription_delete',
      safety: 'idempotent_write',
      notFoundOk: true,
    });
  }

  private async readDelta(accessToken: string, pathOrUrl: string): Promise<SyncPage> {
    const res = await graphFetch(accessToken, pathOrUrl, {
      operation: 'list_events',
      safety: 'read',
    });
    const items = (res.value ?? []) as Array<Record<string, unknown>>;
    return {
      events: items
        .filter((item) => item.id && item.type !== 'seriesMaster')
        .map((item) => parseMicrosoftEvent(item, 'UTC')),
      nextDeltaLink: res['@odata.deltaLink'] ? String(res['@odata.deltaLink']) : undefined,
      nextPageToken: res['@odata.nextLink'] ? String(res['@odata.nextLink']) : undefined,
    };
  }
}

async function requestToken(tenant: string, params: Record<string, string>): Promise<Record<string, string>> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await res.json();
  if (!res.ok) {
    const description = typeof body.error_description === 'string' ? body.error_description : '';
    const detail = description ? `${body.error}: ${description}` : String(body.error ?? 'microsoft_token_failed');
    throw Object.assign(new Error(detail), {
      status: mapOAuthError(res.status, body.error),
    });
  }
  return body as Record<string, string>;
}

export function toMicrosoftBody(input: CreateEventInput): Record<string, unknown> {
  const startDate = input.startAt.slice(0, 10);
  let endDate = input.endAt.slice(0, 10);
  // Graph all-day end is exclusive.
  if (input.allDay && endDate <= startDate) {
    const next = new Date(`${startDate}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    endDate = next.toISOString().slice(0, 10);
  }
  const extended: Array<{ id: string; value: string }> = [
    { id: ROLE_PROP, value: input.role },
  ];
  const group = optionalUuidOrUndefined(input.syncGroupId);
  if (group) extended.unshift({ id: GROUP_PROP, value: group });
  if (input.clientEventId) {
    extended.push({ id: `String {${MS_PROP_GUID}} Name unifyClientEventId`, value: input.clientEventId });
  }
  return {
    subject: input.title,
    body: input.description ? { contentType: 'text', content: input.description } : undefined,
    location: input.location ? { displayName: input.location } : undefined,
    isAllDay: input.allDay,
    start: input.allDay
      ? { dateTime: `${startDate}T00:00:00`, timeZone: input.timezone }
      : { dateTime: input.startAt.replace('Z', ''), timeZone: input.timezone || 'UTC' },
    end: input.allDay
      ? { dateTime: `${endDate}T00:00:00`, timeZone: input.timezone }
      : { dateTime: input.endAt.replace('Z', ''), timeZone: input.timezone || 'UTC' },
    showAs: 'busy',
    sensitivity: input.role === 'MIRROR' ? 'private' : 'normal',
    attendees: input.attendees?.length
      ? input.attendees.map((a) => ({
          emailAddress: { address: a.email, name: a.displayName },
          type: 'required',
        }))
      : undefined,
    singleValueExtendedProperties: extended,
  };
}

function hexFromMsColor(hex: unknown, named: unknown): string {
  if (typeof hex === 'string' && hex.startsWith('#')) return hex;
  const map: Record<string, string> = {
    lightBlue: '#5b9bd5',
    lightGreen: '#70ad47',
    lightOrange: '#ed7d31',
    lightGray: '#afabab',
    lightYellow: '#ffc000',
    lightTeal: '#00b0a6',
    lightPink: '#f472b6',
    lightBrown: '#c4a484',
    lightRed: '#e74c3c',
    maxColor: '#7c3aed',
    auto: '#0f6cbd',
  };
  return map[String(named)] ?? '#0f6cbd';
}

async function graphFetch(
  accessToken: string,
  pathOrUrl: string,
  init: RequestInit & {
    operation: ProviderOperation;
    safety: RetrySafety;
    notFoundOk?: boolean;
    allowEmpty?: boolean;
  },
): Promise<Record<string, unknown>> {
  const { operation, safety, notFoundOk, allowEmpty, ...rest } = init;
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH}${pathOrUrl}`;
  const result = await providerFetch({
    provider: 'MICROSOFT',
    operation,
    safety,
    url,
    notFoundOk,
    allowEmpty,
    init: {
      ...rest,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'IdType="ImmutableId"',
        ...(rest.headers ?? {}),
      },
    },
  });
  return result.body;
}
