import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createFakeDb } from '../testing/fake-db.ts';
import {
  computeEntitlement,
  evaluateSyncEntitlement,
  pauseIntegrationsForUser,
  type SubscriptionRow,
} from './entitlement.ts';
import {
  finalizeSyncJobBlockedByEntitlement,
  finalizeSyncJobEntitlementUnavailable,
  processSyncJob,
  syncConnectedCalendar,
} from '../sync/runtime.ts';

const ROOT = path.resolve(__dirname, '../../../..');

const USER = 'user-entitled';
const USER_EXPIRED = 'user-expired';
const NOW = new Date('2026-11-17T12:00:00.000Z');

function sub(overrides: Partial<SubscriptionRow> & { user_id: string }): SubscriptionRow {
  return {
    plan_id: 'unify_pro',
    status: 'trialing',
    trial_started_at: '2026-11-01T00:00:00.000Z',
    trial_ends_at: '2026-12-01T00:00:00.000Z',
    current_period_start: null,
    current_period_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    grace_period_ends_at: null,
    billing_provider: 'stripe',
    billing_customer_id: null,
    billing_subscription_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('BIL-02 evaluateSyncEntitlement contract', () => {
  it('allows valid trial', async () => {
    const { db } = createFakeDb({
      user_subscriptions: [sub({ user_id: USER, status: 'trialing', trial_ends_at: '2026-12-01T00:00:00.000Z' })],
    });
    const gate = await evaluateSyncEntitlement(db, USER, NOW);
    expect(gate.allow).toBe(true);
    if (gate.allow) expect(gate.entitlement.source).toBe('trial');
  });

  it('allows active subscription', async () => {
    const { db } = createFakeDb({
      user_subscriptions: [sub({ user_id: USER, status: 'active' })],
    });
    const gate = await evaluateSyncEntitlement(db, USER, NOW);
    expect(gate.allow).toBe(true);
    if (gate.allow) expect(gate.entitlement.source).toBe('subscription');
  });

  it('blocks expired trial (status expired)', async () => {
    const { db } = createFakeDb({
      user_subscriptions: [sub({ user_id: USER_EXPIRED, status: 'expired', trial_ends_at: '2026-11-01T00:00:00.000Z' })],
    });
    const gate = await evaluateSyncEntitlement(db, USER_EXPIRED, NOW);
    expect(gate).toEqual({
      allow: false,
      reason: 'blocked_by_entitlement',
      entitlement: expect.objectContaining({ hasAccess: false }),
    });
  });

  it('blocks trialing row whose trial_ends_at already passed', async () => {
    const { db } = createFakeDb({
      user_subscriptions: [
        sub({ user_id: USER_EXPIRED, status: 'trialing', trial_ends_at: '2026-11-16T00:00:00.000Z' }),
      ],
    });
    const gate = await evaluateSyncEntitlement(db, USER_EXPIRED, NOW);
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect(gate.reason).toBe('blocked_by_entitlement');
  });

  it('blocks past_due / incomplete outside grace', async () => {
    const { db } = createFakeDb({
      user_subscriptions: [
        sub({
          user_id: USER_EXPIRED,
          status: 'past_due',
          grace_period_ends_at: '2026-11-01T00:00:00.000Z',
        }),
      ],
    });
    const gate = await evaluateSyncEntitlement(db, USER_EXPIRED, NOW);
    expect(gate.allow).toBe(false);
  });

  it('blocks missing entitlement row', async () => {
    const { db } = createFakeDb({ user_subscriptions: [] });
    const gate = await evaluateSyncEntitlement(db, 'ghost-user', NOW);
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect(gate.reason).toBe('blocked_by_entitlement');
  });

  it('blocks when entitlement lookup fails (fail-closed)', async () => {
    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'db_unavailable' } }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const gate = await evaluateSyncEntitlement(broken, USER, NOW);
    expect(gate.allow).toBe(false);
    if (!gate.allow) expect(gate.reason).toBe('entitlement_lookup_failed');
  });

  it('allows again after reactivation (active)', async () => {
    const { db, tables } = createFakeDb({
      user_subscriptions: [sub({ user_id: USER, status: 'expired', trial_ends_at: '2026-11-01T00:00:00.000Z' })],
    });
    expect((await evaluateSyncEntitlement(db, USER, NOW)).allow).toBe(false);
    tables.user_subscriptions[0]!.status = 'active';
    tables.user_subscriptions[0]!.current_period_end = '2027-01-01T00:00:00.000Z';
    const gate = await evaluateSyncEntitlement(db, USER, NOW);
    expect(gate.allow).toBe(true);
  });

  it('does not treat paused_by_entitlement alone as source of truth', () => {
    // Flag is derived; computeEntitlement ignores it entirely.
    const entitlement = computeEntitlement(
      sub({ user_id: USER, status: 'active' }),
      NOW,
    );
    expect(entitlement.hasAccess).toBe(true);
  });
});

