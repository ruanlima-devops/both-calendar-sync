/**
 * C3-E — Independent watchdog observer (offline / injectable transport).
 * Operational remote activation NOT authorized. Alert channel inactive.
 *
 * Independence: does not treat absence of Issues as HEALTHY.
 * When schedule is intentionally OFF → DISABLED_INTENTIONALLY (not HEALTHY).
 */

import { STAGE_ENVIRONMENT, STAGE_PROJECT_REF } from './types.ts';
import { redactText } from './redact.ts';

export const OBSERVER_SCHEMA_VERSION = 'both-syn05-observer-artifact:v1' as const;

export type ObserverClassification =
  | 'DISABLED_INTENTIONALLY'
  | 'EXPECTED_BUT_MISSING'
  | 'RUNNING'
  | 'FAILED'
  | 'STALE'
  | 'UNKNOWN'
  | 'OBSERVER_BLIND'
  | 'HEALTHY'
  | 'DEGRADED';

export type ObserverPayloadV1 = {
  observer_schema_version: typeof OBSERVER_SCHEMA_VERSION;
  monitored_workflow: string;
  expected_interval_seconds: number;
  last_seen_run_id: string | null;
  last_completed_at: string | null;
  observed_at: string;
  age_seconds: number | null;
  missed_intervals: number;
  classification: ObserverClassification;
  reason_code: string;
  environment: typeof STAGE_ENVIRONMENT;
  project_ref: typeof STAGE_PROJECT_REF;
  schedule_expected: boolean;
};

const ALLOWED_KEYS = new Set([
  'observer_schema_version',
  'monitored_workflow',
  'expected_interval_seconds',
  'last_seen_run_id',
  'last_completed_at',
  'observed_at',
  'age_seconds',
  'missed_intervals',
  'classification',
  'reason_code',
  'environment',
  'project_ref',
  'schedule_expected',
]);

export type ActionsRunMeta = {
  id: string;
  name: string;
  head_branch: string;
  head_sha: string;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting';
  conclusion: 'success' | 'failure' | 'cancelled' | 'timed_out' | 'skipped' | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string | null;
};

export type ObserverTransport = {
  listWorkflowRuns: (opts: {
    workflow_name: string;
    branch?: string;
  }) => Promise<{ ok: true; runs: ActionsRunMeta[] } | { ok: false; code: string; status?: number }>;
};

export type ObserverPolicy = {
  monitored_workflow: string;
  expected_interval_seconds: number;
  grace_seconds: number;
  stale_seconds: number;
  missed_threshold: number;
  /** When false, observer must classify DISABLED_INTENTIONALLY — never HEALTHY */
  schedule_expected: boolean;
  allow_branches: readonly string[];
  allow_repo: string;
  clock_skew_tolerance_ms: number;
};

export const DEFAULT_OBSERVER_POLICY: ObserverPolicy = {
  monitored_workflow: 'Both STAGE Watchdog (dry-run)',
  expected_interval_seconds: 10 * 60,
  grace_seconds: 5 * 60,
  stale_seconds: 15 * 60,
  missed_threshold: 1,
  schedule_expected: false,
  allow_branches: ['develop'],
  allow_repo: 'ruanlima-devops/both-calendar-sync',
  clock_skew_tolerance_ms: 60_000,
};

export type ObserverEvalInput = {
  policy?: ObserverPolicy;
  transport?: ObserverTransport;
  /** Injected samples when transport omitted (unit tests) */
  runs?: ActionsRunMeta[];
  nowMs: number;
  transport_error?: { code: string; status?: number };
};

export type ObserverEvalResult = {
  payload: ObserverPayloadV1;
  alert_channel_active: false;
  http_performed: boolean;
};

function isIso(s: unknown): s is string {
  return typeof s === 'string' && Number.isFinite(Date.parse(s));
}

