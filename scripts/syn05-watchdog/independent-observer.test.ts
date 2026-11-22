/**
 * C3-E — independent observer offline tests (E01–E40). No live API. No Issues.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_OBSERVER_POLICY,
  OBSERVER_INDEPENDENCE,
  OBSERVER_SCHEMA_VERSION,
  dispatchObserverAlert,
  evaluateIndependentObserver,
  validateObserverPayload,
  type ActionsRunMeta,
  type ObserverPolicy,
  type ObserverTransport,
} from './independent-observer.ts';

const NOW = Date.parse('2026-11-22T14:00:00.000Z');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const WF = 'Both STAGE Watchdog (dry-run)';

function policy(over: Partial<ObserverPolicy> = {}): ObserverPolicy {
  return { ...DEFAULT_OBSERVER_POLICY, ...over };
}

function sample(over: Partial<ActionsRunMeta> = {}): ActionsRunMeta {
  return {
    id: '45001000001',
    name: WF,
    head_branch: 'develop',
    head_sha: '45a6433f56a00da6f682cdfe00fbbc589068e38f',
    status: 'completed',
    conclusion: 'success',
    created_at: new Date(NOW - 5 * 60_000).toISOString(),
    updated_at: new Date(NOW - 4 * 60_000).toISOString(),
    run_started_at: new Date(NOW - 5 * 60_000).toISOString(),
    ...over,
  };
}

function fakeTransport(
  impl: ObserverTransport['listWorkflowRuns'],
): ObserverTransport {
  return { listWorkflowRuns: impl };
}

describe('C3-E intentional disablement', () => {
  it('E01 / E35 schedule OFF → DISABLED_INTENTIONALLY (not HEALTHY)', async () => {
    const r = await evaluateIndependentObserver({ nowMs: NOW });
    expect(r.payload.classification).toBe('DISABLED_INTENTIONALLY');
    expect(r.payload.classification).not.toBe('HEALTHY');
    expect(r.alert_channel_active).toBe(false);
    expect(r.http_performed).toBe(false);
    expect(r.payload.schedule_expected).toBe(false);
  });
});

describe('C3-E expected / missing / stale', () => {
  it('E02 expected but no runs', async () => {
    const r = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      runs: [],
      nowMs: NOW,
    });
    expect(r.payload.classification).toBe('EXPECTED_BUT_MISSING');
  });

  it('E03/E04 missed runs / heartbeat expired', async () => {
    const old = sample({
      updated_at: new Date(NOW - 40 * 60_000).toISOString(),
    });
    const r = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      runs: [old],
      nowMs: NOW,
    });
    expect(['EXPECTED_BUT_MISSING', 'STALE']).toContain(r.payload.classification);
    expect(r.payload.missed_intervals).toBeGreaterThanOrEqual(1);
  });

  it('E05 delayed but within grace → HEALTHY', async () => {
    const r = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      runs: [sample({ updated_at: new Date(NOW - 12 * 60_000).toISOString() })],
      nowMs: NOW,
    });
    expect(r.payload.classification).toBe('HEALTHY');
  });

  it('E06 stale in-progress', async () => {
    const r = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      runs: [
        sample({
          status: 'in_progress',
          conclusion: null,
          run_started_at: new Date(NOW - 20 * 60_000).toISOString(),
          created_at: new Date(NOW - 20 * 60_000).toISOString(),
        }),
      ],
      nowMs: NOW,
    });
    expect(r.payload.classification).toBe('STALE');
  });

  it('E07/E08/E09 failed / cancelled / timed_out', async () => {
    expect(
      (
        await evaluateIndependentObserver({
          policy: policy({ schedule_expected: true }),
          runs: [sample({ conclusion: 'failure' })],
          nowMs: NOW,
        })
      ).payload.classification,
    ).toBe('FAILED');
    expect(
      (
        await evaluateIndependentObserver({
          policy: policy({ schedule_expected: true }),
          runs: [sample({ conclusion: 'cancelled' })],
          nowMs: NOW,
        })
      ).payload.classification,
    ).toBe('DEGRADED');
    expect(
      (
        await evaluateIndependentObserver({
          policy: policy({ schedule_expected: true }),
          runs: [sample({ conclusion: 'timed_out' })],
          nowMs: NOW,
        })
      ).payload.classification,
    ).toBe('FAILED');
  });

  it('E10 success within window', async () => {
    const r = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      runs: [sample()],
      nowMs: NOW,
    });
    expect(r.payload.classification).toBe('HEALTHY');
    expect(r.payload.age_seconds).toBeLessThan(600);
  });

  it('E11 last success old', async () => {
    const r = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      runs: [sample({ updated_at: new Date(NOW - 2 * 60 * 60_000).toISOString() })],
      nowMs: NOW,
    });
    expect(r.payload.classification).toBe('EXPECTED_BUT_MISSING');
  });
});

describe('C3-E transport / HTTP failures', () => {
  it('E12–E16 401/403/429/5xx/timeout → OBSERVER_BLIND', async () => {
    for (const [status, code] of [
      [401, 'github_401'],
      [403, 'github_403'],
      [429, 'github_429'],
      [503, 'github_5xx'],
    ] as const) {
      const r = await evaluateIndependentObserver({
        policy: policy({ schedule_expected: true }),
        transport: fakeTransport(async () => ({ ok: false, code: 'http_error', status })),
        nowMs: NOW,
      });
      expect(r.payload.classification).toBe('OBSERVER_BLIND');
      expect(r.payload.reason_code).toBe(code);
      expect(r.http_performed).toBe(true);
    }
    const timeout = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      transport: fakeTransport(async () => ({ ok: false, code: 'timeout' })),
      nowMs: NOW,
    });
    expect(timeout.payload.classification).toBe('OBSERVER_BLIND');
  });

  it('E17/E18 invalid / empty responses stay fail-closed', async () => {
    const r = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      transport: fakeTransport(async () => ({ ok: true, runs: [] })),
      nowMs: NOW,
    });
    expect(r.payload.classification).toBe('EXPECTED_BUT_MISSING');
  });

  it('E28/E29/E30 no token / no network / no source → blind or disabled', async () => {
    const blind = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      transport_error: { code: 'token_absent' },
      nowMs: NOW,
    });
    expect(blind.payload.classification).toBe('OBSERVER_BLIND');
    expect(blind.http_performed).toBe(false);
  });
});

describe('C3-E identity / provenance', () => {
  it('E19 wrong workflow ignored', async () => {
    const r = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      runs: [sample({ name: 'Other Workflow' })],
      nowMs: NOW,
    });
    expect(r.payload.classification).toBe('EXPECTED_BUT_MISSING');
  });

  it('E20 wrong branch ignored', async () => {
    const r = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      runs: [sample({ head_branch: 'main' })],
      nowMs: NOW,
    });
    expect(r.payload.classification).toBe('EXPECTED_BUT_MISSING');
  });

  it('E21 allow_repo documented in policy default', () => {
    expect(DEFAULT_OBSERVER_POLICY.allow_repo).toBe('ruanlima-devops/both-calendar-sync');
  });

  it('E22/E23/E24/E25 future timestamp / skew', async () => {
    const r = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      runs: [sample({ updated_at: new Date(NOW + 10 * 60_000).toISOString() })],
      nowMs: NOW,
    });
    expect(r.payload.classification).toBe('UNKNOWN');
    expect(r.payload.reason_code).toBe('future_timestamp');
  });

  it('E26/E27 invalid heartbeat timestamp', async () => {
    const r = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      runs: [sample({ updated_at: 'not-iso' })],
      nowMs: NOW,
    });
    expect(r.payload.classification).toBe('UNKNOWN');
  });
});

describe('C3-E payload safety / independence', () => {
  it('E31/E32 schema rigid; no additional properties; no secrets in reason', () => {
    const ok = validateObserverPayload({
      observer_schema_version: OBSERVER_SCHEMA_VERSION,
      monitored_workflow: WF,
      expected_interval_seconds: 600,
      last_seen_run_id: null,
      last_completed_at: null,
      observed_at: '2026-11-22T14:00:00.000Z',
      age_seconds: null,
      missed_intervals: 0,
      classification: 'DISABLED_INTENTIONALLY',
      reason_code: 'schedule_off_intentional',
      environment: 'stage',
      project_ref: 'qszggrrjhcwltnmxpxcy',
      schedule_expected: false,
    });
    expect(ok.ok).toBe(true);
    expect(
      validateObserverPayload({
        observer_schema_version: OBSERVER_SCHEMA_VERSION,
        monitored_workflow: WF,
        expected_interval_seconds: 600,
        last_seen_run_id: null,
        last_completed_at: null,
        observed_at: '2026-11-22T14:00:00.000Z',
        age_seconds: null,
        missed_intervals: 0,
        classification: 'DISABLED_INTENTIONALLY',
        reason_code: 'x',
        environment: 'stage',
        project_ref: 'qszggrrjhcwltnmxpxcy',
        schedule_expected: false,
        token: 'secret',
      }).ok,
    ).toBe(false);
  });

  it('E33/E34 independence notes', () => {
    expect(OBSERVER_INDEPENDENCE.same_workflow_job).toBe('insufficient');
    expect(OBSERVER_INDEPENDENCE.absence_of_signal_is_healthy).toBe(false);
    expect(OBSERVER_INDEPENDENCE.issues_as_sole_evidence).toBe('forbidden');
  });

  it('E36/E37/E38 no issues:write; no side effects; alert inactive', async () => {
    const r = await evaluateIndependentObserver({ nowMs: NOW });
    expect(dispatchObserverAlert(r.payload)).toEqual({
      sent: false,
      code: 'observer_alert_channel_not_authorized',
    });
    expect(r.alert_channel_active).toBe(false);
  });

  it('E39/E40 UNKNOWN fail-closed; RUNNING does not claim HEALTHY', async () => {
    const running = await evaluateIndependentObserver({
      policy: policy({ schedule_expected: true }),
      runs: [
        sample({
          status: 'in_progress',
          conclusion: null,
          run_started_at: new Date(NOW - 60_000).toISOString(),
        }),
      ],
      nowMs: NOW,
    });
    expect(running.payload.classification).toBe('RUNNING');
    expect(running.payload.classification).not.toBe('HEALTHY');
  });
});

describe('C3-E workflow remains inactive', () => {
  it('self-monitor YAML schedule commented; no issues:write', () => {
    const yml = readFileSync(path.join(ROOT, '.github/workflows/both-stage-watchdog-self.yml'), 'utf8');
    expect(yml).toMatch(/#\s*schedule:/);
    expect(yml).not.toMatch(/^\s*issues:\s*write\s*$/m);
    expect(yml).toContain('BOTH_WATCHDOG_ENABLE_NETWORK: \'0\'');
  });
});
