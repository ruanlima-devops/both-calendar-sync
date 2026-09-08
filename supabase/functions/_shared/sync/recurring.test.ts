import { describe, expect, it } from 'vitest';
import { parseGoogleEvent } from '../providers/google.ts';
import { parseMicrosoftEvent } from '../providers/microsoft.ts';
import { applyIncomingEvent } from './engine.ts';
import { MemoryStore, RecordingActor } from './memory-store.ts';
import {
  classifyRecurringKind,
  isUnsupportedRecurringMutation,
  canMirrorRecurringKind,
} from './recurring.ts';
import type { NormalizedEvent, SyncContext } from './types.ts';

function baseCtx(over: Partial<SyncContext> = {}): SyncContext {
  return {
    userId: 'user-1',
    connectionId: 'conn-g',
    connectedCalendarId: 'cal-g',
    provider: 'GOOGLE',
    autoBlockOthers: true,
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

function single(over: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    providerEventId: 'single-1',
    title: 'Dentista',
    startAt: '2026-09-22T17:00:00.000Z',
    endAt: '2026-09-22T18:00:00.000Z',
    timezone: 'America/Sao_Paulo',
    allDay: false,
    status: 'confirmed',
    ...over,
  };
}

describe('classifyRecurringKind', () => {
  it('classifies single / master / occurrence / exception', () => {
    expect(classifyRecurringKind({})).toBe('single');
    expect(classifyRecurringKind({ recurrenceRule: 'RRULE:FREQ=DAILY' })).toBe('series_master');
    expect(classifyRecurringKind({ recurringEventId: 'master-1' })).toBe('occurrence');
    expect(classifyRecurringKind({ providerEventType: 'seriesMaster' })).toBe('series_master');
    expect(classifyRecurringKind({ providerEventType: 'occurrence' })).toBe('occurrence');
    expect(classifyRecurringKind({ providerEventType: 'exception' })).toBe('exception');
    expect(classifyRecurringKind({ providerEventType: 'singleInstance' })).toBe('single');
  });

  it('marks mutating recurring kinds as unsupported for API mutations', () => {
    expect(isUnsupportedRecurringMutation('single')).toBe(false);
    expect(isUnsupportedRecurringMutation('series_master')).toBe(true);
    expect(isUnsupportedRecurringMutation('occurrence')).toBe(true);
    expect(isUnsupportedRecurringMutation('exception')).toBe(true);
    expect(canMirrorRecurringKind('series_master')).toBe(false);
    expect(canMirrorRecurringKind('occurrence')).toBe(true);
  });
});

describe('Google recurring safety', () => {
  it('keeps single event mirroring behavior', async () => {
    const { store, actor } = setup();
    const result = await applyIncomingEvent(baseCtx(), single(), store, actor);
    expect(result.errors).toEqual([]);
    expect(result.createdMirrors).toBe(1);
    expect(result.skipped).toBeNull();
  });

  it('recognizes recurring master and does not create incomplete series mirrors', async () => {
    const parsed = parseGoogleEvent(
      {
        id: 'master-1',
        summary: 'Standup',
        status: 'confirmed',
        start: { dateTime: '2026-09-22T14:00:00Z' },
        end: { dateTime: '2026-09-22T14:30:00Z' },
        recurrence: ['RRULE:FREQ=DAILY;COUNT=5'],
      },
      'UTC',
    );
    expect(parsed.recurringKind).toBe('series_master');

    const { store, actor } = setup();
    const result = await applyIncomingEvent(baseCtx(), parsed, store, actor);
    expect(result.stored?.providerEventId).toBe('master-1');
    expect(result.createdMirrors).toBe(0);
    expect(result.skipped).toBe('unsupported_recurring_operation');
    expect(result.errors).toEqual([]);
    expect(actor.creates).toHaveLength(0);
  });

  it('recognizes recurring instance', () => {
    const parsed = parseGoogleEvent(
      {
        id: 'inst-1',
        summary: 'Standup',
        status: 'confirmed',
        start: { dateTime: '2026-09-23T14:00:00Z' },
        end: { dateTime: '2026-09-23T14:30:00Z' },
        recurringEventId: 'master-1',
      },
      'UTC',
    );
    expect(parsed.recurringKind).toBe('occurrence');
    expect(parsed.recurringEventId).toBe('master-1');
  });

  it('cancelled instance does not delete master mirrors', async () => {
    const { store, actor } = setup();
    // Master stored without mirrors (unsupported mirror path).
    await applyIncomingEvent(
      baseCtx(),
      parseGoogleEvent(
        {
          id: 'master-1',
          summary: 'Standup',
          start: { dateTime: '2026-09-22T14:00:00Z' },
          end: { dateTime: '2026-09-22T14:30:00Z' },
          recurrence: ['RRULE:FREQ=DAILY;COUNT=5'],
        },
        'UTC',
      ),
      store,
      actor,
    );
    // Separate instance with its own mirrors.
    await applyIncomingEvent(
      baseCtx(),
      parseGoogleEvent(
        {
          id: 'inst-1',
          summary: 'Standup',
          start: { dateTime: '2026-09-23T14:00:00Z' },
          end: { dateTime: '2026-09-23T14:30:00Z' },
          recurringEventId: 'master-1',
        },
        'UTC',
      ),
      store,
      actor,
    );
    expect(actor.creates).toHaveLength(1);

    const beforeDeletes = actor.deletes.length;
    await applyIncomingEvent(
      baseCtx(),
      parseGoogleEvent(
        {
          id: 'inst-1',
          summary: 'Standup',
          status: 'cancelled',
          start: { dateTime: '2026-09-23T14:00:00Z' },
          end: { dateTime: '2026-09-23T14:30:00Z' },
          recurringEventId: 'master-1',
        },
        'UTC',
      ),
      store,
      actor,
    );

    const master = await store.findByProviderEventId('cal-g', 'master-1');
    expect(master?.status).toBe('confirmed');
    expect(actor.deletes.length).toBe(beforeDeletes + 1);
  });

  it('instance update does not mutate master event', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(
      baseCtx(),
      parseGoogleEvent(
        {
          id: 'master-1',
          summary: 'Standup',
          start: { dateTime: '2026-09-22T14:00:00Z' },
          end: { dateTime: '2026-09-22T14:30:00Z' },
          recurrence: ['RRULE:FREQ=DAILY;COUNT=5'],
        },
        'UTC',
      ),
      store,
      actor,
    );
    await applyIncomingEvent(
      baseCtx(),
      parseGoogleEvent(
        {
          id: 'inst-1',
          summary: 'Standup moved',
          start: { dateTime: '2026-09-23T15:00:00Z' },
          end: { dateTime: '2026-09-23T15:30:00Z' },
          recurringEventId: 'master-1',
        },
        'UTC',
      ),
      store,
      actor,
    );
    await applyIncomingEvent(
      baseCtx(),
      parseGoogleEvent(
        {
          id: 'inst-1',
          summary: 'Standup moved again',
          start: { dateTime: '2026-09-23T16:00:00Z' },
          end: { dateTime: '2026-09-23T16:30:00Z' },
          recurringEventId: 'master-1',
        },
        'UTC',
      ),
      store,
      actor,
    );

    const master = await store.findByProviderEventId('cal-g', 'master-1');
    expect(master?.startAt).toBe('2026-09-22T14:00:00.000Z');
    expect(master?.title).toBe('Standup');
    const inst = await store.findByProviderEventId('cal-g', 'inst-1');
    expect(inst?.startAt).toBe('2026-09-23T16:00:00.000Z');
  });
});

