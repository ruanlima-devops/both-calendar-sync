import { describe, expect, it } from 'vitest';
import { mapOAuthError, needsRefresh } from '../crypto/tokens.ts';
import { notificationDraftForSync } from '../notifications/messages.ts';
import { googleDateToNormalized, googleFullSyncWindow, microsoftDateToNormalized, zonedDateTimeToUtc } from './dates.ts';
import {
  applyIncomingEvent,
  createOriginWithOptionalMirrors,
  groupForUnifiedView,
  isDeltaLinkInvalid,
  isSyncTokenInvalid,
  removeMirrorsForOrigin,
  sameTimeDifferentCalendarsAllowed,
} from './engine.ts';
import { MemoryStore, RecordingActor } from './memory-store.ts';
import type { NormalizedEvent, StoredEvent, SyncContext } from './types.ts';

function event(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    providerEventId: 'g1',
    title: 'Dentista',
    startAt: '2026-08-19T17:00:00.000Z',
    endAt: '2026-08-19T18:00:00.000Z',
    timezone: 'America/Sao_Paulo',
    allDay: false,
    status: 'confirmed',
    ...over,
  };
}

function ctx(over: Partial<SyncContext> = {}): SyncContext {
  return {
    userId: 'user-1',
    connectionId: 'conn-g',
    connectedCalendarId: 'cal-g',
    provider: 'GOOGLE',
    autoBlockOthers: false,
    targets: [
      {
        id: 'cal-m',
        connectionId: 'conn-m',
        provider: 'MICROSOFT',
        providerCalendarId: 'ms-primary',
        enabled: true,
        accessRole: 'writer',
      },
    ],
    firewallRules: [],
    ...over,
  };
}

function setup() {
  const store = new MemoryStore();
  store.registerCalendar('cal-g', 'conn-g', 'google-primary');
  store.registerCalendar('cal-m', 'conn-m', 'ms-primary');
  return { store, actor: new RecordingActor() };
}

describe('provider import', () => {
  it('imports a Google event', async () => {
    const { store, actor } = setup();
    const result = await applyIncomingEvent(ctx(), event(), store, actor);
    expect(result.stored?.title).toBe('Dentista');
    expect(result.stored?.eventRole).toBe('EXTERNAL');
    expect(store.events.size).toBe(1);
  });

  it('imports a Microsoft event', async () => {
    const { store, actor } = setup();
    const result = await applyIncomingEvent(
      ctx({ connectedCalendarId: 'cal-m', provider: 'MICROSOFT', connectionId: 'conn-m' }),
      event({ providerEventId: 'm1', title: 'Daily' }),
      store,
      actor,
    );
    expect(result.stored?.title).toBe('Daily');
    expect(store.events.size).toBe(1);
  });
});

describe('idempotency', () => {
  it('does not duplicate a Google webhook delivered twice', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx(), event(), store, actor);
    await applyIncomingEvent(ctx(), event(), store, actor);
    expect(store.events.size).toBe(1);
  });

  it('does not duplicate a Microsoft webhook delivered twice', async () => {
    const { store, actor } = setup();
    const incoming = event({ providerEventId: 'm1' });
    const microsoftCtx = ctx({ connectedCalendarId: 'cal-m', provider: 'MICROSOFT', connectionId: 'conn-m' });
    await applyIncomingEvent(microsoftCtx, incoming, store, actor);
    await applyIncomingEvent(microsoftCtx, incoming, store, actor);
    expect(store.events.size).toBe(1);
  });
});

