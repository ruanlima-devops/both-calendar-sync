/**
 * OF-01 — External Observer Foundation (offline).
 *
 * Prepares a heartbeat evaluator that can run outside GitHub Actions once a
 * future PO-approved runtime is provisioned. Does NOT select/provision a vendor.
 *
 * Guarantees:
 * - No HTTP / network on import
 * - No side effects on import
 * - Fail-closed when clock or status source missing
 * - Disabled by default (activation gate required)
 */

import { STAGE_ENVIRONMENT, STAGE_PROJECT_REF } from './types.ts';
import { redactText } from './redact.ts';

export const EXTERNAL_OBSERVER_SCHEMA = 'both-syn05-external-observer:v1' as const;

export type HeartbeatSample = {
  /** Opaque id of the last successful heartbeat (run id, probe id, etc.) */
  id: string;
  /** ISO timestamp of last successful observation */
  observed_at: string;
  /** Optional status hint from upstream */
  status?: 'ok' | 'fail' | 'unknown';
  /** Provenance label — must match expected environment */
  environment: typeof STAGE_ENVIRONMENT;
  project_ref: typeof STAGE_PROJECT_REF;
};

export type StatusSourceResult =
  | { ok: true; sample: HeartbeatSample | null }
  | { ok: false; code: string };

/** Read-only abstract status source — implementations must not write remotely. */
export type StatusSource = {
  readonly kind: string;
  readHeartbeat: () => Promise<StatusSourceResult>;
};

export type ExternalObserverConfig = {
  schema_version: typeof EXTERNAL_OBSERVER_SCHEMA;
  /** Must be true AND authorization_token match to enable evaluation beyond DISABLED */
  enabled: boolean;
  /** Explicit activation token — env alone never enables */
  authorization_gate: 'OFF' | 'PO_AUTHORIZED';
  expected_interval_seconds: number;
  grace_seconds: number;
  stale_seconds: number;
  missed_threshold: number;
  clock_skew_tolerance_ms: number;
  allow_environment: typeof STAGE_ENVIRONMENT;
  allow_project_ref: typeof STAGE_PROJECT_REF;
};

export const DEFAULT_EXTERNAL_OBSERVER_CONFIG: ExternalObserverConfig = {
  schema_version: EXTERNAL_OBSERVER_SCHEMA,
  enabled: false,
  authorization_gate: 'OFF',
  expected_interval_seconds: 10 * 60,
  grace_seconds: 5 * 60,
  stale_seconds: 15 * 60,
  missed_threshold: 1,
  clock_skew_tolerance_ms: 60_000,
  allow_environment: STAGE_ENVIRONMENT,
  allow_project_ref: STAGE_PROJECT_REF,
};

export type ExternalHealth =
  | 'DISABLED_INTENTIONALLY'
  | 'HEALTHY'
  | 'EXPECTED_BUT_MISSING'
  | 'STALE'
  | 'FAILED'
  | 'UNKNOWN'
  | 'OBSERVER_BLIND'
  | 'CONFIG_INVALID';

export type ExternalObserverResult = {
  schema_version: typeof EXTERNAL_OBSERVER_SCHEMA;
  health: ExternalHealth;
  reason_code: string;
  observed_at: string;
  age_seconds: number | null;
  missed_intervals: number;
  last_heartbeat_id: string | null;
  last_heartbeat_at: string | null;
  environment: typeof STAGE_ENVIRONMENT;
  project_ref: typeof STAGE_PROJECT_REF;
  http_performed: false;
  operationally_active: false;
};

export type InMemoryStatusSource = StatusSource & {
  setSample: (sample: HeartbeatSample | null) => void;
  setError: (code: string | null) => void;
};

/** Offline fake status source for unit tests — never touches network. */
export function createInMemoryStatusSource(
  initial: HeartbeatSample | null = null,
): InMemoryStatusSource {
  let sample = initial;
  let error: string | null = null;
  return {
    kind: 'in_memory',
    setSample(s) {
      sample = s;
      error = null;
    },
    setError(code) {
      error = code;
    },
    async readHeartbeat() {
      if (error) return { ok: false, code: error };
      return { ok: true, sample };
    },
  };
}