export function validateObserverPayload(raw: unknown): { ok: true; payload: ObserverPayloadV1 } | { ok: false; code: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'payload_missing' };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!ALLOWED_KEYS.has(k)) return { ok: false, code: `additional_property:${k}` };
  }
  if (o.observer_schema_version !== OBSERVER_SCHEMA_VERSION) return { ok: false, code: 'schema_mismatch' };
  if (typeof o.monitored_workflow !== 'string' || o.monitored_workflow.length < 3 || o.monitored_workflow.length > 120) {
    return { ok: false, code: 'workflow_invalid' };
  }
  if (typeof o.expected_interval_seconds !== 'number' || o.expected_interval_seconds < 60) {
    return { ok: false, code: 'interval_invalid' };
  }
  if (o.last_seen_run_id !== null && (typeof o.last_seen_run_id !== 'string' || !/^\d+$/.test(o.last_seen_run_id))) {
    return { ok: false, code: 'run_id_invalid' };
  }
  if (o.last_completed_at !== null && !isIso(o.last_completed_at)) return { ok: false, code: 'last_completed_invalid' };
  if (!isIso(o.observed_at)) return { ok: false, code: 'observed_at_invalid' };
  if (o.age_seconds !== null && (typeof o.age_seconds !== 'number' || o.age_seconds < 0)) {
    return { ok: false, code: 'age_invalid' };
  }
  if (typeof o.missed_intervals !== 'number' || o.missed_intervals < 0) return { ok: false, code: 'missed_invalid' };
  const allowedClass: ObserverClassification[] = [
    'DISABLED_INTENTIONALLY',
    'EXPECTED_BUT_MISSING',
    'RUNNING',
    'FAILED',
    'STALE',
    'UNKNOWN',
    'OBSERVER_BLIND',
    'HEALTHY',
    'DEGRADED',
  ];
  if (!allowedClass.includes(o.classification as ObserverClassification)) return { ok: false, code: 'class_invalid' };
  if (typeof o.reason_code !== 'string' || o.reason_code.length > 80) return { ok: false, code: 'reason_invalid' };
  if (o.environment !== STAGE_ENVIRONMENT) return { ok: false, code: 'environment_mismatch' };
  if (o.project_ref !== STAGE_PROJECT_REF) return { ok: false, code: 'project_mismatch' };
  if (typeof o.schedule_expected !== 'boolean') return { ok: false, code: 'schedule_expected_invalid' };
  return { ok: true, payload: o as ObserverPayloadV1 };
}

function makePayload(
  policy: ObserverPolicy,
  over: Partial<ObserverPayloadV1> & Pick<ObserverPayloadV1, 'classification' | 'reason_code' | 'observed_at'>,
): ObserverPayloadV1 {
  return {
    observer_schema_version: OBSERVER_SCHEMA_VERSION,
    monitored_workflow: policy.monitored_workflow,
    expected_interval_seconds: policy.expected_interval_seconds,
    last_seen_run_id: over.last_seen_run_id ?? null,
    last_completed_at: over.last_completed_at ?? null,
    observed_at: over.observed_at,
    age_seconds: over.age_seconds ?? null,
    missed_intervals: over.missed_intervals ?? 0,
    classification: over.classification,
    reason_code: over.reason_code,
    environment: STAGE_ENVIRONMENT,
    project_ref: STAGE_PROJECT_REF,
    schedule_expected: policy.schedule_expected,
  };
}

/**
 * Evaluate independent observer. Never activates alert channel.
 * schedule_expected=false → DISABLED_INTENTIONALLY (canonical C3-E state).
 */
