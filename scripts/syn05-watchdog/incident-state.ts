/**
 * Durable alert state embedded in GitHub Issue bodies (C3-prep).
 * Fail-closed: untrusted/missing state never advances recovery alone.
 */

import { redactText } from './redact.ts';
import {
  STAGE_ENVIRONMENT,
  STAGE_PROJECT_REF,
  type AlertEvaluation,
  type EvaluationStatus,
  type IncidentRecord,
} from './types.ts';

export const INCIDENT_STATE_SCHEMA_VERSION = 1 as const;
export const INCIDENT_STATE_BEGIN = '<!-- both-syn05-state:v1';
export const INCIDENT_STATE_END = '-->';

export type IncidentAlertStatus =
  | 'FIRING'
  | 'RECOVERING'
  | 'HEALTHY'
  | 'RESOLVED'
  | 'UNKNOWN'
  | 'DATA_UNAVAILABLE';

export type IncidentStateV1 = {
  schema_version: typeof INCIDENT_STATE_SCHEMA_VERSION;
  project_ref: typeof STAGE_PROJECT_REF;
  environment: typeof STAGE_ENVIRONMENT;
  alert_id: string;
  fingerprint: string;
  first_seen_at: string;
  last_seen_at: string;
  consecutive_healthy: number;
  alert_status: IncidentAlertStatus;
  last_transition_at: string;
  /** ISO of last evaluation sample that mutated streak (dedupe same window) */
  last_sample_window_end?: string;
};

export type ParsedIncidentState =
  | { ok: true; state: IncidentStateV1; trusted: true }
  | { ok: false; reason: string; trusted: false; state?: Partial<IncidentStateV1> };

function isIso(s: unknown): s is string {
  return typeof s === 'string' && Number.isFinite(Date.parse(s));
}

function clampHealthy(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 1000);
}

/** Extract and validate state block; fail-closed on corruption. */
export function parseIncidentState(body: string): ParsedIncidentState {
  const text = String(body ?? '');
  const begin = text.indexOf(INCIDENT_STATE_BEGIN);
  if (begin < 0) {
    return { ok: false, reason: 'missing_state_block', trusted: false };
  }
  const afterBegin = begin + INCIDENT_STATE_BEGIN.length;
  const end = text.indexOf(INCIDENT_STATE_END, afterBegin);
  if (end < 0) {
    return { ok: false, reason: 'unclosed_state_block', trusted: false };
  }
  const raw = text.slice(afterBegin, end).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json', trusted: false };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'not_object', trusted: false };
  }
  const o = parsed as Record<string, unknown>;
  if (o.schema_version !== INCIDENT_STATE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `unknown_schema:${String(o.schema_version)}`,
      trusted: false,
      state: o as Partial<IncidentStateV1>,
    };
  }
  if (o.project_ref !== STAGE_PROJECT_REF) {
    return { ok: false, reason: 'project_ref_mismatch', trusted: false };
  }
  if (o.environment !== STAGE_ENVIRONMENT) {
    return { ok: false, reason: 'environment_mismatch', trusted: false };
  }
  if (typeof o.alert_id !== 'string' || typeof o.fingerprint !== 'string') {
    return { ok: false, reason: 'missing_ids', trusted: false };
  }
  if (!isIso(o.first_seen_at) || !isIso(o.last_seen_at) || !isIso(o.last_transition_at)) {
    return { ok: false, reason: 'bad_timestamps', trusted: false };
  }
  const status = o.alert_status;
  const allowed: IncidentAlertStatus[] = [
    'FIRING',
    'RECOVERING',
    'HEALTHY',
    'RESOLVED',
    'UNKNOWN',
    'DATA_UNAVAILABLE',
  ];
  if (typeof status !== 'string' || !allowed.includes(status as IncidentAlertStatus)) {
    return { ok: false, reason: 'bad_status', trusted: false };
  }
  const state: IncidentStateV1 = {
    schema_version: INCIDENT_STATE_SCHEMA_VERSION,
    project_ref: STAGE_PROJECT_REF,
    environment: STAGE_ENVIRONMENT,
    alert_id: redactText(o.alert_id, 64),
    fingerprint: redactText(o.fingerprint, 200),
    first_seen_at: o.first_seen_at,
    last_seen_at: o.last_seen_at,
    consecutive_healthy: clampHealthy(o.consecutive_healthy),
    alert_status: status as IncidentAlertStatus,
    last_transition_at: o.last_transition_at,
    last_sample_window_end:
      typeof o.last_sample_window_end === 'string' ? o.last_sample_window_end : undefined,
  };
  return { ok: true, state, trusted: true };
}

export function serializeIncidentState(state: IncidentStateV1): string {
  const payload: IncidentStateV1 = {
    ...state,
    alert_id: redactText(state.alert_id, 64),
    fingerprint: redactText(state.fingerprint, 200),
    consecutive_healthy: clampHealthy(state.consecutive_healthy),
  };
  const json = JSON.stringify(payload);
  return `${INCIDENT_STATE_BEGIN}\n${json}\n${INCIDENT_STATE_END}`;
}

/** Replace or append state block; preserve human text outside controlled block. */
export function upsertIncidentStateBlock(body: string, state: IncidentStateV1): string {
  const block = serializeIncidentState(state);
  const text = String(body ?? '');
  const begin = text.indexOf(INCIDENT_STATE_BEGIN);
  if (begin < 0) {
    const trimmed = text.trimEnd();
    return trimmed ? `${trimmed}\n\n${block}\n` : `${block}\n`;
  }
  const afterBegin = begin + INCIDENT_STATE_BEGIN.length;
  const end = text.indexOf(INCIDENT_STATE_END, afterBegin);
  if (end < 0) {
    // corrupted — append trusted block; leave garbage for humans
    return `${text.trimEnd()}\n\n${block}\n`;
  }
  const before = text.slice(0, begin);
  const after = text.slice(end + INCIDENT_STATE_END.length);
  return `${before}${block}${after}`;
}

