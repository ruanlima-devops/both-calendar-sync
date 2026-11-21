/**
 * C3-B.4.1 — Versioned delivery artifact contract (offline / derived fields only).
 * No network. No secrets. additionalProperties rejected.
 */

import { createHash } from 'node:crypto';
import { STAGE_ENVIRONMENT, STAGE_PROJECT_REF } from './types.ts';

export const DELIVERY_ARTIFACT_SCHEMA = 'both-syn05-delivery-artifact:v1' as const;
export const MAX_ARTIFACT_BYTES = 8_192;
export const MAX_FIELD_LEN = {
  fingerprint: 200,
  evaluation_run_id: 128,
  source_commit_sha: 64,
  alert_id: 32,
} as const;

export const ALLOWED_ALERT_IDS = ['ALERT-01', 'ALERT-02', 'ALERT-03', 'ALERT-SELF'] as const;
export type DeliveryAlertId = (typeof ALLOWED_ALERT_IDS)[number];

export const DELIVERY_EVAL_STATUSES = [
  'HEALTHY',
  'FIRING',
  'UNKNOWN',
  'DATA_UNAVAILABLE',
  'RECOVERING',
  'RESOLVED',
] as const;
export type DeliveryEvalStatus = (typeof DELIVERY_EVAL_STATUSES)[number];

export const COMPLETENESS_VALUES = ['complete', 'incomplete'] as const;
export type DeliveryCompleteness = (typeof COMPLETENESS_VALUES)[number];

/** Strict derived payload — no raw logs / PII / credentials. */
export type DeliveryArtifactV1 = {
  schema_version: typeof DELIVERY_ARTIFACT_SCHEMA;
  project_ref: typeof STAGE_PROJECT_REF;
  environment: typeof STAGE_ENVIRONMENT;
  alert_id: DeliveryAlertId;
  fingerprint: string;
  evaluation_status: DeliveryEvalStatus;
  sample_window_start: string;
  sample_window_end: string;
  event_count: number;
  completeness: DeliveryCompleteness;
  evaluation_run_id: string;
  source_commit_sha: string;
};

export type ArtifactValidationOk = {
  ok: true;
  artifact: DeliveryArtifactV1;
  canonical_json: string;
  sha256: string;
};

export type ArtifactValidationErr = {
  ok: false;
  code: string;
  message: string;
};

export type ArtifactValidationResult = ArtifactValidationOk | ArtifactValidationErr;

const FORBIDDEN_KEYS = new Set([
  'event_message',
  'authorization',
  'Authorization',
  'jwt',
  'cookie',
  'email',
  'service_role',
  'pat',
  'token',
  'access_token',
  'stack',
  'stack_trace',
  'sql',
  'raw',
  'headers',
  'calendar',
]);

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/i;
const RUN_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const FP_RE = /^[A-Za-z0-9|_.:-]{3,200}$/;
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const KEY_ORDER: (keyof DeliveryArtifactV1)[] = [
  'schema_version',
  'project_ref',
  'environment',
  'alert_id',
  'fingerprint',
  'evaluation_status',
  'sample_window_start',
  'sample_window_end',
  'event_count',
  'completeness',
  'evaluation_run_id',
  'source_commit_sha',
];

function fail(code: string, message: string): ArtifactValidationErr {
  return { ok: false, code, message };
}

/** Deterministic canonical JSON (fixed key order, no whitespace). */
export function canonicalizeDeliveryArtifact(artifact: DeliveryArtifactV1): string {
  const ordered: Record<string, unknown> = {};
  for (const k of KEY_ORDER) ordered[k] = artifact[k];
  return JSON.stringify(ordered);
}