describe('BIL-02 finalizeSyncJobBlockedByEntitlement', () => {
  it('marks job failed, pauses connections, preserves other users and events', async () => {
    const { db, tables } = createFakeDb({
      sync_jobs: [
        {
          id: 'job-1',
          user_id: USER_EXPIRED,
          connection_id: 'c1',
          connected_calendar_id: 'cal-1',
          status: 'running',
          error: null,
        },
      ],
      calendar_connections: [
        { id: 'c1', user_id: USER_EXPIRED, paused_by_entitlement: false, provider: 'GOOGLE' },
        { id: 'c-other', user_id: USER, paused_by_entitlement: false, provider: 'GOOGLE' },
      ],
      calendar_events: [
        { id: 'evt-1', user_id: USER_EXPIRED, title: 'keep-me' },
        { id: 'evt-2', user_id: USER, title: 'other' },
      ],
    });

    await finalizeSyncJobBlockedByEntitlement(
      db,
      {
        id: 'job-1',
        user_id: USER_EXPIRED,
        connection_id: 'c1',
        connected_calendar_id: 'cal-1',
      },
      'blocked_by_entitlement',
    );

    expect(tables.sync_jobs[0]).toMatchObject({
      status: 'failed',
      error: 'blocked_by_entitlement',
    });
    expect(tables.sync_jobs[0]?.completed_at).toBeTruthy();
    expect(tables.calendar_connections.find((c) => c.id === 'c1')?.paused_by_entitlement).toBe(true);
    expect(tables.calendar_connections.find((c) => c.id === 'c-other')?.paused_by_entitlement).toBe(false);
    expect(tables.calendar_events.map((e) => e.id).sort()).toEqual(['evt-1', 'evt-2']);
  });

  it('is idempotent on paused flag (no infinite churn)', async () => {
    const { db, tables } = createFakeDb({
      sync_jobs: [{ id: 'job-2', user_id: USER_EXPIRED, status: 'running' }],
      calendar_connections: [
        { id: 'c1', user_id: USER_EXPIRED, paused_by_entitlement: true, provider: 'GOOGLE' },
      ],
    });
    await finalizeSyncJobBlockedByEntitlement(
      db,
      { id: 'job-2', user_id: USER_EXPIRED },
      'blocked_by_entitlement',
    );
    await finalizeSyncJobBlockedByEntitlement(
      db,
      { id: 'job-2', user_id: USER_EXPIRED },
      'blocked_by_entitlement',
    );
    expect(tables.calendar_connections[0]?.paused_by_entitlement).toBe(true);
    expect(tables.sync_jobs[0]?.error).toBe('blocked_by_entitlement');
  });
});

