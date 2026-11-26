/**
 * C3-B.5 — Fail-closed write authorization gate.
 * PERMISSION_AVAILABLE ≠ WRITE_AUTHORIZED.
 * Defaults: DRY_RUN=1, WRITE=0, NETWORK=0. Supervised oneshot requires explicit auth bag.
 */

import {
  mayMutateIssuesFromArtifact,
  type ArtifactValidationOk,
  type DeliveryArtifactV1,
} from './delivery-artifact.ts';
import { C3_B5_FINGERPRINT_PREFIX } from './supervised-quota.ts';
import { STAGE_ENVIRONMENT, STAGE_PROJECT_REF } from './types.ts';

export type DeliveryMode = 'simulation' | 'read-only' | 'supervised-write' | 'scheduled-write';

export type WriteGateEnv = Record<string, string | undefined>;

export type WriteGateInput = {
  env?: WriteGateEnv;
  artifact: DeliveryArtifactV1;
  validated: ArtifactValidationOk;
  /** Declared GITHUB_TOKEN permission availability (YAML) — never alone sufficient */
  permission_issues_write_available?: boolean;
  /** Adapter real wired into runtime */
  adapter_enabled?: boolean;
  /** Token present in process (future) — must not be logged */
  token_present?: boolean;
  repo_full_name?: string;
  concurrency_ok?: boolean;
  within_authorized_window?: boolean;
  operations_remaining?: number;
  trusted_provenance?: boolean;
  /** C3-B.5 Actions context */
  actions_event_name?: string;
  actions_workflow_name?: string;
  actions_job_name?: string;
  actions_ref?: string;
  expected_commit_sha?: string;
  synthetic_fixture?: boolean;
};

export type WriteGateDecision =
  | { authorized: false; code: string; mode: DeliveryMode | 'blocked' }
  | { authorized: true; mode: DeliveryMode; note: string };

export const ALLOWED_REPO = 'ruanlima-devops/both-calendar-sync' as const;
export const C3_B5_WORKFLOW_NAME = 'Both STAGE Watchdog Delivery' as const;
export const C3_B5_JOB_NAME = 'delivery-supervised' as const;

export function resolveDeliveryMode(env: WriteGateEnv = {}): DeliveryMode | 'blocked' {
  const mode = env.BOTH_WATCHDOG_DELIVERY_MODE;
  if (!mode || mode === 'simulation') return 'simulation';
  if (mode === 'read-only' || mode === 'supervised-write' || mode === 'scheduled-write') return mode;
  return 'blocked';
}

export function isDryRun(env: WriteGateEnv = {}): boolean {
  return env.BOTH_WATCHDOG_DRY_RUN !== '0';
}

export function isWriteFlagOn(env: WriteGateEnv = {}): boolean {
  return env.BOTH_WATCHDOG_GITHUB_WRITE === '1';
}

export function isNetworkFlagOn(env: WriteGateEnv = {}): boolean {
  return env.BOTH_WATCHDOG_ENABLE_NETWORK === '1';
}

export function isC3B5Authorized(env: WriteGateEnv = {}): boolean {
  return env.BOTH_WATCHDOG_C3_B5_AUTHORIZED === '1';
}

export function isC3CAuthorized(env: WriteGateEnv = {}): boolean {
  return env.BOTH_WATCHDOG_C3_C_AUTHORIZED === '1';
}

/**
 * Fail-closed gate. WRITE=1 alone never authorizes.
 * C3-B.5 supervised path requires full auth bag + synthetic fixture fingerprint.
 */