describe('auto block / mirrors', () => {
  it('creates a Microsoft mirror once when Google autoBlock is on', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx({ autoBlockOthers: true }), event(), store, actor);
    await applyIncomingEvent(ctx({ autoBlockOthers: true }), event(), store, actor);
    expect(actor.creates.filter((c) => c.calendarId === 'cal-m')).toHaveLength(1);
    expect(actor.creates[0]?.title).toBe('Horário reservado · Unify');
    expect([...store.events.values()].filter((e) => e.eventRole === 'MIRROR')).toHaveLength(1);
  });

  it('creates a Google mirror once when Microsoft autoBlock is on', async () => {
    const { store, actor } = setup();
    const microsoftCtx = ctx({
      connectedCalendarId: 'cal-m',
      provider: 'MICROSOFT',
      connectionId: 'conn-m',
      autoBlockOthers: true,
      targets: [
        {
          id: 'cal-g',
          connectionId: 'conn-g',
          provider: 'GOOGLE',
          providerCalendarId: 'google-primary',
          enabled: true,
          accessRole: 'writer',
        },
      ],
    });
    await applyIncomingEvent(microsoftCtx, event({ providerEventId: 'm1' }), store, actor);
    await applyIncomingEvent(microsoftCtx, event({ providerEventId: 'm1' }), store, actor);
    expect(actor.creates.filter((c) => c.calendarId === 'cal-g')).toHaveLength(1);
  });

  it('does not propagate a mirror webhook back to the origin', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx({ autoBlockOthers: true }), event(), store, actor);
    const mirror = [...store.events.values()].find((e) => e.eventRole === 'MIRROR');
    expect(mirror).toBeTruthy();
    const before = actor.creates.length;
    await applyIncomingEvent(
      ctx({ connectedCalendarId: 'cal-m', provider: 'MICROSOFT', connectionId: 'conn-m' }),
      event({
        providerEventId: mirror!.providerEventId,
        title: 'Horário reservado · Unify',
        unifyEventRole: 'MIRROR',
        unifySyncGroupId: mirror!.syncGroupId ?? undefined,
      }),
      store,
      actor,
    );
    expect(actor.creates.length).toBe(before);
  });

  it('updates mirrors when the origin times change', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx({ autoBlockOthers: true }), event(), store, actor);
    await applyIncomingEvent(
      ctx({ autoBlockOthers: true }),
      event({ startAt: '2026-08-19T18:00:00.000Z', endAt: '2026-08-19T19:00:00.000Z' }),
      store,
      actor,
    );
    expect(actor.updates).toHaveLength(1);
    expect(actor.updates[0]?.startAt).toBe('2026-08-19T18:00:00.000Z');
  });

  it('deletes mirrors when the origin is deleted', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx({ autoBlockOthers: true }), event(), store, actor);
    await applyIncomingEvent(ctx(), event({ isDeleted: true, status: 'cancelled' }), store, actor);
    expect(actor.deletes).toHaveLength(1);
  });

  it('uses professional busy title and description on mirrors', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx({ autoBlockOthers: true }), event(), store, actor);
    expect(actor.creates[0]?.title).toBe('Horário reservado · Unify');
    const mirror = [...store.events.values()].find((e) => e.eventRole === 'MIRROR');
    expect(mirror?.title).toBe('Horário reservado · Unify');
  });

  it('does not recreate mirrors when editing the same origin repeatedly', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx({ autoBlockOthers: true }), event(), store, actor);
    const createsAfterFirst = actor.creates.length;
    await applyIncomingEvent(
      ctx({ autoBlockOthers: true }),
      event({ title: 'Dentista v2', startAt: '2026-08-19T17:00:00.000Z', endAt: '2026-08-19T18:00:00.000Z' }),
      store,
      actor,
    );
    await applyIncomingEvent(
      ctx({ autoBlockOthers: true }),
      event({ title: 'Dentista v3', startAt: '2026-08-19T17:00:00.000Z', endAt: '2026-08-19T18:00:00.000Z' }),
      store,
      actor,
    );
    expect(actor.creates.length).toBe(createsAfterFirst);
    expect([...store.events.values()].filter((e) => e.eventRole === 'MIRROR')).toHaveLength(1);
  });

  it('removes mirrors when blocking is toggled off', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx({ autoBlockOthers: true }), event(), store, actor);
    const origin = [...store.events.values()].find((e) => e.eventRole === 'ORIGIN')!;
    const result = {
      stored: origin,
      createdMirrors: 0,
      updatedMirrors: 0,
      deletedMirrors: 0,
      skipped: null,
      errors: [] as string[],
    };
    await removeMirrorsForOrigin(origin, store, actor, result);
    expect(result.deletedMirrors).toBe(1);
    expect(actor.deletes).toHaveLength(1);
  });

  it('does not recreate a mirror the user deleted outside the app', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx({ autoBlockOthers: true }), event(), store, actor);
    const mirror = [...store.events.values()].find((e) => e.eventRole === 'MIRROR')!;
    await applyIncomingEvent(
      ctx({ connectedCalendarId: 'cal-m', provider: 'MICROSOFT', connectionId: 'conn-m' }),
      event({
        providerEventId: mirror.providerEventId,
        isDeleted: true,
        status: 'cancelled',
        unifyEventRole: 'MIRROR',
      }),
      store,
      actor,
    );
    const createsAfterDelete = actor.creates.length;
    await applyIncomingEvent(
      ctx({ autoBlockOthers: true }),
      event({ startAt: '2026-08-19T18:00:00.000Z', endAt: '2026-08-19T19:00:00.000Z' }),
      store,
      actor,
    );
    expect(actor.creates.length).toBe(createsAfterDelete);
  });

  it('creates mirrors from directional firewall rules with availability privacy', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(
      ctx({
        autoBlockOthers: false,
        firewallRules: [
          {
            id: 'rule-1',
            userId: 'user-1',
            sourceCalendarId: 'cal-g',
            destinationCalendarId: 'cal-m',
            enabled: true,
            privacyPreset: 'availability',
            syncTitle: false,
            syncDescription: false,
            syncLocation: false,
            syncAttendees: false,
            syncConference: false,
            ignoreFree: true,
            ignoreCancelled: true,
            placeholderTitle: 'Horário reservado · Unify',
            busyStatus: 'busy',
          },
        ],
      }),
      event({ title: 'Consulta médica', description: 'Dr. X', location: 'Sala' }),
      store,
      actor,
    );
    expect(actor.creates).toHaveLength(1);
    expect(actor.creates[0]?.title).toBe('Horário reservado · Unify');
    const mirror = [...store.events.values()].find((e) => e.eventRole === 'MIRROR');
    expect(mirror?.firewallRuleId).toBe('rule-1');
  });

  it('skips free events when firewall ignore_free is enabled', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(
      ctx({
        firewallRules: [
          {
            id: 'rule-1',
            userId: 'user-1',
            sourceCalendarId: 'cal-g',
            destinationCalendarId: 'cal-m',
            enabled: true,
            privacyPreset: 'availability',
            syncTitle: false,
            syncDescription: false,
            syncLocation: false,
            syncAttendees: false,
            syncConference: false,
            ignoreFree: true,
            ignoreCancelled: true,
            placeholderTitle: 'Horário reservado · Unify',
            busyStatus: 'busy',
          },
        ],
      }),
      event({ busyTransparency: 'transparent' }),
      store,
      actor,
    );
    expect(actor.creates).toHaveLength(0);
  });
});

