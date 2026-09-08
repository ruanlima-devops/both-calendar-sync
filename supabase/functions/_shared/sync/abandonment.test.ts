import { describe, expect, it } from 'vitest';
import {
  buildMirrorAbandonmentKey,
  parseMirrorAbandonmentKey,
} from './abandonment.ts';
import { applyIncomingEvent } from './engine.ts';
import { MemoryStore, RecordingActor } from './memory-store.ts';
import type { NormalizedEvent, SyncContext } from './types.ts';

function setup() {
  return { store: new MemoryStore(), actor: new RecordingActor() };
}

function ctx(partial: Partial<SyncContext> = {}): SyncContext {
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
    ...partial,
  };
}

function event(partial: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    providerEventId: 'origin-1',
    title: 'Dentista',
    description: null,
    location: null,
    startAt: '2026-08-19T17:00:00.000Z',
    endAt: '2026-08-19T18:00:00.000Z',
    timezone: 'UTC',
    allDay: false,
    status: 'confirmed',
    isDeleted: false,
    ...partial,
  };
}

describe('mirror abandonment key', () => {
  it('round-trips keys including provider ids with colons', () => {
    const key = buildMirrorAbandonmentKey('cal-a', 'evt:with:colons', 'cal-b');
    expect(parseMirrorAbandonmentKey(key)).toEqual({
      originCalendarId: 'cal-a',
      originProviderEventId: 'evt:with:colons',
      targetCalendarId: 'cal-b',
    });
  });

  it('rejects malformed keys', () => {
    expect(parseMirrorAbandonmentKey('')).toBeNull();
    expect(parseMirrorAbandonmentKey('only-one')).toBeNull();
  });
});

describe('wasMirrorAbandoned', () => {
  it('returns false while mirror exists and is confirmed', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx(), event(), store, actor);
    const origin = [...store.events.values()].find((e) => e.eventRole === 'ORIGIN')!;
    const key = buildMirrorAbandonmentKey(origin.connectedCalendarId, origin.providerEventId, 'cal-m');
    expect(await store.wasMirrorAbandoned('cal-m', key)).toBe(false);
  });

  it('returns true after explicit external mirror delete (abandoned)', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx(), event(), store, actor);
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
    const origin = [...store.events.values()].find((e) => e.eventRole === 'ORIGIN')!;
    const key = buildMirrorAbandonmentKey(origin.connectedCalendarId, origin.providerEventId, 'cal-m');
    expect(await store.wasMirrorAbandoned('cal-m', key)).toBe(true);
  });

  it('detects abandonment via abandoned status even if in-memory audit set is cleared', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx(), event(), store, actor);
    const mirror = [...store.events.values()].find((e) => e.eventRole === 'MIRROR')!;
    await store.markAbandoned(mirror.id);
    store.abandoned.clear();
    const origin = [...store.events.values()].find((e) => e.eventRole === 'ORIGIN')!;
    const key = buildMirrorAbandonmentKey(origin.connectedCalendarId, origin.providerEventId, 'cal-m');
    expect(await store.wasMirrorAbandoned('cal-m', key)).toBe(true);
  });

  it('does not treat cancelled origin-cascade mirrors as abandoned recreation blockers', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx(), event(), store, actor);
    await applyIncomingEvent(ctx(), event({ isDeleted: true, status: 'cancelled' }), store, actor);
    const origin = [...store.events.values()].find((e) => e.eventRole === 'ORIGIN')!;
    expect(origin.status).toBe('cancelled');
    const mirrors = [...store.events.values()].filter((e) => e.eventRole === 'MIRROR');
    expect(mirrors.every((m) => m.status === 'cancelled' || m.status === 'abandoned')).toBe(true);
    // Origin delete cancels mirrors; a brand-new origin id must still be allowed to create.
    const createsBefore = actor.creates.length;
    await applyIncomingEvent(ctx(), event({ providerEventId: 'origin-2' }), store, actor);
    expect(actor.creates.length).toBeGreaterThan(createsBefore);
  });

  it('does not false-abandon when there is only a temporary missing mapping', async () => {
    const { store } = setup();
    const key = buildMirrorAbandonmentKey('cal-g', 'origin-missing', 'cal-m');
    expect(await store.wasMirrorAbandoned('cal-m', key)).toBe(false);
  });

  it('duplicate external delete webhooks stay stable', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx(), event(), store, actor);
    const mirror = [...store.events.values()].find((e) => e.eventRole === 'MIRROR')!;
    const deleteIncoming = event({
      providerEventId: mirror.providerEventId,
      isDeleted: true,
      status: 'cancelled',
      unifyEventRole: 'MIRROR',
    });
    const mirrorCtx = ctx({ connectedCalendarId: 'cal-m', provider: 'MICROSOFT', connectionId: 'conn-m' });
    await applyIncomingEvent(mirrorCtx, deleteIncoming, store, actor);
    await applyIncomingEvent(mirrorCtx, deleteIncoming, store, actor);
    const createsAfter = actor.creates.length;
    await applyIncomingEvent(
      ctx(),
      event({ startAt: '2026-08-19T19:00:00.000Z', endAt: '2026-08-19T20:00:00.000Z' }),
      store,
      actor,
    );
    expect(actor.creates.length).toBe(createsAfter);
  });

  it('reconcile-style origin update does not recreate abandoned mirror', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx(), event(), store, actor);
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
    for (let i = 0; i < 3; i++) {
      await applyIncomingEvent(
        ctx(),
        event({
          startAt: `2026-08-19T${17 + i}:00:00.000Z`,
          endAt: `2026-08-19T${18 + i}:00:00.000Z`,
        }),
        store,
        actor,
      );
    }
    expect(actor.creates.length).toBe(createsAfterDelete);
  });

  it('normal mirror creation remains unaffected', async () => {
    const { store, actor } = setup();
    await applyIncomingEvent(ctx(), event(), store, actor);
    expect(actor.creates).toHaveLength(1);
    const mirror = [...store.events.values()].find((e) => e.eventRole === 'MIRROR');
    expect(mirror?.status).toBe('confirmed');
  });
});