export async function evaluateIndependentObserver(input: ObserverEvalInput): Promise<ObserverEvalResult> {
  const policy = input.policy ?? DEFAULT_OBSERVER_POLICY;
  const observed_at = new Date(input.nowMs).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  let http_performed = false;

  // Intentional disablement — never HEALTHY
  if (!policy.schedule_expected) {
    const payload = makePayload(policy, {
      classification: 'DISABLED_INTENTIONALLY',
      reason_code: 'schedule_off_intentional',
      observed_at,
      missed_intervals: 0,
      age_seconds: null,
    });
    return { payload, alert_channel_active: false, http_performed: false };
  }

  let runs: ActionsRunMeta[] = input.runs ?? [];
  if (input.transport_error) {
    const payload = makePayload(policy, {
      classification: 'OBSERVER_BLIND',
      reason_code: redactText(input.transport_error.code, 60),
      observed_at,
    });
    return { payload, alert_channel_active: false, http_performed: false };
  }

  if (input.transport) {
    http_performed = true;
    const res = await input.transport.listWorkflowRuns({
      workflow_name: policy.monitored_workflow,
      branch: policy.allow_branches[0],
    });
    if (!res.ok) {
      const code =
        res.status === 401
          ? 'github_401'
          : res.status === 403
            ? 'github_403'
            : res.status === 429
              ? 'github_429'
              : res.status && res.status >= 500
                ? 'github_5xx'
                : res.code;
      const payload = makePayload(policy, {
        classification: 'OBSERVER_BLIND',
        reason_code: code,
        observed_at,
      });
      return { payload, alert_channel_active: false, http_performed: true };
    }
    runs = res.runs;
  }

  // Filter to allowed branch / workflow name
  const filtered = runs.filter((r) => {
    if (r.name !== policy.monitored_workflow) return false;
    if (!policy.allow_branches.includes(r.head_branch)) return false;
    return true;
  });

  if (filtered.length === 0) {
    const payload = makePayload(policy, {
      classification: 'EXPECTED_BUT_MISSING',
      reason_code: 'no_runs_observed',
      observed_at,
      missed_intervals: policy.missed_threshold,
    });
    return { payload, alert_channel_active: false, http_performed };
  }

  const inFlight = filtered.find((r) => r.status === 'in_progress' || r.status === 'queued');
  if (inFlight) {
    const start = Date.parse(inFlight.run_started_at || inFlight.created_at);
    if (Number.isFinite(start) && input.nowMs - start > policy.stale_seconds * 1000) {
      const payload = makePayload(policy, {
        classification: 'STALE',
        reason_code: 'run_stale_in_progress',
        observed_at,
        last_seen_run_id: inFlight.id,
        age_seconds: Math.floor((input.nowMs - start) / 1000),
      });
      return { payload, alert_channel_active: false, http_performed };
    }
    const payload = makePayload(policy, {
      classification: 'RUNNING',
      reason_code: 'run_in_progress',
      observed_at,
      last_seen_run_id: inFlight.id,
    });
    return { payload, alert_channel_active: false, http_performed };
  }

  const completed = [...filtered]
    .filter((r) => r.status === 'completed')
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));

  const latest = completed[0];
  if (!latest) {
    const payload = makePayload(policy, {
      classification: 'EXPECTED_BUT_MISSING',
      reason_code: 'no_completed_runs',
      observed_at,
      missed_intervals: policy.missed_threshold,
    });
    return { payload, alert_channel_active: false, http_performed };
  }

  if (!isIso(latest.updated_at)) {
    const payload = makePayload(policy, {
      classification: 'UNKNOWN',
      reason_code: 'invalid_timestamp',
      observed_at,
      last_seen_run_id: latest.id,
    });
    return { payload, alert_channel_active: false, http_performed };
  }

  const completedAt = Date.parse(latest.updated_at);
  if (completedAt > input.nowMs + policy.clock_skew_tolerance_ms) {
    const payload = makePayload(policy, {
      classification: 'UNKNOWN',
      reason_code: 'future_timestamp',
      observed_at,
      last_seen_run_id: latest.id,
    });
    return { payload, alert_channel_active: false, http_performed };
  }

  if (latest.conclusion === 'failure' || latest.conclusion === 'timed_out') {
    const payload = makePayload(policy, {
      classification: 'FAILED',
      reason_code: latest.conclusion === 'timed_out' ? 'run_timed_out' : 'run_failed',
      observed_at,
      last_seen_run_id: latest.id,
      last_completed_at: latest.updated_at,
    });
    return { payload, alert_channel_active: false, http_performed };
  }

  if (latest.conclusion === 'cancelled') {
    const payload = makePayload(policy, {
      classification: 'DEGRADED',
      reason_code: 'run_cancelled',
      observed_at,
      last_seen_run_id: latest.id,
      last_completed_at: latest.updated_at,
    });
    return { payload, alert_channel_active: false, http_performed };
  }

  if (latest.conclusion !== 'success') {
    const payload = makePayload(policy, {
      classification: 'UNKNOWN',
      reason_code: 'conclusion_unrecognized',
      observed_at,
      last_seen_run_id: latest.id,
    });
    return { payload, alert_channel_active: false, http_performed };
  }

  const age_seconds = Math.floor((input.nowMs - completedAt) / 1000);
  const budget = policy.expected_interval_seconds + policy.grace_seconds;
  if (age_seconds > budget) {
    const missed = Math.floor(age_seconds / policy.expected_interval_seconds);
    const payload = makePayload(policy, {
      classification: missed >= policy.missed_threshold ? 'EXPECTED_BUT_MISSING' : 'STALE',
      reason_code: 'heartbeat_expired',
      observed_at,
      last_seen_run_id: latest.id,
      last_completed_at: latest.updated_at,
      age_seconds,
      missed_intervals: missed,
    });
    return { payload, alert_channel_active: false, http_performed };
  }

  const payload = makePayload(policy, {
    classification: 'HEALTHY',
    reason_code: 'success_within_window',
    observed_at,
    last_seen_run_id: latest.id,
    last_completed_at: latest.updated_at,
    age_seconds,
    missed_intervals: 0,
  });
  return { payload, alert_channel_active: false, http_performed };
}

/** Future alert channel — always inactive (OF-02 gate OFF). */
export function dispatchObserverAlert(_payload: ObserverPayloadV1): { sent: false; code: string } {
  return { sent: false, code: 'observer_alert_channel_not_authorized' };
}

export const OBSERVER_INDEPENDENCE = {
  same_workflow_job: 'insufficient',
  same_actions_platform: 'shared_dependency_documented',
  issues_as_sole_evidence: 'forbidden',
  absence_of_signal_is_healthy: false,
  /** Prefer OF-01 external StatusSource runtime — not another Actions job in same org. */
  recommended_external: 'cloud_scheduler_runtime_with_status_source',
  of01_foundation: 'scripts/syn05-watchdog/external-observer-foundation.ts',
  of02_alert_channel: 'scripts/syn05-watchdog/alert-channel.ts',
} as const;
