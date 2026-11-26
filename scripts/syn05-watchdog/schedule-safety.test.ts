/**
 * C3-D — offline schedule safety tests (D01–D32). No network. No Issues.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SCHEDULE_POLICY,
  DOCUMENTED_SAFE_INTERVAL_MINUTES,
  resolveSchedulePolicy,
  validateSchedulePolicy,
  type SchedulePolicyV1,
} from './schedule-policy.ts';
import {
  assertC0ScheduleInvariants,
  buildRunIdentity,
  countMissedIntervals,
  detectDuplicateRunIds,
  detectOutOfOrder,
  detectOverlap,
  evaluateScheduleSafety,
  evaluateWhenEnabled,
  mayAdvanceHealthyFromSchedule,
  type WatchdogRunSample,
} from './schedule-safety.ts';

const NOW = Date.parse('2026-11-22T12:00:00.000Z');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const WF = 'Both STAGE Watchdog (dry-run)';
const SHA = '24c20c11f3a07872feadff2288806b07482694bb';

function enabledPolicy(over: Partial<SchedulePolicyV1> = {}): SchedulePolicyV1 & { schedule_enabled: boolean } {
  return {
    ...DEFAULT_SCHEDULE_POLICY,
    ...over,
    schedule_enabled: true as unknown as false,
  } as SchedulePolicyV1 & { schedule_enabled: boolean };
}

function run(over: Partial<WatchdogRunSample> = {}): WatchdogRunSample {
  return {
    run_id: '45000000001',
    source_commit_sha: SHA,
    workflow_name: WF,
    environment: 'stage',
    project_ref: 'qszggrrjhcwltnmxpxcy',
    started_at: new Date(NOW - 5 * 60_000).toISOString(),
    completed_at: new Date(NOW - 4 * 60_000).toISOString(),
    status: 'completed',
    conclusion: 'success',
    ...over,
  };
}

describe('C3-D schedule policy', () => {
  it('D25 fail-closed without / invalid configuration', () => {
    expect(validateSchedulePolicy(null).ok).toBe(false);
    expect(validateSchedulePolicy({}).ok).toBe(false);
    expect(resolveSchedulePolicy().ok).toBe(true);
    expect(DEFAULT_SCHEDULE_POLICY.schedule_enabled).toBe(false);
    expect(DEFAULT_SCHEDULE_POLICY.interval_minutes).toBe(DOCUMENTED_SAFE_INTERVAL_MINUTES);
    expect(DEFAULT_SCHEDULE_POLICY.cancel_in_progress).toBe(false);
  });

  it('D22/D23/D24 C0 invariants: schedule OFF, no write/network', () => {
    expect(assertC0ScheduleInvariants({})).toBeNull();
    expect(assertC0ScheduleInvariants({ BOTH_WATCHDOG_GITHUB_WRITE: '1' })).toBe('write_must_be_0');
    expect(assertC0ScheduleInvariants({ BOTH_WATCHDOG_ENABLE_NETWORK: '1' })).toBe('network_must_be_0');
    expect(assertC0ScheduleInvariants({ BOTH_WATCHDOG_SCHEDULE_ENABLED: '1' })).toBe('schedule_must_be_off');
    expect(assertC0ScheduleInvariants({ BOTH_WATCHDOG_DRY_RUN: '0' })).toBe('dry_run_must_be_1');
  });

  it('D26 concurrency group must include STAGE project ref', () => {
    const bad = validateSchedulePolicy({
      ...DEFAULT_SCHEDULE_POLICY,
      concurrency_group: 'wrong-group',
    });
    expect(bad.ok).toBe(false);
  });

  it('rejects enabling schedule in validated policy', () => {
    const bad = validateSchedulePolicy({
      ...DEFAULT_SCHEDULE_POLICY,
      schedule_enabled: true,
    });
    expect(bad.ok).toBe(false);
  });
});

describe('C3-D default evaluation remains DISABLED', () => {
  it('D22 evaluateScheduleSafety with defaults → SCHEDULE_DISABLED', () => {
    const r = evaluateScheduleSafety({ history: [], nowMs: NOW });
    expect(r.classification).toBe('SCHEDULE_DISABLED');
    expect(r.may_advance_healthy).toBe(false);
    expect(mayAdvanceHealthyFromSchedule(r)).toBe(false);
    expect(r.evaluation_status).toBe('DATA_UNAVAILABLE');
  });
});

describe('C3-D run identity', () => {
  it('D21 rejects missing/invalid run identity', () => {
    const id = buildRunIdentity({
      run: run({ run_id: '' }),
      policy: DEFAULT_SCHEDULE_POLICY,
      nowMs: NOW,
    });
    expect(id).toEqual({ error: 'run_id_invalid' });
  });

  it('builds deterministic run_key', () => {
    const id = buildRunIdentity({ run: run(), policy: DEFAULT_SCHEDULE_POLICY, nowMs: NOW });
    expect('error' in id).toBe(false);
    if ('error' in id) return;
    expect(id.run_key).toContain(SHA.slice(0, 12));
    expect(id.run_key).toContain('45000000001');
  });
});

describe('C3-D missed / delay / stale (enabled simulation)', () => {
  it('D01 on-time success', () => {
    const last = run({
      completed_at: new Date(NOW - 3 * 60_000).toISOString(),
      started_at: new Date(NOW - 4 * 60_000).toISOString(),
    });
    const r = evaluateWhenEnabled({
      policy: enabledPolicy(),
      history: [last],
      current: last,
      nowMs: NOW,
    });
    expect(r.classification).toBe('ON_TIME');
    expect(r.may_advance_healthy).toBe(false);
  });

  it('D02 delayed within budget', () => {
    const last = run({
      completed_at: new Date(NOW - 12 * 60_000).toISOString(),
    });
    const r = evaluateWhenEnabled({
      policy: enabledPolicy(),
      history: [last],
      current: null,
      nowMs: NOW,
    });
    expect(r.classification).toBe('DELAYED');
  });

  it('D03 one missed run', () => {
    const last = run({
      completed_at: new Date(NOW - 20 * 60_000).toISOString(),
    });
    const r = evaluateWhenEnabled({
      policy: enabledPolicy(),
      history: [last],
      current: null,
      nowMs: NOW,
    });
    expect(r.classification).toBe('MISSED');
    expect(r.missed_intervals).toBeGreaterThanOrEqual(1);
  });

  it('D04 two missed runs', () => {
    const { missed } = countMissedIntervals({
      lastCompletedAt: new Date(NOW - 35 * 60_000).toISOString(),
      nowMs: NOW,
      intervalMs: 10 * 60_000,
      delayMs: 5 * 60_000,
      threshold: 1,
    });
    expect(missed).toBeGreaterThanOrEqual(2);
  });

  it('D05 stale in-progress', () => {
    const current = run({
      status: 'in_progress',
      conclusion: null,
      completed_at: null,
      started_at: new Date(NOW - 20 * 60_000).toISOString(),
    });
    const r = evaluateWhenEnabled({
      policy: enabledPolicy(),
      history: [],
      current,
      nowMs: NOW,
    });
    expect(r.classification).toBe('STALE');
    expect(r.evaluation_status).toBe('FIRING');
  });

  it('D06 cancelled', () => {
    const current = run({ conclusion: 'cancelled' });
    const r = evaluateWhenEnabled({
      policy: enabledPolicy(),
      history: [],
      current,
      nowMs: NOW,
    });
    expect(r.classification).toBe('CANCELLED');
  });

  it('D07 duplicate run ids', () => {
    expect(detectDuplicateRunIds([run(), run()])).toBe(true);
    const r = evaluateWhenEnabled({
      policy: enabledPolicy(),
      history: [run(), run({ started_at: new Date(NOW - 1).toISOString() })],
      current: null,
      nowMs: NOW,
    });
    expect(r.classification).toBe('DUPLICATE');
  });

  it('D08 out of order completions', () => {
    const a = run({
      run_id: '1',
      started_at: '2026-11-22T11:00:00.000Z',
      completed_at: '2026-11-22T11:50:00.000Z',
    });
    const b = run({
      run_id: '2',
      started_at: '2026-11-22T11:10:00.000Z',
      completed_at: '2026-11-22T11:20:00.000Z',
    });
    expect(detectOutOfOrder([a, b])).toBe(true);
  });

  it('D09 overlap of in-progress runs', () => {
    const a = run({
      run_id: '1',
      status: 'in_progress',
      conclusion: null,
      completed_at: null,
      started_at: new Date(NOW - 2 * 60_000).toISOString(),
    });
    const b = run({
      run_id: '2',
      status: 'in_progress',
      conclusion: null,
      completed_at: null,
      started_at: new Date(NOW - 1 * 60_000).toISOString(),
    });
    expect(detectOverlap([a, b], NOW)).toBe(true);
    const r = evaluateWhenEnabled({
      policy: enabledPolicy({ overlap_policy: 'unknown_on_overlap' }),
      history: [a, b],
      current: null,
      nowMs: NOW,
    });
    expect(r.classification).toBe('UNKNOWN');
    expect(r.may_advance_healthy).toBe(false);
  });

  it('D10 retry after failure does not auto-HEALTHY', () => {
    const failed = run({ run_id: '1', conclusion: 'failure' });
    const ok = run({
      run_id: '2',
      started_at: new Date(NOW - 3 * 60_000).toISOString(),
      completed_at: new Date(NOW - 2 * 60_000).toISOString(),
    });
    const r = evaluateWhenEnabled({
      policy: enabledPolicy(),
      history: [failed, ok],
      current: ok,
      nowMs: NOW,
    });
    expect(r.may_advance_healthy).toBe(false);
    expect(r.evaluation_status).not.toBe('HEALTHY' as never);
  });

  it('D11/D27 failure and timeout', () => {
    expect(
      evaluateWhenEnabled({
        policy: enabledPolicy(),
        history: [],
        current: run({ conclusion: 'failure' }),
        nowMs: NOW,
      }).classification,
    ).toBe('FAILED');
    expect(
      evaluateWhenEnabled({
        policy: enabledPolicy(),
        history: [],
        current: run({ conclusion: 'timed_out' }),
        nowMs: NOW,
      }).classification,
    ).toBe('TIMED_OUT');
  });
});

describe('C3-D clock / commit / window', () => {
  it('D12/D13 missing heartbeat → missed', () => {
    const r = evaluateWhenEnabled({
      policy: enabledPolicy(),
      history: [],
      current: null,
      nowMs: NOW,
    });
    expect(r.classification).toBe('MISSED');
  });

  it('D14/D30/D31 future timestamp / UTC', () => {
    const future = run({
      started_at: new Date(NOW + 10 * 60_000).toISOString(),
      completed_at: null,
      status: 'in_progress',
      conclusion: null,
    });
    const r = evaluateWhenEnabled({
      policy: enabledPolicy(),
      history: [],
      current: future,
      nowMs: NOW,
    });
    expect(r.classification).toBe('UNKNOWN');
    expect(r.reason_code).toBe('future_timestamp');
  });

  it('D15 commit SHA mismatch', () => {
    const r = evaluateWhenEnabled({
      policy: enabledPolicy(),
      history: [],
      current: run(),
      nowMs: NOW,
      expected_commit_sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });
    expect(r.reason_code).toBe('commit_sha_mismatch');
  });

  it('D16/D17/D18/D19 incomplete / UNKNOWN never advances recovery', () => {
    const r = evaluateScheduleSafety({ history: [], nowMs: NOW });
    expect(mayAdvanceHealthyFromSchedule(r)).toBe(false);
    const unk = evaluateWhenEnabled({
      policy: enabledPolicy({ overlap_policy: 'unknown_on_overlap' }),
      history: [
        run({
          run_id: '1',
          status: 'in_progress',
          conclusion: null,
          completed_at: null,
          started_at: new Date(NOW - 60_000).toISOString(),
        }),
        run({
          run_id: '2',
          status: 'queued',
          conclusion: null,
          completed_at: null,
          started_at: null,
        }),
      ],
      current: null,
      nowMs: NOW,
    });
    expect(unk.classification).toBe('UNKNOWN');
    expect(unk.may_advance_healthy).toBe(false);
  });

  it('D20 queue delay elevated still UNKNOWN not HEALTHY', () => {
    const last = run({ completed_at: new Date(NOW - 14 * 60_000).toISOString() });
    const r = evaluateWhenEnabled({
      policy: enabledPolicy(),
      history: [last],
      current: null,
      nowMs: NOW,
    });
    expect(['DELAYED', 'MISSED']).toContain(r.classification);
    expect(r.may_advance_healthy).toBe(false);
  });

  it('D28/D29 restart / invalid timestamp', () => {
    const bad = run({ completed_at: 'not-a-date', started_at: 'also-bad' });
    const r = evaluateWhenEnabled({
      policy: enabledPolicy(),
      history: [bad],
      current: null,
      nowMs: NOW,
    });
    // no valid last success → missed
    expect(r.classification).toBe('MISSED');
  });
});

describe('C3-D workflow artifacts remain schedule-OFF', () => {
  it('D32 schedule trigger must stay commented (not active)', () => {
    const yml = readFileSync(path.join(ROOT, '.github/workflows/both-stage-watchdog.yml'), 'utf8');
    expect(yml).toMatch(/#\s*schedule:/);
    // No active top-level schedule key
    const stripped = yml
      .split('\n')
      .map((l) => {
        const i = l.indexOf('#');
        return i >= 0 ? l.slice(0, i) : l;
      })
      .join('\n');
    expect(stripped).not.toMatch(/^\s*schedule\s*:/m);
    expect(yml).toContain('cancel-in-progress: false');
    expect(yml).toContain('both-stage-watchdog-qszggrrjhcwltnmxpxcy');
    expect(yml).not.toMatch(/^\s*issues:\s*write\s*$/m);
  });

  it('self-monitor schedule remains commented', () => {
    const yml = readFileSync(path.join(ROOT, '.github/workflows/both-stage-watchdog-self.yml'), 'utf8');
    expect(yml).toMatch(/#\s*schedule:/);
  });
});