describe('BIL-02 processSyncJob entitlement enforcement', () => {
  it('blocks expired retry of an old pending job without external sync', async () => {
    const { db, tables } = createFakeDb({
      user_subscriptions: [sub({ user_id: USER_EXPIRED, status: 'expired' })],
      calendar_connections: [
        {
          id: 'c1',
          user_id: USER_EXPIRED,
          status: 'CONNECTED',
          paused_by_entitlement: false,
          provider: 'GOOGLE',
        },
      ],
      sync_jobs: [
        {
          id: 'job-old',
          user_id: USER_EXPIRED,
          connection_id: 'c1',
          connected_calendar_id: 'cal-1',
          status: 'pending',
          reason: 'google_webhook',
          dedupe_key: 'google:cal-1:1',
        },
      ],
      connected_calendars: [],
      sync_log: [],
    });

    await processSyncJob(db, 'job-old');

    expect(tables.sync_jobs[0]).toMatchObject({
      status: 'failed',
      error: 'blocked_by_entitlement',
    });
    expect(tables.calendar_connections[0]?.paused_by_entitlement).toBe(true);
    // Job left terminal — a second processSyncJob is a no-op (not pending) → no retry loop.
    await processSyncJob(db, 'job-old');
    expect(tables.sync_jobs.filter((j) => j.id === 'job-old')).toHaveLength(1);
    expect(tables.sync_jobs[0]?.status).toBe('failed');
  });

  it('concurrent jobs observe entitlement transition mid-flight', async () => {
    const { db, tables } = createFakeDb({
      user_subscriptions: [sub({ user_id: USER, status: 'trialing', trial_ends_at: '2026-12-01T00:00:00.000Z' })],
      calendar_connections: [
        { id: 'c1', user_id: USER, status: 'CONNECTED', paused_by_entitlement: false, provider: 'GOOGLE' },
        { id: 'c2', user_id: USER, status: 'CONNECTED', paused_by_entitlement: false, provider: 'MICROSOFT' },
      ],
      sync_jobs: [
        {
          id: 'job-a',
          user_id: USER,
          connection_id: 'c1',
          connected_calendar_id: null,
          status: 'pending',
          reason: 'reconcile',
          dedupe_key: 'a',
        },
        {
          id: 'job-b',
          user_id: USER,
          connection_id: 'c2',
          connected_calendar_id: null,
          status: 'pending',
          reason: 'reconcile',
          dedupe_key: 'b',
        },
      ],
      connected_calendars: [],
    });

    await processSyncJob(db, 'job-a');
    expect(tables.sync_jobs.find((j) => j.id === 'job-a')?.status).toBe('completed');

    tables.user_subscriptions[0]!.status = 'expired';
    tables.user_subscriptions[0]!.trial_ends_at = '2026-11-01T00:00:00.000Z';

    await processSyncJob(db, 'job-b');
    expect(tables.sync_jobs.find((j) => j.id === 'job-b')).toMatchObject({
      status: 'failed',
      error: 'blocked_by_entitlement',
    });
  });

  it('allows trial user job to proceed past entitlement gate to sync path', async () => {
    const { db, tables } = createFakeDb({
      user_subscriptions: [sub({ user_id: USER, status: 'trialing', trial_ends_at: '2026-12-01T00:00:00.000Z' })],
      calendar_connections: [
        { id: 'c1', user_id: USER, status: 'CONNECTED', paused_by_entitlement: false, provider: 'GOOGLE' },
      ],
      sync_jobs: [
        {
          id: 'job-ok',
          user_id: USER,
          connection_id: 'c1',
          connected_calendar_id: null,
          status: 'pending',
          reason: 'reconcile',
          dedupe_key: 'reconcile:c1',
        },
      ],
      connected_calendars: [],
    });

    // No enabled calendars → sync loop is empty; job completes without provider calls.
    await processSyncJob(db, 'job-ok');
    expect(tables.sync_jobs[0]?.status).toBe('completed');
    expect(tables.calendar_connections[0]?.paused_by_entitlement).toBe(false);
  });

  it('blocks deleted-account style missing connection without sync', async () => {
    const { db, tables } = createFakeDb({
      user_subscriptions: [sub({ user_id: USER, status: 'active' })],
      calendar_connections: [],
      sync_jobs: [
        {
          id: 'job-gone',
          user_id: USER,
          connection_id: 'missing',
          connected_calendar_id: 'cal-1',
          status: 'pending',
        },
      ],
    });
    await processSyncJob(db, 'job-gone');
    expect(tables.sync_jobs[0]).toMatchObject({ status: 'failed', error: 'connection_gone' });
  });
});

