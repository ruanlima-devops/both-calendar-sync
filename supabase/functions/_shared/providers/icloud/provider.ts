import type {
  CalendarInfo,
  CalendarProvider,
  CreateEventInput,
  NormalizedEvent,
  ProviderName,
  SyncPage,
  WatchInfo,
} from '../../sync/types.ts';
import { optionalUuidOrUndefined } from '../../sync/metadata.ts';
import {
  authFromBasicToken,
  buildEventIcs,
  deleteResource,
  discoverIcloud,
  getResource,
  putEvent,
  queryEvents,
  readCalendarProps,
  syncCollection,
} from './caldav.ts';
import { parseVEvents } from './ics.ts';

export function icloudAccessToken(email: string, password: string): string {
  return `${email}\n${password}`;
}

function toNormalized(
  href: string,
  etag: string | undefined,
  vevent: ReturnType<typeof parseVEvents>[number],
): NormalizedEvent {
  const status =
    vevent.status === 'CANCELLED'
      ? 'cancelled'
      : vevent.status === 'TENTATIVE'
        ? 'tentative'
        : 'confirmed';
  const roleRaw = vevent.xProps['X-UNIFY-MANAGED'];
  const role =
    roleRaw === 'MIRROR' || roleRaw === 'ORIGIN' || roleRaw === 'EXTERNAL' ? roleRaw : undefined;
  const group = vevent.xProps['X-UNIFY-CORRELATION-ID'];
  return {
    providerEventId: href,
    title: vevent.summary,
    description: vevent.description,
    location: vevent.location,
    startAt: vevent.startAt,
    endAt: vevent.endAt,
    timezone: vevent.timezone,
    allDay: vevent.allDay,
    status,
    etag,
    updatedAt: vevent.lastModified,
    recurrenceRule: vevent.rrule,
    recurringEventId: vevent.recurrenceId,
    unifySyncGroupId: optionalUuidOrUndefined(group),
    unifyEventRole: role,
    busyTransparency: vevent.transp === 'TRANSPARENT' ? 'transparent' : 'opaque',
  };
}

export class ICloudCalendarProvider implements CalendarProvider {
  readonly name: ProviderName = 'ICLOUD';

  getAuthorizationUrl(): string {
    throw new Error('icloud_oauth_not_supported');
  }