export function evaluateWriteGate(input: WriteGateInput): WriteGateDecision {
  const env = input.env ?? {};
  const mode = resolveDeliveryMode(env);

  if (mode === 'blocked') {
    return { authorized: false, code: 'mode_invalid', mode: 'blocked' };
  }

  if (isWriteFlagOn(env) && isDryRun(env)) {
    return { authorized: false, code: 'conflicting_flags_write_with_dry_run', mode };
  }
  if (isNetworkFlagOn(env) && !isWriteFlagOn(env) && mode === 'supervised-write') {
    return { authorized: false, code: 'network_without_write_auth', mode };
  }

  if (isDryRun(env) || !isWriteFlagOn(env)) {
    return { authorized: false, code: 'write_disabled_by_default', mode };
  }

  if (mode === 'simulation' || mode === 'read-only') {
    return { authorized: false, code: 'mode_forbids_write', mode };
  }

  if (mode === 'scheduled-write') {
    return { authorized: false, code: 'scheduled_write_not_authorized', mode };
  }

  // C3-B.4.1 hard stop unless explicitly lifted for C3-B.5 oneshot
  if (env.BOTH_WATCHDOG_C3_B41_FORCE_BLOCK !== '0') {
    return { authorized: false, code: 'c3_b41_hard_block', mode };
  }

  if (!isC3B5Authorized(env)) {
    return { authorized: false, code: 'c3_b5_not_authorized', mode };
  }

  if (!input.permission_issues_write_available) {
    return { authorized: false, code: 'permission_not_available', mode };
  }
  if (!input.adapter_enabled) {
    return { authorized: false, code: 'adapter_not_enabled', mode };
  }
  if (!input.token_present) {
    return { authorized: false, code: 'token_absent', mode };
  }
  if (!input.trusted_provenance) {
    return { authorized: false, code: 'provenance_untrusted', mode };
  }
  if (input.concurrency_ok === false) {
    return { authorized: false, code: 'concurrency_blocked', mode };
  }
  if (input.within_authorized_window === false) {
    return { authorized: false, code: 'outside_authorized_window', mode };
  }
  if (typeof input.operations_remaining === 'number' && input.operations_remaining <= 0) {
    return { authorized: false, code: 'quota_exhausted', mode };
  }

  const repo = input.repo_full_name ?? env.GITHUB_REPOSITORY ?? '';
  if (repo !== ALLOWED_REPO) {
    return { authorized: false, code: 'repo_not_allowlisted', mode };
  }

  if (input.artifact.project_ref !== STAGE_PROJECT_REF) {
    return { authorized: false, code: 'project_mismatch', mode };
  }
  if (input.artifact.environment !== STAGE_ENVIRONMENT) {
    return { authorized: false, code: 'environment_mismatch', mode };
  }
  if (!input.validated.ok) {
    return { authorized: false, code: 'artifact_invalid', mode };
  }
  if (!mayMutateIssuesFromArtifact(input.artifact)) {
    return { authorized: false, code: 'artifact_forbids_mutation', mode };
  }

  // Synthetic fixture only — refuse real operational fingerprints
  if (input.synthetic_fixture === false) {
    return { authorized: false, code: 'fixture_not_synthetic', mode };
  }
  if (!input.artifact.fingerprint.startsWith(C3_B5_FINGERPRINT_PREFIX)) {
    return { authorized: false, code: 'fingerprint_not_c3_b5_test', mode };
  }

  // Actions context binding
  if (input.actions_event_name && input.actions_event_name !== 'workflow_dispatch') {
    return { authorized: false, code: 'unexpected_event', mode };
  }
  if (input.actions_workflow_name && input.actions_workflow_name !== C3_B5_WORKFLOW_NAME) {
    return { authorized: false, code: 'workflow_not_authorized', mode };
  }
  if (input.actions_job_name && input.actions_job_name !== C3_B5_JOB_NAME) {
    return { authorized: false, code: 'job_not_authorized', mode };
  }
  if (input.actions_ref && input.actions_ref !== 'refs/heads/develop') {
    return { authorized: false, code: 'ref_not_develop', mode };
  }
  if (
    input.expected_commit_sha &&
    input.artifact.source_commit_sha.toLowerCase() !== input.expected_commit_sha.toLowerCase()
  ) {
    return { authorized: false, code: 'commit_sha_mismatch', mode };
  }

  return {
    authorized: true,
    mode: 'supervised-write',
    note: 'c3_b5_supervised_oneshot_authorized',
  };
}

/** Convenience: C0 env bag defaults. */
export function defaultC0Env(extra: WriteGateEnv = {}): WriteGateEnv {
  return {
    BOTH_WATCHDOG_DRY_RUN: '1',
    BOTH_WATCHDOG_GITHUB_WRITE: '0',
    BOTH_WATCHDOG_ENABLE_NETWORK: '0',
    BOTH_WATCHDOG_DELIVERY_MODE: 'simulation',
    BOTH_WATCHDOG_C3_B41_FORCE_BLOCK: '1',
    BOTH_WATCHDOG_C3_B5_AUTHORIZED: '0',
    BOTH_WATCHDOG_C3_C_AUTHORIZED: '0',
    ...extra,
  };
}