describe('BIL-02 syncConnectedCalendar gate', () => {
  it('throws ENTITLEMENT_REQUIRED for expired before external work', async () => {
    const { db } = createFakeDb({
      user_subscriptions: [sub({ user_id: USER_EXPIRED, status: 'expired' })],
      connected_calendars: [
        {
          id: 'cal-1',
          user_id: USER_EXPIRED,
          connection_id: 'c1',
          enabled: true,
          provider_calendar_id: 'ext',
          name: 'Primary',
          calendar_connections: {
            id: 'c1',
            user_id: USER_EXPIRED,
            provider: 'GOOGLE',
            status: 'CONNECTED',
          },
        },
      ],
      calendar_connections: [
        { id: 'c1', user_id: USER_EXPIRED, provider: 'GOOGLE', status: 'CONNECTED', paused_by_entitlement: false },
      ],
      calendar_firewall_rules: [],
      calendar_secrets: [],
    });

    // loadSyncContext uses !inner join shape; fake-db stores nested object on row for select('*').
    await expect(syncConnectedCalendar(db, 'cal-1', 'auto')).rejects.toThrow(/ENTITLEMENT_REQUIRED|calendar_not_found/);
  });
});

describe('BIL-02 transient entitlement lookup', () => {
  it('does not pause integrations on lookup failure finalize', async () => {
    const { db, tables } = createFakeDb({
      sync_jobs: [
        {
          id: 'job-t',
          user_id: USER,
          connection_id: 'c1',
          connected_calendar_id: 'cal-1',
          status: 'running',
        },
      ],
      calendar_connections: [
        { id: 'c1', user_id: USER, paused_by_entitlement: false, provider: 'GOOGLE' },
      ],
      sync_state: [
        {
          connected_calendar_id: 'cal-1',
          google_sync_token: 'cursor-preserved',
          microsoft_delta_link: null,
        },
      ],
    });

    await finalizeSyncJobEntitlementUnavailable(db, {
      id: 'job-t',
      user_id: USER,
      connection_id: 'c1',
      connected_calendar_id: 'cal-1',
    });

    expect(tables.sync_jobs[0]).toMatchObject({
      status: 'failed',
      error: 'entitlement_lookup_failed',
    });
    expect(tables.calendar_connections[0]?.paused_by_entitlement).toBe(false);
    expect(tables.sync_state[0]?.google_sync_token).toBe('cursor-preserved');
  });

  it('processSyncJob lookup timeout is fail-closed without pause or cursor advance', async () => {
    const { db: base, tables } = createFakeDb({
      user_subscriptions: [sub({ user_id: USER, status: 'active' })],
      calendar_connections: [
        { id: 'c1', user_id: USER, status: 'CONNECTED', paused_by_entitlement: false, provider: 'GOOGLE' },
      ],
      sync_jobs: [
        {
          id: 'job-transient',
          user_id: USER,
          connection_id: 'c1',
          connected_calendar_id: null,
          status: 'pending',
        },
      ],
      connected_calendars: [],
      sync_state: [{ connected_calendar_id: 'cal-x', google_sync_token: 'tok' }],
    });

    const db = {
      from(table: string) {
        if (table === 'user_subscriptions') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: { message: 'timeout' } }),
              }),
            }),
          };
        }
        return base.from(table);
      },
    } as unknown as SupabaseClient;

    await processSyncJob(db, 'job-transient');
    expect(tables.sync_jobs[0]).toMatchObject({
      status: 'failed',
      error: 'entitlement_lookup_failed',
    });
    expect(tables.calendar_connections[0]?.paused_by_entitlement).toBe(false);
    expect(tables.sync_state[0]?.google_sync_token).toBe('tok');
  });

  it('webhook sources distinguish transient vs blocked without always pausing', () => {
    const google = readFileSync(path.join(ROOT, 'supabase/functions/google-webhook/index.ts'), 'utf8');
    const ms = readFileSync(path.join(ROOT, 'supabase/functions/microsoft-webhook/index.ts'), 'utf8');
    for (const src of [google, ms]) {
      expect(src).toContain("gate.reason === 'blocked_by_entitlement'");
      expect(src).toContain('entitlement_lookup_failed');
      expect(src).toContain('transient:');
    }
  });
});