describe('tokens and recovery', () => {
  it('refreshes an expired access token', () => {
    expect(needsRefresh(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(needsRefresh(new Date(Date.now() + 10 * 60_000).toISOString())).toBe(false);
  });

  it('maps a revoked refresh token to AUTH_REQUIRED', () => {
    expect(mapOAuthError(400, 'invalid_grant')).toBe('AUTH_REQUIRED');
    expect(mapOAuthError(401, 'invalid_token')).toBe('AUTH_REQUIRED');
    expect(mapOAuthError(500)).toBe('ERROR');
  });

  it('treats Google syncToken invalidation as a full resync', () => {
    expect(isSyncTokenInvalid(410)).toBe(true);
    expect(isSyncTokenInvalid(400, 'SyncToken is invalid')).toBe(true);
    expect(isSyncTokenInvalid(200)).toBe(false);
  });

  it('keeps today inside the Google full-sync window', () => {
    const now = new Date('2026-08-19T18:20:00.000Z');
    const window = googleFullSyncWindow(now);
    expect(Date.parse(window.timeMin)).toBeLessThan(now.getTime());
    expect(Date.parse(window.timeMax)).toBeGreaterThan(now.getTime());
  });

  it('treats Microsoft delta expiry as recovery', () => {
    expect(isDeltaLinkInvalid(410)).toBe(true);
    expect(isDeltaLinkInvalid(400, 'delta link expired')).toBe(true);
  });
});

describe('calendar semantics', () => {
  it('allows two events at the same time from different calendars', () => {
    expect(
      sameTimeDifferentCalendarsAllowed(
        { connectedCalendarId: 'cal-g' },
        { connectedCalendarId: 'cal-m' },
      ),
    ).toBe(true);
  });

  it('groups origin+mirror as one unified item', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx({ autoBlockOthers: true }), event(), store, actor);
    const grouped = groupForUnifiedView([...store.events.values()]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.title).toBe('Dentista');
  });

  it('preserves America/New_York DST offsets', () => {
    const winter = zonedDateTimeToUtc('2026-01-15', '14:00:00', 'America/New_York');
    const summer = zonedDateTimeToUtc('2026-07-15', '14:00:00', 'America/New_York');
    expect(winter).toBe('2026-01-15T19:00:00.000Z');
    expect(summer).toBe('2026-07-15T18:00:00.000Z');
  });

  it('normalizes Google all-day events with exclusive end date', () => {
    const range = googleDateToNormalized({ date: '2026-08-19' }, { date: '2026-08-20' }, 'UTC');
    expect(range.allDay).toBe(true);
    expect(range.startAt).toBe('2026-08-19T00:00:00.000Z');
    expect(range.endAt).toBe('2026-08-20T00:00:00.000Z');
  });

  it('normalizes Microsoft all-day events', () => {
    const range = microsoftDateToNormalized(
      { dateTime: '2026-08-19T00:00:00.0000000', timeZone: 'UTC' },
      { dateTime: '2026-08-20T00:00:00.0000000', timeZone: 'UTC' },
      true,
      'UTC',
    );
    expect(range.allDay).toBe(true);
    expect(range.startAt).toBe('2026-08-19T00:00:00.000Z');
  });

  it('surfaces partial mirror failure on local create', async () => {
    const { store, actor } = setup();
    actor.failForCalendarIds.add('cal-m');
    const result = await createOriginWithOptionalMirrors(
      ctx(),
      { id: 'cal-g', connectionId: 'conn-g', providerCalendarId: 'google-primary' },
      {
        title: 'Dentista',
        startAt: '2026-08-19T17:00:00.000Z',
        endAt: '2026-08-19T18:00:00.000Z',
        timezone: 'America/Sao_Paulo',
        allDay: false,
        blockOtherCalendars: true,
      },
      store,
      actor,
    );
    expect(result.stored?.title).toBe('Dentista');
    expect(result.errors.some((e) => e.startsWith('mirror_create_failed'))).toBe(true);
  });
});

