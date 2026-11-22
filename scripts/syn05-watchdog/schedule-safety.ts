/**
 * C3-D — Schedule safety evaluation (offline / injectable clock).
 * Never advances HEALTHY recovery. Schedule remains OFF by default.
 */

import {
  DEFAULT_SCHEDULE_POLICY,
  resolveSchedulePolicy,
  type SchedulePolicyV1,
} from './schedule-policy.ts';
import { STAGE_ENVIRONMENT, STAGE_PROJECT_REF } from './types.ts';

export type RunStatus = 'queued' | 'in_progress' | 'completed' | 'waiting';
export type RunConclusion = 'success' | 'failure' | 'cancelled' | 'timed_out' | 'skipped' | null;

export type WatchdogRunSample = {
  run_id: string;
  source_commit_sha: string;
  workflow_name: string;
  environment: string;
  project_ref: string;
  started_at: string | null;
  completed_at: string | null;
  status: RunStatus;
  conclusion: RunConclusion;
};

export type RunIdentity = {
  run_id: string;
  source_commit_sha: string;
  workflow_name: string;
  environment: string;
  project_ref: string;
  observed_at: string;
  window_start: string;
  window_end: string;
  run_key: string;
};

export type ScheduleSafetyClass =
  | 'SCHEDULE_DISABLED'
  | 'ON_TIME'
  | 'DELAYED'
  | 'MISSED'
  | 'STALE'
  | 'DUPLICATE'
  | 'OUT_OF_ORDER'
  | 'OVERLAP'
  | 'CANCELLED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'UNKNOWN'
  | 'DEGRADED'
  | 'CONFIG_INVALID';

export type ScheduleSafetyResult = {
  classification: ScheduleSafetyClass;
  reason_code: string;
  missed_intervals: number;
  may_advance_healthy: false;
  evaluation_status: 'UNKNOWN' | 'DATA_UNAVAILABLE' | 'FIRING';
  run_identity?: RunIdentity;
  details: Record<string, string | number | boolean | null>;
};

function isIso(s: string | null | undefined): s is string {
  return typeof s === 'string' && Number.isFinite(Date.parse(s));
}

export function buildRunIdentity(opts: {
  run: WatchdogRunSample;
  policy: SchedulePolicyV1;
  nowMs: number;
}): RunIdentity | { error: string } {
  const { run, policy, nowMs } = opts;
  if (!run.run_id || !/^\d+$/.test(run.run_id)) return { error: 'run_id_invalid' };
  if (!run.source_commit_sha || !/^[0-9a-f]{7,40}$/i.test(run.source_commit_sha)) {
    return { error: 'source_commit_sha_invalid' };
  }
  if (run.workflow_name !== policy.workflow_name) return { error: 'workflow_mismatch' };
  if (!policy.environment_allowlist.includes(run.environment)) return { error: 'environment_mismatch' };
  if (!policy.project_ref_allowlist.includes(run.project_ref)) return { error: 'project_ref_mismatch' };

  const windowMs = policy.evaluation_window_minutes * 60_000;
  const end = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  const start = new Date(nowMs - windowMs).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  const run_key = [
    run.workflow_name,
    run.environment,
    run.project_ref,
    run.source_commit_sha.slice(0, 12),
    run.run_id,
  ].join('|');

  return {
    run_id: run.run_id,
    source_commit_sha: run.source_commit_sha,
    workflow_name: run.workflow_name,
    environment: run.environment,
    project_ref: run.project_ref,
    observed_at: end,
    window_start: start,
    window_end: end,
    run_key,
  };
}

function baseResult(
  classification: ScheduleSafetyClass,
  reason_code: string,
  extra: Partial<ScheduleSafetyResult> = {},
): ScheduleSafetyResult {
  return {
    classification,
    reason_code,
    missed_intervals: extra.missed_intervals ?? 0,
    may_advance_healthy: false,
    evaluation_status:
      classification === 'MISSED' || classification === 'STALE' || classification === 'FAILED'
        ? 'FIRING'
        : classification === 'CONFIG_INVALID' || classification === 'UNKNOWN'
          ? 'UNKNOWN'
          : classification === 'SCHEDULE_DISABLED'
            ? 'DATA_UNAVAILABLE'
            : 'UNKNOWN',
    run_identity: extra.run_identity,
    details: extra.details ?? {},
  };
}

export function countMissedIntervals(opts: {
  lastCompletedAt: string | null;
  nowMs: number;
  intervalMs: number;
  delayMs: number;
  threshold: number;
}): { missed: number; overdue: boolean } {
  if (!isIso(opts.lastCompletedAt)) {
    return { missed: opts.threshold, overdue: true };
  }
  const last = Date.parse(opts.lastCompletedAt);
  if (!Number.isFinite(last)) return { missed: opts.threshold, overdue: true };
  const elapsed = opts.nowMs - last;
  const budget = opts.intervalMs + opts.delayMs;
  if (elapsed <= budget) return { missed: 0, overdue: false };
  const missed = Math.floor((elapsed - opts.delayMs) / opts.intervalMs);
  return { missed: Math.max(0, missed), overdue: missed >= opts.threshold };
}

