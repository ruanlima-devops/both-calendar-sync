/**
 * C3-D — Safe scheduling policy (preparation only).
 * Defaults keep schedule OFF. No runtime activation.
 */

import { STAGE_ENVIRONMENT, STAGE_PROJECT_REF } from './types.ts';

export const SCHEDULE_POLICY_SCHEMA_VERSION = 1 as const;

/** Documented safe cadence for a future activation gate (not enabled). */
export const DOCUMENTED_SAFE_INTERVAL_MINUTES = 10 as const;

export type OverlapPolicy = 'forbid' | 'serialize_wait' | 'unknown_on_overlap';

export type SchedulePolicyV1 = {
  schema_version: typeof SCHEDULE_POLICY_SCHEMA_VERSION;
  /** Intended cadence when schedule is later authorized */
  interval_minutes: number;
  /** Actions queue / start delay tolerance */
  max_expected_delay_minutes: number;
  /** Job timeout budget */
  max_run_duration_minutes: number;
  overlap_policy: OverlapPolicy;
  /** In-progress longer than this → stale */
  stale_run_threshold_minutes: number;
  /** Consecutive missed intervals before MISSED classification */
  missed_run_threshold: number;
  /** Evaluation / log window alignment with collector */
  evaluation_window_minutes: number;
  clock_skew_tolerance_ms: number;
  environment_allowlist: readonly string[];
  project_ref_allowlist: readonly string[];
  concurrency_group: string;
  cancel_in_progress: false;
  /** Hard OFF until separate PO activation */
  schedule_enabled: false;
  workflow_name: string;
  fail_closed_reason: string;
};

export const DEFAULT_SCHEDULE_POLICY: SchedulePolicyV1 = {
  schema_version: SCHEDULE_POLICY_SCHEMA_VERSION,
  interval_minutes: DOCUMENTED_SAFE_INTERVAL_MINUTES,
  max_expected_delay_minutes: 5,
  max_run_duration_minutes: 10,
  overlap_policy: 'unknown_on_overlap',
  stale_run_threshold_minutes: 15,
  missed_run_threshold: 1,
  evaluation_window_minutes: 15,
  clock_skew_tolerance_ms: 60_000,
  environment_allowlist: [STAGE_ENVIRONMENT],
  project_ref_allowlist: [STAGE_PROJECT_REF],
  concurrency_group: 'both-stage-watchdog-qszggrrjhcwltnmxpxcy',
  cancel_in_progress: false,
  schedule_enabled: false,
  workflow_name: 'Both STAGE Watchdog (dry-run)',
  fail_closed_reason: 'schedule_not_authorized_c3_d_preparation_only',
};

export type PolicyValidation =
  | { ok: true; policy: SchedulePolicyV1 }
  | { ok: false; code: string };

export function validateSchedulePolicy(raw: unknown): PolicyValidation {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, code: 'policy_missing' };
  }
  const p = raw as Record<string, unknown>;
  if (p.schema_version !== SCHEDULE_POLICY_SCHEMA_VERSION) {
    return { ok: false, code: 'policy_schema_unknown' };
  }
  if (typeof p.interval_minutes !== 'number' || p.interval_minutes < 5 || p.interval_minutes > 120) {
    return { ok: false, code: 'interval_invalid' };
  }
  if (typeof p.max_expected_delay_minutes !== 'number' || p.max_expected_delay_minutes < 0) {
    return { ok: false, code: 'delay_invalid' };
  }
  if (typeof p.max_run_duration_minutes !== 'number' || p.max_run_duration_minutes < 1) {
    return { ok: false, code: 'duration_invalid' };
  }
  if (p.cancel_in_progress !== false) {
    return { ok: false, code: 'cancel_in_progress_must_be_false' };
  }
  if (p.schedule_enabled !== false) {
    return { ok: false, code: 'schedule_must_remain_off' };
  }
  if (typeof p.concurrency_group !== 'string' || !p.concurrency_group.includes(STAGE_PROJECT_REF)) {
    return { ok: false, code: 'concurrency_group_invalid' };
  }
  if (!Array.isArray(p.environment_allowlist) || !p.environment_allowlist.includes(STAGE_ENVIRONMENT)) {
    return { ok: false, code: 'environment_allowlist_invalid' };
  }
  if (!Array.isArray(p.project_ref_allowlist) || !p.project_ref_allowlist.includes(STAGE_PROJECT_REF)) {
    return { ok: false, code: 'project_ref_allowlist_invalid' };
  }
  return { ok: true, policy: p as SchedulePolicyV1 };
}

export function resolveSchedulePolicy(raw?: unknown): PolicyValidation {
  if (raw == null) return validateSchedulePolicy(DEFAULT_SCHEDULE_POLICY);
  return validateSchedulePolicy(raw);
}