function snapshot(event: StoredEvent | NormalizedEvent, role?: string) {
  return {
    title: event.title,
    startAt: event.startAt,
    endAt: 'endAt' in event ? event.endAt : event.endAt,
    allDay: event.allDay,
    location: 'location' in event ? event.location : undefined,
    eventRole: role ?? ('eventRole' in event ? event.eventRole : 'EXTERNAL'),
  };
}

describe('calendar notifications from sync', () => {
  it('creates a draft after an incremental Google insert', async () => {
    const { store, actor } = setup();
    const incoming = event({ title: 'NOTIFICATION GOOGLE CREATE 001' });
    const previous = await store.findByProviderEventId('cal-g', incoming.providerEventId);
    const result = await applyIncomingEvent(ctx(), incoming, store, actor);
    const draft = notificationDraftForSync(
      'incremental',
      previous,
      snapshot(incoming, result.stored?.eventRole),
      incoming.timezone,
    );
    expect(result.stored?.title).toBe('NOTIFICATION GOOGLE CREATE 001');
    expect(draft?.type).toBe('calendar_event_created');
    expect(draft?.title).toBe('Novo evento');
  });

  it('describes a time change without duplicating create', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx(), event({ title: 'NOTIFICATION GOOGLE CREATE 001', etag: 'v1' }), store, actor);
    const previous = await store.findByProviderEventId('cal-g', 'g1');
    const incoming = event({
      title: 'NOTIFICATION GOOGLE CREATE 001',
      startAt: '2026-08-19T18:00:00.000Z',
      endAt: '2026-08-19T19:00:00.000Z',
      etag: 'v2',
    });
    await applyIncomingEvent(ctx(), incoming, store, actor);
    const draft = notificationDraftForSync('incremental', previous, snapshot(incoming, previous?.eventRole), incoming.timezone);
    expect(draft?.type).toBe('calendar_event_updated');
    expect(draft?.body).toMatch(/Horário alterado/);
  });

  it('skips origin echo and full sync history', async () => {
    const created = notificationDraftForSync(
      'incremental',
      snapshot(event(), 'ORIGIN'),
      snapshot(event({ title: 'Echo' }), 'ORIGIN'),
      'America/Sao_Paulo',
    );
    const history = notificationDraftForSync('full', null, snapshot(event({ title: 'Histórico' })), 'America/Sao_Paulo');
    expect(created).toBeNull();
    expect(history).toBeNull();
  });
});