export function detectOverlap(runs: WatchdogRunSample[], nowMs: number): boolean {
  const active = runs.filter((r) => {
    if (r.status === 'in_progress' || r.status === 'queued') return true;
    if (r.status === 'completed' && isIso(r.started_at) && isIso(r.completed_at)) {
      // completed samples don't overlap unless timestamps nest — ignore
      return false;
    }
    return false;
  });
  if (active.length >= 2) return true;
  // One in_progress + another started before it completed
  const inFlight = runs.filter((r) => r.status === 'in_progress' && isIso(r.started_at));
  for (const a of inFlight) {
    const aStart = Date.parse(a.started_at!);
    for (const b of runs) {
      if (b.run_id === a.run_id) continue;
      if (!isIso(b.started_at)) continue;
      const bStart = Date.parse(b.started_at);
      const bEnd = isIso(b.completed_at) ? Date.parse(b.completed_at) : nowMs;
      if (bStart < nowMs && bEnd > aStart) return true;
    }
  }
  return false;
}

export function detectOutOfOrder(runs: WatchdogRunSample[]): boolean {
  const completed = runs
    .filter((r) => isIso(r.completed_at) && isIso(r.started_at))
    .sort((a, b) => Date.parse(a.started_at!) - Date.parse(b.started_at!));
  for (let i = 1; i < completed.length; i++) {
    const prevEnd = Date.parse(completed[i - 1].completed_at!);
    const curStart = Date.parse(completed[i].started_at!);
    const curEnd = Date.parse(completed[i].completed_at!);
    if (curEnd < prevEnd && curStart < prevEnd) return true;
    // completed_at decreasing while started_at increasing
    if (curEnd < Date.parse(completed[i - 1].completed_at!)) return true;
  }
  return false;
}

export function detectDuplicateRunIds(runs: WatchdogRunSample[]): boolean {
  const ids = runs.map((r) => r.run_id);
  return new Set(ids).size !== ids.length;
}

/**
 * Fail-closed schedule safety evaluation.
 * When schedule_enabled=false (canonical C3-D state), returns SCHEDULE_DISABLED
 * and never HEALTHY / may_advance_healthy.
 */
export function evaluateScheduleSafety(opts: {
  policy?: unknown;
  history: WatchdogRunSample[];
  current?: WatchdogRunSample | null;
  nowMs: number;
  expected_commit_sha?: string;
}): ScheduleSafetyResult {
  const resolved = resolveSchedulePolicy(opts.policy ?? DEFAULT_SCHEDULE_POLICY);
  if (!resolved.ok) {
    return baseResult('CONFIG_INVALID', resolved.code, {
      evaluation_status: 'UNKNOWN',
      details: { policy_ok: false },
    });
  }
  const policy = resolved.policy;

  // Hard OFF path — intentional disablement is not HEALTHY
  if (policy.schedule_enabled === false) {
    return baseResult('SCHEDULE_DISABLED', policy.fail_closed_reason, {
      evaluation_status: 'DATA_UNAVAILABLE',
      details: {
        schedule_enabled: false,
        interval_minutes: policy.interval_minutes,
        concurrency_group: policy.concurrency_group,
        cancel_in_progress: false,
      },
    });
  }

  // Unreachable under DEFAULT (schedule_enabled:false) — kept for future activation gate tests
  // via explicit policy overrides in unit tests only.
  return evaluateWhenEnabled({
    policy,
    history: opts.history,
    current: opts.current ?? null,
    nowMs: opts.nowMs,
    expected_commit_sha: opts.expected_commit_sha,
  });
}

