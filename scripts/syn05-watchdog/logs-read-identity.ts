/**
 * OF-03 — Operational Logs Read Identity (design + offline validators).
 *
 * NO real credentials. NO live Logs API calls.
 * Separates Logs Read identity from GitHub Issues write tokens.
 */

import { MANAGEMENT_API_HOST, STAGE_PROJECT_REF } from './types.ts';
import { redactText, safeErrorMessage } from './redact.ts';

export const LOGS_READ_IDENTITY_SCHEMA = 'both-syn05-logs-read-identity:v1' as const;

export type LogsAuthMethod = 'supabase_personal_access_token' | 'supabase_access_token_unknown_granularity';

export type LogsReadIdentityConfig = {
  schema_version: typeof LOGS_READ_IDENTITY_SCHEMA;
  project_ref: typeof STAGE_PROJECT_REF;
  api_host: typeof MANAGEMENT_API_HOST;
  auth_method: LogsAuthMethod;
  /** Expected secret name in future vault — never the secret value */
  secret_name: string;
  /** Collector-only; must not be shared with Issues delivery */
  isolation: {
    collector: true;
    evaluator: false;
    delivery: false;
    github_issues: false;
  };
  rotation_days_max: number;
  require_expiry_documented: boolean;
  allow_fallback: false;
};

export const DEFAULT_LOGS_READ_IDENTITY_CONFIG: LogsReadIdentityConfig = {
  schema_version: LOGS_READ_IDENTITY_SCHEMA,
  project_ref: STAGE_PROJECT_REF,
  api_host: MANAGEMENT_API_HOST,
  auth_method: 'supabase_access_token_unknown_granularity',
  secret_name: 'SUPABASE_LOGS_READ_TOKEN',
  isolation: {
    collector: true,
    evaluator: false,
    delivery: false,
    github_issues: false,
  },
  rotation_days_max: 90,
  require_expiry_documented: true,
  allow_fallback: false,
};

export type CredentialPresence =
  | { present: false; code: 'token_absent' }
  | { present: true; shape: 'fake_ok' | 'malformed' | 'looks_revoked_marker'; redacted_prefix: string };

/**
 * Validate config structure only — never contacts network.
 */
export function validateLogsReadIdentityConfig(
  raw: unknown,
): { ok: true; config: LogsReadIdentityConfig } | { ok: false; code: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'config_missing' };
  const o = raw as Partial<LogsReadIdentityConfig>;
  if (o.schema_version !== LOGS_READ_IDENTITY_SCHEMA) return { ok: false, code: 'schema_mismatch' };
  if (o.project_ref !== STAGE_PROJECT_REF) return { ok: false, code: 'project_ref_mismatch' };
  if (o.api_host !== MANAGEMENT_API_HOST) return { ok: false, code: 'api_host_mismatch' };
  if (o.allow_fallback !== false) return { ok: false, code: 'fallback_forbidden' };
  if (!o.isolation || o.isolation.collector !== true) return { ok: false, code: 'isolation_collector_required' };
  if (o.isolation.github_issues !== false) return { ok: false, code: 'isolation_issues_must_be_false' };
  if (o.isolation.delivery !== false) return { ok: false, code: 'isolation_delivery_must_be_false' };
  if (typeof o.secret_name !== 'string' || !/^SUPABASE_[A-Z0-9_]+$/.test(o.secret_name)) {
    return { ok: false, code: 'secret_name_invalid' };
  }
  if (typeof o.rotation_days_max !== 'number' || o.rotation_days_max < 7 || o.rotation_days_max > 365) {
    return { ok: false, code: 'rotation_invalid' };
  }
  return { ok: true, config: o as LogsReadIdentityConfig };
}

/**
 * Inspect a FAKE credential string for shape tests.
 * Never logs the raw value. Rejects empty / missing.
 */
export function inspectLogsCredentialPresence(token: string | undefined | null): CredentialPresence {
  if (token == null || token === '') return { present: false, code: 'token_absent' };
  const t = String(token);
  if (/REVOKED|INVALID|PLACEHOLDER/i.test(t)) {
    return {
      present: true,
      shape: 'looks_revoked_marker',
      redacted_prefix: redactText(t.slice(0, 8), 8),
    };
  }
  // Known Management API PAT shape is platform-specific; accept synthetic test tokens only.
  if (/^sbp_(?:fc_)?[A-Za-z0-9]{20,}$/.test(t) || /^fake_logs_read_[A-Za-z0-9_]{8,}$/.test(t)) {
    return {
      present: true,
      shape: 'fake_ok',
      redacted_prefix: redactText(t.slice(0, 8), 8),
    };
  }
  return {
    present: true,
    shape: 'malformed',
    redacted_prefix: redactText(t.slice(0, 8), 8),
  };
}

/**
 * Fail-closed gate before any future Logs client construction.
 */
export function assertLogsReadReady(input: {
  config: unknown;
  token?: string | null;
}): { ok: true } | { ok: false; code: string } {
  const cfg = validateLogsReadIdentityConfig(input.config);
  if (!cfg.ok) return cfg;
  const presence = inspectLogsCredentialPresence(input.token);
  if (!presence.present) return { ok: false, code: 'token_absent' };
  if (presence.shape === 'malformed') return { ok: false, code: 'token_malformed' };
  if (presence.shape === 'looks_revoked_marker') return { ok: false, code: 'token_revoked_marker' };
  // Fake-ok still does NOT authorize live use in this E2E
  return { ok: false, code: 'live_logs_read_not_authorized_in_of_e2e' };
}

/** Safe error wrapping — never echo Authorization headers. */
export function redactLogsHttpError(status: number, body: string): string {
  return `logs_http_${status}:${redactText(body, 80)}`;
}

export function safeLogsIdentityError(err: unknown): string {
  return safeErrorMessage(err);
}

/**
 * Official scoping notes (design). Supabase Management API PATs historically lack
 * fine-grained "logs-read-only" scopes comparable to GitHub fine-grained PATs.
 * Record residual risk — do not present a broad PAT as least-privilege without caveat.
 */
export const LOGS_READ_IDENTITY_DESIGN = {
  method: 'supabase_management_access_token' as const,
  least_privilege_confirmed: false,
  granularity_gap: 'UNKNOWN_OR_BROADER_THAN_LOGS_ONLY',
  stage_project_only: STAGE_PROJECT_REF,
  separate_from_github_issues_token: true,
  storage: 'ci_environment_secret_or_vault_future',
  rotation: 'max_90_days_documented',
  revocation: 'platform_dashboard_revoke',
  audit: 'secret_access_logs_when_available',
  fail_closed_absent: true,
  provisioned: false,
  live_reads_authorized: false,
} as const;