  exchangeAuthorizationCode(): Promise<never> {
    return Promise.reject(new Error('icloud_oauth_not_supported'));
  }

  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt: string;
  }> {
    // App-specific password does not rotate via OAuth; treat as long-lived.
    return {
      accessToken: refreshToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
    };
  }

  async listCalendars(accessToken: string): Promise<CalendarInfo[]> {
    const auth = authFromBasicToken(accessToken);
    const discovered = await discoverIcloud(auth);
    return discovered.calendars.map((c) => ({
      providerCalendarId: c.href,
      name: c.displayName,
      color: c.color,
      timezone: 'UTC',
      isPrimary: c.isPrimary,
      accessRole: c.accessRole,
    }));
  }

  async initialSync(
    accessToken: string,
    calendarId: string,
    _pageToken?: string,
    range?: { timeMin: string; timeMax: string },
  ): Promise<SyncPage> {
    const auth = authFromBasicToken(accessToken);
    const window = range ?? {
      timeMin: new Date(Date.now() - 365 * 86400_000).toISOString(),
      timeMax: new Date(Date.now() + 730 * 86400_000).toISOString(),
    };
    const resources = await queryEvents(auth, calendarId, window);
    const events: NormalizedEvent[] = [];
    for (const r of resources) {
      for (const ve of r.events) {
        events.push(toNormalized(r.href, r.etag, ve));
      }
    }
    const props = await readCalendarProps(auth, calendarId);
    return {
      events,
      nextSyncToken: props.syncToken
        ? `sync:${props.syncToken}`
        : props.ctag
          ? `ctag:${props.ctag}`
          : undefined,
    };
  }

  async incrementalSync(
    accessToken: string,
    calendarId: string,
    token: string,
    _pageToken?: string,
  ): Promise<SyncPage> {
    const auth = authFromBasicToken(accessToken);

    if (token.startsWith('ctag:')) {
      const prev = token.slice(5);
      const props = await readCalendarProps(auth, calendarId);
      if (props.ctag && props.ctag === prev) {
        return { events: [], nextSyncToken: `ctag:${props.ctag}` };
      }
      return this.initialSync(accessToken, calendarId);
    }

    const syncToken = token.startsWith('sync:') ? token.slice(5) : token;
    const delta = await syncCollection(auth, calendarId, syncToken);
    if (delta.needsFullResync) {
      return { events: [], needsFullResync: true };
    }

    const events: NormalizedEvent[] = [];
    for (const change of delta.changes) {
      if (change.deleted) {
        events.push({
          providerEventId: change.href,
          title: '',
          startAt: new Date().toISOString(),
          endAt: new Date().toISOString(),
          timezone: 'UTC',
          allDay: false,
          status: 'cancelled',
          isDeleted: true,
        });
        continue;
      }
      try {
        const resource = await getResource(auth, change.href);
        for (const ve of parseVEvents(resource.ics)) {
          events.push(toNormalized(change.href, resource.etag ?? change.etag, ve));
        }
      } catch (err) {
        if ((err as { httpStatus?: number }).httpStatus === 404) {
          events.push({
            providerEventId: change.href,
            title: '',
            startAt: new Date().toISOString(),
            endAt: new Date().toISOString(),
            timezone: 'UTC',
            allDay: false,
            status: 'cancelled',
            isDeleted: true,
          });
        } else {
          throw err;
        }
      }
    }

    return {
      events,
      nextSyncToken: delta.nextSyncToken ? `sync:${delta.nextSyncToken}` : token,
    };
  }

  async createEvent(
    accessToken: string,
    calendarId: string,
    input: CreateEventInput,
  ): Promise<{ providerEventId: string; etag?: string }> {
    const auth = authFromBasicToken(accessToken);
    const uid = crypto.randomUUID();
    const href = calendarId.endsWith('/') ? `${calendarId}${uid}.ics` : `${calendarId}/${uid}.ics`;
    const ics = buildEventIcs({
      uid,
      title: input.title,
      description: input.description,
      location: input.location,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      allDay: input.allDay,
      role: input.role,
      syncGroupId: input.syncGroupId,
      transp: 'OPAQUE',
      attendees: input.attendees,
    });
    const result = await putEvent(auth, href, ics);
    return { providerEventId: href, etag: result.etag };
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    providerEventId: string,
    input: Partial<CreateEventInput> & { startAt: string; endAt: string; allDay: boolean; timezone: string },
  ): Promise<void> {
    void calendarId;
    const auth = authFromBasicToken(accessToken);
    let existingIcs = '';
    let etag: string | undefined;
    try {
      const resource = await getResource(auth, providerEventId);
      existingIcs = resource.ics;
      etag = resource.etag;
    } catch {
      /* recreate */
    }
    const existing = existingIcs ? parseVEvents(existingIcs)[0] : undefined;
    const uid =
      existing?.uid || providerEventId.split('/').pop()?.replace(/\.ics$/i, '') || crypto.randomUUID();
    const ics = buildEventIcs({
      uid,
      title: input.title ?? existing?.summary ?? 'Event',
      description: input.description ?? existing?.description,
      location: input.location ?? existing?.location,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      allDay: input.allDay,
      role: input.role ?? existing?.xProps['X-UNIFY-MANAGED'],
      syncGroupId: input.syncGroupId ?? existing?.xProps['X-UNIFY-CORRELATION-ID'],
      transp: 'OPAQUE',
    });
    await putEvent(auth, providerEventId, ics, etag);
  }

  async deleteEvent(accessToken: string, _calendarId: string, providerEventId: string): Promise<void> {
    const auth = authFromBasicToken(accessToken);
    await deleteResource(auth, providerEventId);
  }

  async createWebhookSubscription(): Promise<WatchInfo> {
    throw new Error('icloud_push_not_supported');
  }
  async renewWebhookSubscription(): Promise<WatchInfo> {
    throw new Error('icloud_push_not_supported');
  }
  async deleteWebhookSubscription(): Promise<void> {
    /* no-op — iCloud has no push subscriptions */
  }
}

export { discoverIcloud };