/** Internal path used when a test injects schedule_enabled=true (activation NOT authorized). */
export function evaluateWhenEnabled(opts: {
  policy: SchedulePolicyV1 & { schedule_enabled?: boolean };
  history: WatchdogRunSample[];
  current: WatchdogRunSample | null;
  nowMs: number;
  expected_commit_sha?: string;
}): ScheduleSafetyResult {
  const policy = opts.policy as SchedulePolicyV1;
  const history = opts.history;
  const nowMs = opts.nowMs;

  if (detectDuplicateRunIds(history)) {
    return baseResult('DUPLICATE', 'duplicate_run_id', {
      evaluation_status: 'UNKNOWN',
      details: { duplicate: true },
    });
  }

  if (detectOutOfOrder(history)) {
    return baseResult('OUT_OF_ORDER', 'run_timestamps_out_of_order', {
      evaluation_status: 'UNKNOWN',
      details: { out_of_order: true },
    });
  }

  if (detectOverlap(history, nowMs) || (opts.current && detectOverlap([...history, opts.current], nowMs))) {
    const cls =
      policy.overlap_policy === 'forbid'
        ? 'OVERLAP'
        : policy.overlap_policy === 'unknown_on_overlap'
          ? 'UNKNOWN'
          : 'DEGRADED';
    return baseResult(cls === 'OVERLAP' ? 'OVERLAP' : cls, 'overlap_detected', {
      evaluation_status: 'UNKNOWN',
      details: { overlap: true, overlap_policy: policy.overlap_policy },
    });
  }

  const current = opts.current;
  if (current) {
    const id = buildRunIdentity({ run: current, policy, nowMs });
    if ('error' in id) {
      return baseResult('UNKNOWN', id.error, { evaluation_status: 'UNKNOWN' });
    }
    if (opts.expected_commit_sha && current.source_commit_sha.toLowerCase() !== opts.expected_commit_sha.toLowerCase()) {
      return baseResult('UNKNOWN', 'commit_sha_mismatch', {
        run_identity: id,
        evaluation_status: 'UNKNOWN',
      });
    }
    if (isIso(current.started_at) && Date.parse(current.started_at) > nowMs + policy.clock_skew_tolerance_ms) {
      return baseResult('UNKNOWN', 'future_timestamp', {
        run_identity: id,
        evaluation_status: 'UNKNOWN',
      });
    }
    if (current.status === 'in_progress' && isIso(current.started_at)) {
      const age = nowMs - Date.parse(current.started_at);
      if (age > policy.stale_run_threshold_minutes * 60_000) {
        return baseResult('STALE', 'stale_in_progress', {
          run_identity: id,
          evaluation_status: 'FIRING',
          details: { age_ms: age },
        });
      }
    }
    if (current.status === 'completed') {
      if (current.conclusion === 'cancelled') {
        return baseResult('CANCELLED', 'run_cancelled', {
          run_identity: id,
          evaluation_status: 'UNKNOWN',
        });
      }
      if (current.conclusion === 'timed_out') {
        return baseResult('TIMED_OUT', 'run_timed_out', {
          run_identity: id,
          evaluation_status: 'FIRING',
        });
      }
      if (current.conclusion === 'failure') {
        return baseResult('FAILED', 'run_failed', {
          run_identity: id,
          evaluation_status: 'FIRING',
        });
      }
      if (current.conclusion === 'success' && isIso(current.completed_at) && isIso(current.started_at)) {
        const delay = Date.parse(current.started_at) - (nowMs - policy.interval_minutes * 60_000);
        // Relative delay vs expected slot is approximate; use completed age from previous
        void delay;
        return baseResult('ON_TIME', 'run_success', {
          run_identity: id,
          evaluation_status: 'UNKNOWN', // still never HEALTHY from schedule alone
          details: { success: true },
        });
      }
    }
  }

  const lastSuccess = [...history]
    .filter((r) => r.conclusion === 'success' && isIso(r.completed_at))
    .sort((a, b) => Date.parse(b.completed_at!) - Date.parse(a.completed_at!))[0];

  const intervalMs = policy.interval_minutes * 60_000;
  const delayMs = policy.max_expected_delay_minutes * 60_000;
  const { missed, overdue } = countMissedIntervals({
    lastCompletedAt: lastSuccess?.completed_at ?? null,
    nowMs,
    intervalMs,
    delayMs,
    threshold: policy.missed_run_threshold,
  });

  if (overdue) {
    return baseResult('MISSED', 'missed_run_threshold_exceeded', {
      missed_intervals: missed,
      evaluation_status: 'FIRING',
      details: {
        missed,
        last_completed_at: lastSuccess?.completed_at ?? null,
      },
    });
  }

  if (missed === 0 && lastSuccess) {
    const elapsed = nowMs - Date.parse(lastSuccess.completed_at!);
    if (elapsed > intervalMs && elapsed <= intervalMs + delayMs) {
      return baseResult('DELAYED', 'within_delay_budget', {
        missed_intervals: 0,
        evaluation_status: 'UNKNOWN',
        details: { elapsed_ms: elapsed },
      });
    }
    return baseResult('ON_TIME', 'within_interval', {
      missed_intervals: 0,
      evaluation_status: 'UNKNOWN',
      details: { elapsed_ms: elapsed },
    });
  }

  return baseResult('UNKNOWN', 'insufficient_schedule_evidence', {
    evaluation_status: 'UNKNOWN',
    details: { history_len: history.length },
  });
}

/** Recovery must never close/advance on schedule uncertainty. */
export function mayAdvanceHealthyFromSchedule(result: ScheduleSafetyResult): false {
  void result;
  return false;
}

export function assertC0ScheduleInvariants(env: Record<string, string | undefined> = {}): string | null {
  if (env.BOTH_WATCHDOG_DRY_RUN !== undefined && env.BOTH_WATCHDOG_DRY_RUN !== '1') {
    return 'dry_run_must_be_1';
  }
  if (env.BOTH_WATCHDOG_GITHUB_WRITE === '1') return 'write_must_be_0';
  if (env.BOTH_WATCHDOG_ENABLE_NETWORK === '1') return 'network_must_be_0';
  if (env.BOTH_WATCHDOG_SCHEDULE_ENABLED === '1') return 'schedule_must_be_off';
  return null;
}

export const C3_D_DEFAULTS = {
  dry_run: '1',
  write: '0',
  network: '0',
  schedule_enabled: false,
  environment: STAGE_ENVIRONMENT,
  project_ref: STAGE_PROJECT_REF,
  concurrency_group: DEFAULT_SCHEDULE_POLICY.concurrency_group,
  cancel_in_progress: false,
} as const;