export function sha256Canonical(canonicalJson: string): string {
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

export function buildDeliveryArtifact(
  partial: Omit<DeliveryArtifactV1, 'schema_version' | 'project_ref' | 'environment'>,
): ArtifactValidationResult {
  const body: DeliveryArtifactV1 = {
    schema_version: DELIVERY_ARTIFACT_SCHEMA,
    project_ref: STAGE_PROJECT_REF,
    environment: STAGE_ENVIRONMENT,
    alert_id: partial.alert_id,
    fingerprint: partial.fingerprint,
    evaluation_status: partial.evaluation_status,
    sample_window_start: partial.sample_window_start,
    sample_window_end: partial.sample_window_end,
    event_count: partial.event_count,
    completeness: partial.completeness,
    evaluation_run_id: partial.evaluation_run_id,
    source_commit_sha: partial.source_commit_sha,
  };
  return validateDeliveryArtifact(body);
}

export function validateDeliveryArtifact(input: unknown): ArtifactValidationResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return fail('not_object', 'artifact_must_be_object');
  }
  const obj = input as Record<string, unknown>;

  for (const k of Object.keys(obj)) {
    if (FORBIDDEN_KEYS.has(k)) return fail('forbidden_field', `forbidden:${k}`);
    if (!(KEY_ORDER as string[]).includes(k)) {
      return fail('additional_property', `unexpected:${k}`);
    }
  }

  for (const k of KEY_ORDER) {
    if (!(k in obj)) return fail('missing_field', `missing:${k}`);
  }

  if (obj.schema_version !== DELIVERY_ARTIFACT_SCHEMA) {
    return fail('unknown_schema', `schema:${String(obj.schema_version)}`);
  }
  if (obj.project_ref !== STAGE_PROJECT_REF) {
    return fail('project_mismatch', 'project_ref_not_stage');
  }
  if (obj.environment !== STAGE_ENVIRONMENT) {
    return fail('environment_mismatch', 'environment_not_stage');
  }
  if (typeof obj.alert_id !== 'string' || !(ALLOWED_ALERT_IDS as readonly string[]).includes(obj.alert_id)) {
    return fail('alert_id_invalid', 'alert_id_not_allowlisted');
  }
  if (typeof obj.fingerprint !== 'string' || !FP_RE.test(obj.fingerprint) || CTRL_RE.test(obj.fingerprint)) {
    return fail('fingerprint_invalid', 'fingerprint_rejected');
  }
  if (obj.fingerprint.length > MAX_FIELD_LEN.fingerprint) {
    return fail('fingerprint_oversized', 'fingerprint_too_long');
  }
  if (
    typeof obj.evaluation_status !== 'string' ||
    !(DELIVERY_EVAL_STATUSES as readonly string[]).includes(obj.evaluation_status)
  ) {
    return fail('status_invalid', 'evaluation_status_rejected');
  }
  if (typeof obj.sample_window_start !== 'string' || !ISO_RE.test(obj.sample_window_start)) {
    return fail('timestamp_invalid', 'sample_window_start_invalid');
  }
  if (typeof obj.sample_window_end !== 'string' || !ISO_RE.test(obj.sample_window_end)) {
    return fail('timestamp_invalid', 'sample_window_end_invalid');
  }
  const startMs = Date.parse(obj.sample_window_start);
  const endMs = Date.parse(obj.sample_window_end);
  if (!(startMs < endMs)) return fail('window_invalid', 'window_order');
  // Max window 24h for derived samples
  if (endMs - startMs > 24 * 60 * 60 * 1000) return fail('window_invalid', 'window_too_large');

  if (typeof obj.event_count !== 'number' || !Number.isInteger(obj.event_count) || obj.event_count < 0) {
    return fail('event_count_invalid', 'event_count_rejected');
  }
  if (obj.event_count > 1_000_000) return fail('event_count_oversized', 'event_count_too_large');

  if (
    typeof obj.completeness !== 'string' ||
    !(COMPLETENESS_VALUES as readonly string[]).includes(obj.completeness)
  ) {
    return fail('completeness_invalid', 'completeness_rejected');
  }
  if (typeof obj.evaluation_run_id !== 'string' || !RUN_ID_RE.test(obj.evaluation_run_id)) {
    return fail('run_id_invalid', 'evaluation_run_id_rejected');
  }
  if (CTRL_RE.test(obj.evaluation_run_id)) return fail('run_id_invalid', 'control_chars');
  if (typeof obj.source_commit_sha !== 'string' || !SHA_RE.test(obj.source_commit_sha)) {
    return fail('commit_sha_invalid', 'source_commit_sha_rejected');
  }

  // Reject shell / path / URL control patterns (allow `|` in fingerprints)
  const risky = `${obj.fingerprint} ${obj.evaluation_run_id}`;
  if (/[;&`$<>]/.test(risky) || risky.includes('..') || /:\/\//.test(risky)) {
    return fail('injection_rejected', 'metacharacters');
  }

  const artifact = obj as unknown as DeliveryArtifactV1;
  const canonical_json = canonicalizeDeliveryArtifact(artifact);
  if (Buffer.byteLength(canonical_json, 'utf8') > MAX_ARTIFACT_BYTES) {
    return fail('payload_oversized', 'max_artifact_bytes');
  }
  const sha256 = sha256Canonical(canonical_json);
  return { ok: true, artifact, canonical_json, sha256 };
}

export function parseDeliveryArtifactJson(raw: string): ArtifactValidationResult {
  if (typeof raw !== 'string') return fail('not_string', 'raw_must_be_string');
  if (Buffer.byteLength(raw, 'utf8') > MAX_ARTIFACT_BYTES) {
    return fail('payload_oversized', 'raw_too_large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('malformed_json', 'json_parse_failed');
  }
  // Prototype pollution guard
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    if ('__proto__' in o || 'constructor' in o || 'prototype' in o) {
      return fail('prototype_pollution', 'dangerous_keys');
    }
  }
  return validateDeliveryArtifact(parsed);
}

export type ProvenanceContext = {
  expected_run_id: string;
  expected_commit_sha: string;
  expected_sha256?: string;
};

/** Receptor-side integrity check — hash alone is not authenticity proof. */
export function verifyArtifactProvenance(
  validated: ArtifactValidationOk,
  ctx: ProvenanceContext,
): ArtifactValidationResult {
  if (validated.artifact.evaluation_run_id !== ctx.expected_run_id) {
    return fail('run_id_mismatch', 'evaluation_run_id_mismatch');
  }
  if (validated.artifact.source_commit_sha.toLowerCase() !== ctx.expected_commit_sha.toLowerCase()) {
    return fail('commit_sha_mismatch', 'source_commit_sha_mismatch');
  }
  if (ctx.expected_sha256 && ctx.expected_sha256.toLowerCase() !== validated.sha256.toLowerCase()) {
    return fail('hash_mismatch', 'sha256_mismatch');
  }
  return validated;
}

export type PathSafetyResult = { ok: true; path: string } | { ok: false; code: string; message: string };

/** Local path allowlist for future artifact files — reject traversal/symlinks conceptually. */
export function assertSafeArtifactPath(
  path: string,
  allowedDir = 'artifacts/syn05-delivery',
): PathSafetyResult {
  if (!path || typeof path !== 'string') return { ok: false, code: 'path_invalid', message: 'empty' };
  if (path.includes('\0') || CTRL_RE.test(path)) return { ok: false, code: 'path_invalid', message: 'control' };
  if (path.includes('..') || path.includes('\\') || path.startsWith('/')) {
    return { ok: false, code: 'path_traversal', message: 'rejected' };
  }
  if (path.includes(':') || /[;|&`$<>]/.test(path)) {
    return { ok: false, code: 'path_invalid', message: 'metachar' };
  }
  const normalized = path.replace(/^\.\//, '');
  if (!normalized.startsWith(`${allowedDir}/`) && normalized !== allowedDir) {
    return { ok: false, code: 'path_not_allowlisted', message: 'outside_allowed_dir' };
  }
  if (normalized.endsWith('/') || normalized.includes('//')) {
    return { ok: false, code: 'path_invalid', message: 'malformed' };
  }
  // Conceptual symlink rejection: refuse names that look like link escapes
  if (/(^|\/)symlink(?=$|\/)/i.test(normalized) || normalized.includes('->')) {
    return { ok: false, code: 'symlink_rejected', message: 'symlink' };
  }
  return { ok: true, path: normalized };
}

/** Whether incomplete/unknown artifacts may mutate Issues — always false for destructive ops. */
export function mayMutateIssuesFromArtifact(artifact: DeliveryArtifactV1): boolean {
  if (artifact.completeness !== 'complete') return false;
  if (artifact.evaluation_status === 'UNKNOWN' || artifact.evaluation_status === 'DATA_UNAVAILABLE') {
    return false;
  }
  return true;
}