function isIso(s: unknown): s is string {
  return typeof s === 'string' && Number.isFinite(Date.parse(s));
}

export function validateExternalObserverConfig(
  raw: unknown,
): { ok: true; config: ExternalObserverConfig } | { ok: false; code: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'config_missing' };
  const o = raw as Partial<ExternalObserverConfig>;
  if (o.schema_version !== EXTERNAL_OBSERVER_SCHEMA) return { ok: false, code: 'schema_mismatch' };
  if (typeof o.enabled !== 'boolean') return { ok: false, code: 'enabled_invalid' };
  if (o.authorization_gate !== 'OFF' && o.authorization_gate !== 'PO_AUTHORIZED') {
    return { ok: false, code: 'authorization_gate_invalid' };
  }
  if (typeof o.expected_interval_seconds !== 'number' || o.expected_interval_seconds < 60) {
    return { ok: false, code: 'interval_invalid' };
  }
  if (typeof o.grace_seconds !== 'number' || o.grace_seconds < 0) return { ok: false, code: 'grace_invalid' };
  if (typeof o.stale_seconds !== 'number' || o.stale_seconds < 60) return { ok: false, code: 'stale_invalid' };
  if (typeof o.missed_threshold !== 'number' || o.missed_threshold < 1) {
    return { ok: false, code: 'missed_threshold_invalid' };
  }
  if (o.allow_environment !== STAGE_ENVIRONMENT) return { ok: false, code: 'environment_mismatch' };
  if (o.allow_project_ref !== STAGE_PROJECT_REF) return { ok: false, code: 'project_mismatch' };
  return { ok: true, config: o as ExternalObserverConfig };
}

/**
 * Evaluate external observer heartbeat. Always returns operationally_active=false
 * in this authorization. Never performs HTTP.
 */