describe('BIL-02 event recovery / catch-up after reactivation', () => {
  it('blocked path does not advance sync cursors (no sync_state write)', async () => {
    const { db, tables } = createFakeDb({
      user_subscriptions: [sub({ user_id: USER_EXPIRED, status: 'expired' })],
      calendar_connections: [
        { id: 'c1', user_id: USER_EXPIRED, status: 'CONNECTED', paused_by_entitlement: false, provider: 'GOOGLE' },
      ],
      sync_jobs: [
        {
          id: 'job-block',
          user_id: USER_EXPIRED,
          connection_id: 'c1',
          connected_calendar_id: 'cal-1',
          status: 'pending',
        },
      ],
      sync_state: [
        {
          connected_calendar_id: 'cal-1',
          google_sync_token: 'pre-block-token',
          microsoft_delta_link: 'pre-block-delta',
          last_success_at: '2026-11-16T00:00:00.000Z',
        },
      ],
      connected_calendars: [],
      calendar_events: [{ id: 'evt-keep', user_id: USER_EXPIRED, title: 'existing' }],
    });

    await processSyncJob(db, 'job-block');
    expect(tables.sync_jobs[0]?.error).toBe('blocked_by_entitlement');
    expect(tables.sync_state[0]).toMatchObject({
      google_sync_token: 'pre-block-token',
      microsoft_delta_link: 'pre-block-delta',
      last_success_at: '2026-11-16T00:00:00.000Z',
    });
    expect(tables.calendar_events).toHaveLength(1);
  });

  it('reactivation allows subsequent reconcile-style job without duplicating terminal blocked job', async () => {
    const { db, tables } = createFakeDb({
      user_subscriptions: [sub({ user_id: USER, status: 'expired' })],
      calendar_connections: [
        { id: 'c1', user_id: USER, status: 'CONNECTED', paused_by_entitlement: true, provider: 'GOOGLE' },
        { id: 'c2', user_id: USER, status: 'CONNECTED', paused_by_entitlement: true, provider: 'MICROSOFT' },
      ],
      sync_jobs: [
        {
          id: 'job-blocked-g',
          user_id: USER,
          connection_id: 'c1',
          connected_calendar_id: null,
          status: 'pending',
          dedupe_key: 'old-g',
        },
      ],
      connected_calendars: [],
      sync_state: [
        { connected_calendar_id: 'cal-g', google_sync_token: 'g-token' },
        { connected_calendar_id: 'cal-m', microsoft_delta_link: 'm-delta' },
      ],
    });

    await processSyncJob(db, 'job-blocked-g');
    expect(tables.sync_jobs[0]?.status).toBe('failed');

    tables.user_subscriptions[0]!.status = 'active';
    tables.user_subscriptions[0]!.current_period_end = '2027-01-01T00:00:00.000Z';
    await db
      .from('calendar_connections')
      .update({ paused_by_entitlement: false })
      .eq('user_id', USER);

    tables.sync_jobs.push({
      id: 'job-reconcile-after',
      user_id: USER,
      connection_id: 'c1',
      connected_calendar_id: null,
      status: 'pending',
      reason: 'reconcile',
      dedupe_key: 'reconcile:c1:after',
    });
    tables.sync_jobs.push({
      id: 'job-reconcile-ms',
      user_id: USER,
      connection_id: 'c2',
      connected_calendar_id: null,
      status: 'pending',
      reason: 'reconcile',
      dedupe_key: 'reconcile:c2:after',
    });

    await processSyncJob(db, 'job-reconcile-after');
    await processSyncJob(db, 'job-reconcile-ms');

    expect(tables.sync_jobs.find((j) => j.id === 'job-reconcile-after')?.status).toBe('completed');
    expect(tables.sync_jobs.find((j) => j.id === 'job-reconcile-ms')?.status).toBe('completed');
    expect(tables.sync_jobs.find((j) => j.id === 'job-blocked-g')?.status).toBe('failed');
    expect(tables.sync_state.map((s) => s.google_sync_token || s.microsoft_delta_link).sort()).toEqual([
      'g-token',
      'm-delta',
    ]);
  });

  it('documents catch-up independence from webhook replay (reconcile + sync-now source)', () => {
    const reconcile = readFileSync(path.join(ROOT, 'supabase/functions/reconcile-sync/index.ts'), 'utf8');
    const syncNow = readFileSync(path.join(ROOT, 'supabase/functions/sync-now/index.ts'), 'utf8');
    expect(reconcile).toContain("reason: 'reconcile'");
    expect(reconcile).toContain('getEntitlement');
    expect(syncNow).toContain('syncConnectedCalendar');
    expect(syncNow).toContain('requireEntitlement');
  });
});