export function stripIncidentStateBlock(body: string): string {
  const text = String(body ?? '');
  const begin = text.indexOf(INCIDENT_STATE_BEGIN);
  if (begin < 0) return text;
  const afterBegin = begin + INCIDENT_STATE_BEGIN.length;
  const end = text.indexOf(INCIDENT_STATE_END, afterBegin);
  if (end < 0) return text;
  return `${text.slice(0, begin)}${text.slice(end + INCIDENT_STATE_END.length)}`.trim();
}

export function statusFromEvaluation(status: EvaluationStatus): IncidentAlertStatus {
  if (
    status === 'FIRING' ||
    status === 'RECOVERING' ||
    status === 'HEALTHY' ||
    status === 'RESOLVED' ||
    status === 'UNKNOWN' ||
    status === 'DATA_UNAVAILABLE'
  ) {
    return status;
  }
  return 'UNKNOWN';
}

export function buildStateFromEvaluation(
  evaluation: AlertEvaluation,
  prev: IncidentStateV1 | null,
  consecutiveHealthy: number,
  nowIso: string,
): IncidentStateV1 {
  const alertStatus = statusFromEvaluation(evaluation.evaluation_status);
  const prevStatus = prev?.alert_status;
  const transitioned = !prev || prevStatus !== alertStatus;
  return {
    schema_version: INCIDENT_STATE_SCHEMA_VERSION,
    project_ref: STAGE_PROJECT_REF,
    environment: STAGE_ENVIRONMENT,
    alert_id: evaluation.alert_id,
    fingerprint: evaluation.fingerprint,
    first_seen_at: prev?.first_seen_at ?? nowIso,
    last_seen_at: nowIso,
    consecutive_healthy: clampHealthy(consecutiveHealthy),
    alert_status: alertStatus,
    last_transition_at: transitioned ? nowIso : (prev?.last_transition_at ?? nowIso),
    last_sample_window_end: evaluation.time_window.end,
  };
}

/**
 * Apply evaluation to durable streak with fail-closed + same-window dedupe.
 * Out-of-order samples (window end < last) do not advance recovery.
 */
export function applyEvaluationToState(
  prev: IncidentStateV1 | null,
  evaluation: AlertEvaluation,
  nowIso: string,
): { state: IncidentStateV1; skipDuplicateSample: boolean } {
  const windowEnd = evaluation.time_window.end;
  if (
    prev?.last_sample_window_end &&
    windowEnd &&
    prev.last_sample_window_end === windowEnd &&
    evaluation.evaluation_status === 'HEALTHY'
  ) {
    // Same evaluation window — do not double-count HEALTHY
    return {
      state: buildStateFromEvaluation(evaluation, prev, prev.consecutive_healthy, nowIso),
      skipDuplicateSample: true,
    };
  }
  if (
    prev?.last_sample_window_end &&
    windowEnd &&
    isIso(windowEnd) &&
    isIso(prev.last_sample_window_end) &&
    Date.parse(windowEnd) < Date.parse(prev.last_sample_window_end)
  ) {
    // Out of order — do not advance
    return { state: prev, skipDuplicateSample: true };
  }

  let consecutive = prev?.consecutive_healthy ?? 0;
  if (evaluation.evaluation_status === 'FIRING') {
    consecutive = 0;
  } else if (evaluation.evaluation_status === 'HEALTHY' || evaluation.evaluation_status === 'RESOLVED') {
    consecutive = consecutive + 1;
  } else if (
    evaluation.evaluation_status === 'DATA_UNAVAILABLE' ||
    evaluation.evaluation_status === 'UNKNOWN'
  ) {
    // keep streak; do not close
    consecutive = prev?.consecutive_healthy ?? 0;
  } else if (evaluation.evaluation_status === 'RECOVERING') {
    consecutive = Math.max(consecutive, 1);
  }

  // Untrusted legacy: treat as streak 0 until we observe samples in-process
  if (!prev) {
    if (evaluation.evaluation_status === 'HEALTHY') consecutive = 1;
    if (evaluation.evaluation_status === 'FIRING') consecutive = 0;
  }

  return {
    state: buildStateFromEvaluation(evaluation, prev, consecutive, nowIso),
    skipDuplicateSample: false,
  };
}

/** Merge parsed body state into IncidentRecord (fail-closed streak). */
export function hydrateIncidentFromBody(incident: IncidentRecord): IncidentRecord {
  const parsed = parseIncidentState(incident.body);
  if (!parsed.ok || !parsed.trusted) {
    return {
      ...incident,
      // Fail-closed: untrusted body cannot claim recovery progress
      consecutive_healthy: 0,
    };
  }
  return {
    ...incident,
    fingerprint: parsed.state.fingerprint || incident.fingerprint,
    alert_id: parsed.state.alert_id || incident.alert_id,
    consecutive_healthy: parsed.state.consecutive_healthy,
    last_seen_at: parsed.state.last_seen_at || incident.last_seen_at,
  };
}

export function pickCanonicalIncident(incidents: IncidentRecord[]): IncidentRecord | null {
  if (!incidents.length) return null;
  return [...incidents].sort((a, b) => a.number - b.number)[0] ?? null;
}