export async function evaluateExternalObserver(input: {
  config?: ExternalObserverConfig;
  statusSource?: StatusSource | null;
  nowMs?: number | null;
}): Promise<ExternalObserverResult> {
  const config = input.config ?? DEFAULT_EXTERNAL_OBSERVER_CONFIG;
  const cfg = validateExternalObserverConfig(config);
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.000Z');

  if (!cfg.ok) {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'CONFIG_INVALID',
      reason_code: cfg.code,
      observed_at: stamp(Date.now()),
      age_seconds: null,
      missed_intervals: 0,
      last_heartbeat_id: null,
      last_heartbeat_at: null,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }

  const nowMs = input.nowMs;
  if (nowMs == null || !Number.isFinite(nowMs)) {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'UNKNOWN',
      reason_code: 'clock_missing',
      observed_at: stamp(Date.now()),
      age_seconds: null,
      missed_intervals: 0,
      last_heartbeat_id: null,
      last_heartbeat_at: null,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }

  const observed_at = stamp(nowMs);

  // Fail-closed: not enabled OR gate OFF → intentional disablement
  if (!cfg.config.enabled || cfg.config.authorization_gate !== 'PO_AUTHORIZED') {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'DISABLED_INTENTIONALLY',
      reason_code: 'external_observer_gate_off',
      observed_at,
      age_seconds: null,
      missed_intervals: 0,
      last_heartbeat_id: null,
      last_heartbeat_at: null,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }

  if (!input.statusSource) {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'OBSERVER_BLIND',
      reason_code: 'status_source_missing',
      observed_at,
      age_seconds: null,
      missed_intervals: 0,
      last_heartbeat_id: null,
      last_heartbeat_at: null,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }

  let read: StatusSourceResult;
  try {
    read = await input.statusSource.readHeartbeat();
  } catch (err) {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'OBSERVER_BLIND',
      reason_code: redactText(
        err instanceof Error ? err.message : 'status_source_throw',
        60,
      ),
      observed_at,
      age_seconds: null,
      missed_intervals: 0,
      last_heartbeat_id: null,
      last_heartbeat_at: null,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }

  if (!read.ok) {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'OBSERVER_BLIND',
      reason_code: redactText(read.code, 60),
      observed_at,
      age_seconds: null,
      missed_intervals: 0,
      last_heartbeat_id: null,
      last_heartbeat_at: null,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }

  if (!read.sample) {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'EXPECTED_BUT_MISSING',
      reason_code: 'heartbeat_absent',
      observed_at,
      age_seconds: null,
      missed_intervals: cfg.config.missed_threshold,
      last_heartbeat_id: null,
      last_heartbeat_at: null,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }

  const sample = read.sample;
  if (sample.environment !== cfg.config.allow_environment) {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'UNKNOWN',
      reason_code: 'cross_environment_confusion',
      observed_at,
      age_seconds: null,
      missed_intervals: 0,
      last_heartbeat_id: null,
      last_heartbeat_at: null,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }
  if (sample.project_ref !== cfg.config.allow_project_ref) {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'UNKNOWN',
      reason_code: 'cross_project_confusion',
      observed_at,
      age_seconds: null,
      missed_intervals: 0,
      last_heartbeat_id: null,
      last_heartbeat_at: null,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }
  if (!isIso(sample.observed_at)) {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'UNKNOWN',
      reason_code: 'invalid_timestamp',
      observed_at,
      age_seconds: null,
      missed_intervals: 0,
      last_heartbeat_id: typeof sample.id === 'string' ? sample.id : null,
      last_heartbeat_at: null,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }

  const hbMs = Date.parse(sample.observed_at);
  if (hbMs > nowMs + cfg.config.clock_skew_tolerance_ms) {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'UNKNOWN',
      reason_code: 'future_timestamp',
      observed_at,
      age_seconds: null,
      missed_intervals: 0,
      last_heartbeat_id: sample.id,
      last_heartbeat_at: sample.observed_at,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }

  if (sample.status === 'fail') {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'FAILED',
      reason_code: 'heartbeat_status_fail',
      observed_at,
      age_seconds: Math.floor((nowMs - hbMs) / 1000),
      missed_intervals: 0,
      last_heartbeat_id: sample.id,
      last_heartbeat_at: sample.observed_at,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }

  const age_seconds = Math.floor((nowMs - hbMs) / 1000);
  const budget = cfg.config.expected_interval_seconds + cfg.config.grace_seconds;
  if (age_seconds > budget) {
    const missed = Math.floor(age_seconds / cfg.config.expected_interval_seconds);
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: missed >= cfg.config.missed_threshold ? 'EXPECTED_BUT_MISSING' : 'STALE',
      reason_code: 'heartbeat_expired',
      observed_at,
      age_seconds,
      missed_intervals: missed,
      last_heartbeat_id: sample.id,
      last_heartbeat_at: sample.observed_at,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }

  if (age_seconds > cfg.config.stale_seconds) {
    return {
      schema_version: EXTERNAL_OBSERVER_SCHEMA,
      health: 'STALE',
      reason_code: 'heartbeat_stale',
      observed_at,
      age_seconds,
      missed_intervals: 0,
      last_heartbeat_id: sample.id,
      last_heartbeat_at: sample.observed_at,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      http_performed: false,
      operationally_active: false,
    };
  }

  return {
    schema_version: EXTERNAL_OBSERVER_SCHEMA,
    health: 'HEALTHY',
    reason_code: 'heartbeat_within_window',
    observed_at,
    age_seconds,
    missed_intervals: 0,
    last_heartbeat_id: sample.id,
    last_heartbeat_at: sample.observed_at,
    environment: STAGE_ENVIRONMENT,
    project_ref: STAGE_PROJECT_REF,
    http_performed: false,
    operationally_active: false,
  };
}

/** Architecture recommendation (documentation constant — not a provisioner). */
export const EXTERNAL_OBSERVER_ARCHITECTURE = {
  compared: ['uptime_heartbeat', 'cloud_scheduler_runtime', 'synthetic_platform', 'second_org_actions_ro'] as const,
  recommended: 'cloud_scheduler_runtime' as const,
  rationale:
    'Independent clock+IAM from GitHub Actions; small injectable runtime can reuse StatusSource; cost/quotas controllable; blast radius limited to read-only heartbeat.',
  github_actions_as_external: 'insufficient_shared_failure_domain',
  provisioned: false,
  operationally_active: false,
} as const;