describe('Microsoft recurring safety', () => {
  it('recognizes singleInstance / seriesMaster / occurrence / exception', () => {
    expect(
      parseMicrosoftEvent(
        {
          id: 's1',
          subject: 'One',
          type: 'singleInstance',
          start: { dateTime: '2026-09-22T14:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-09-22T15:00:00', timeZone: 'UTC' },
        },
        'UTC',
      ).recurringKind,
    ).toBe('single');

    const master = parseMicrosoftEvent(
      {
        id: 'm1',
        subject: 'Series',
        type: 'seriesMaster',
        recurrence: { pattern: { type: 'daily' }, range: { type: 'numbered', numberOfOccurrences: 3 } },
        start: { dateTime: '2026-09-22T14:00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-09-22T15:00:00', timeZone: 'UTC' },
      },
      'UTC',
    );
    expect(master.recurringKind).toBe('series_master');

    const occ = parseMicrosoftEvent(
      {
        id: 'o1',
        subject: 'Series',
        type: 'occurrence',
        seriesMasterId: 'm1',
        start: { dateTime: '2026-09-23T14:00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-09-23T15:00:00', timeZone: 'UTC' },
      },
      'UTC',
    );
    expect(occ.recurringKind).toBe('occurrence');
    expect(occ.recurringEventId).toBe('m1');

    const ex = parseMicrosoftEvent(
      {
        id: 'e1',
        subject: 'Series moved',
        type: 'exception',
        seriesMasterId: 'm1',
        start: { dateTime: '2026-09-24T16:00:00', timeZone: 'UTC' },
        end: { dateTime: '2026-09-24T17:00:00', timeZone: 'UTC' },
      },
      'UTC',
    );
    expect(ex.recurringKind).toBe('exception');
  });

  it('occurrence delete does not delete master', async () => {
    const { store, actor } = setup();
    const ctx = baseCtx({ provider: 'MICROSOFT', connectionId: 'conn-m', connectedCalendarId: 'cal-m' });
    await applyIncomingEvent(
      ctx,
      parseMicrosoftEvent(
        {
          id: 'm1',
          subject: 'Series',
          type: 'seriesMaster',
          recurrence: { pattern: { type: 'daily' } },
          start: { dateTime: '2026-09-22T14:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-09-22T15:00:00', timeZone: 'UTC' },
        },
        'UTC',
      ),
      store,
      actor,
    );
    await applyIncomingEvent(
      ctx,
      parseMicrosoftEvent(
        {
          id: 'o1',
          subject: 'Series',
          type: 'occurrence',
          seriesMasterId: 'm1',
          start: { dateTime: '2026-09-23T14:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-09-23T15:00:00', timeZone: 'UTC' },
        },
        'UTC',
      ),
      store,
      actor,
    );
    await applyIncomingEvent(
      ctx,
      parseMicrosoftEvent(
        {
          id: 'o1',
          subject: 'Series',
          type: 'occurrence',
          seriesMasterId: 'm1',
          isCancelled: true,
          start: { dateTime: '2026-09-23T14:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-09-23T15:00:00', timeZone: 'UTC' },
        },
        'UTC',
      ),
      store,
      actor,
    );
    const master = await store.findByProviderEventId('cal-m', 'm1');
    expect(master?.status).toBe('confirmed');
  });

  it('series master does not create mirrors (controlled unsupported)', async () => {
    const { store, actor } = setup();
    const result = await applyIncomingEvent(
      baseCtx({ provider: 'MICROSOFT', connectionId: 'conn-m', connectedCalendarId: 'cal-m' }),
      parseMicrosoftEvent(
        {
          id: 'm1',
          subject: 'Series',
          type: 'seriesMaster',
          recurrence: { pattern: { type: 'weekly' } },
          start: { dateTime: '2026-09-22T14:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-09-22T15:00:00', timeZone: 'UTC' },
        },
        'UTC',
      ),
      store,
      actor,
    );
    expect(result.skipped).toBe('unsupported_recurring_operation');
    expect(result.errors).toEqual([]);
    expect(actor.creates).toHaveLength(0);
  });
});

describe('cross-provider recurring safety', () => {
  it('does not create duplicate series mirrors for Google master → MS path', async () => {
    const { store, actor } = setup();
    const once = await applyIncomingEvent(
      baseCtx(),
      parseGoogleEvent(
        {
          id: 'master-g',
          summary: 'Recurring',
          start: { dateTime: '2026-09-22T10:00:00Z' },
          end: { dateTime: '2026-09-22T11:00:00Z' },
          recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
        },
        'UTC',
      ),
      store,
      actor,
    );
    const twice = await applyIncomingEvent(
      baseCtx(),
      parseGoogleEvent(
        {
          id: 'master-g',
          summary: 'Recurring',
          start: { dateTime: '2026-09-22T10:00:00Z' },
          end: { dateTime: '2026-09-22T11:00:00Z' },
          recurrence: ['RRULE:FREQ=WEEKLY;COUNT=4'],
        },
        'UTC',
      ),
      store,
      actor,
    );
    expect(once.createdMirrors + twice.createdMirrors).toBe(0);
    expect(actor.creates).toHaveLength(0);
  });
});