describe('BIL-02 pauseIntegrations coherence', () => {
  it('pause then resume keeps flag coherent across reactivation', async () => {
    const { db, tables } = createFakeDb({
      calendar_connections: [
        { id: 'c1', user_id: USER, paused_by_entitlement: false },
      ],
    });
    await pauseIntegrationsForUser(db, USER);
    expect(tables.calendar_connections[0]?.paused_by_entitlement).toBe(true);
    await db
      .from('calendar_connections')
      .update({ paused_by_entitlement: false })
      .eq('user_id', USER)
      .eq('paused_by_entitlement', true);
    expect(tables.calendar_connections[0]?.paused_by_entitlement).toBe(false);
  });
});

describe('BIL-02 entrypoint wiring (source contracts)', () => {
  it('google-webhook evaluates entitlement before enqueue', () => {
    const src = readFileSync(path.join(ROOT, 'supabase/functions/google-webhook/index.ts'), 'utf8');
    expect(src).toContain('evaluateSyncEntitlement');
    expect(src.indexOf('evaluateSyncEntitlement')).toBeLessThan(src.indexOf('enqueueSync'));
    expect(src).toContain("skipped: gate.reason");
  });

  it('microsoft-webhook evaluates entitlement before enqueue', () => {
    const src = readFileSync(path.join(ROOT, 'supabase/functions/microsoft-webhook/index.ts'), 'utf8');
    expect(src).toContain('evaluateSyncEntitlement');
    expect(src.indexOf('evaluateSyncEntitlement')).toBeLessThan(src.indexOf('enqueueSync'));
    expect(src).toContain('skipped_entitlement');
  });

  it('reconcile-sync keeps getEntitlement skip and processSyncJob central gate', () => {
    const src = readFileSync(path.join(ROOT, 'supabase/functions/reconcile-sync/index.ts'), 'utf8');
    expect(src).toContain('getEntitlement');
    expect(src).toContain('processSyncJob');
    expect(src).toMatch(/if\s*\(\s*!entitlement\.hasAccess\s*\)\s*continue/);
  });

  it('runtime processSyncJob and syncConnectedCalendar call evaluateSyncEntitlement', () => {
    const src = readFileSync(path.join(ROOT, 'supabase/functions/_shared/sync/runtime.ts'), 'utf8');
    expect(src).toContain('evaluateSyncEntitlement');
    expect(src).toContain('finalizeSyncJobBlockedByEntitlement');
    expect(src).toContain('ENTITLEMENT_REQUIRED');
  });

  it('sync-now still requires entitlement for manual sync', () => {
    const src = readFileSync(path.join(ROOT, 'supabase/functions/sync-now/index.ts'), 'utf8');
    expect(src).toContain('requireEntitlement');
  });

  it('icloud-poll keeps entitlement skip before enqueue', () => {
    const src = readFileSync(path.join(ROOT, 'supabase/functions/icloud-poll/index.ts'), 'utf8');
    expect(src).toContain('getEntitlement');
    expect(src).toMatch(/if\s*\(\s*!entitlement\.hasAccess\s*\)\s*continue/);
  });
});
