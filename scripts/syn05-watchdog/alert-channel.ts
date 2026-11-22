/**
 * OF-02 — Independent Alert Channel Foundation (offline).
 *
 * Notification sink contract + fake/in-memory sink.
 * Real delivery NEVER activates from env presence alone.
 * Requires: authorization_gate=PO_AUTHORIZED + enabled + provider configured.
 * This authorization: all sinks remain non-operational for real sends.
 */

import { STAGE_ENVIRONMENT, STAGE_PROJECT_REF, type Severity } from './types.ts';
import { redactText } from './redact.ts';

export const ALERT_SCHEMA_VERSION = 'both-syn05-alert-notification:v1' as const;
export const MAX_ALERT_PAYLOAD_BYTES = 4096;
export const DEFAULT_RATE_LIMIT_PER_WINDOW = 5;
export const DEFAULT_RATE_WINDOW_MS = 60 * 60 * 1000;
export const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;
export const DEFAULT_STORM_THRESHOLD = 10;

export type AlertClassification =
  | 'DISABLED_INTENTIONALLY'
  | 'EXPECTED_BUT_MISSING'
  | 'RUNNING'
  | 'FAILED'
  | 'STALE'
  | 'UNKNOWN'
  | 'OBSERVER_BLIND'
  | 'HEALTHY'
  | 'DEGRADED'
  | 'QUOTA_EXCEEDED'
  | 'COST_UNKNOWN';

export type AlertNotificationV1 = {
  schema_version: typeof ALERT_SCHEMA_VERSION;
  event_id: string;
  source: 'watchdog' | 'observer' | 'external_observer';
  environment: typeof STAGE_ENVIRONMENT;
  severity: Severity;
  classification: AlertClassification;
  reason_code: string;
  observed_at: string;
  first_detected_at: string;
  dedup_key: string;
  run_reference?: string;
  action_required: string;
  status: 'open' | 'firing' | 'resolved' | 'suppressed';
};

const ALLOWED_KEYS = new Set([
  'schema_version',
  'event_id',
  'source',
  'environment',
  'severity',
  'classification',
  'reason_code',
  'observed_at',
  'first_detected_at',
  'dedup_key',
  'run_reference',
  'action_required',
  'status',
]);

const FORBIDDEN_CONTENT =
  /(password|passwd|secret|token|apikey|api_key|cookie|authorization|bearer\s|eyJ[A-Za-z0-9_-]+\.|sk_(live|test)_|sbp_|github_pat_|ghp_|SELECT\s|INSERT\s|UPDATE\s|DELETE\s|calendar|@gmail\.|@yahoo\.)/i;

export type AlertSinkResult =
  | { ok: true; delivered: false; code: string; event_id: string }
  | { ok: false; code: string; event_id?: string };

export type AlertSink = {
  readonly kind: string;
  readonly operationally_active: false;
  send: (payload: AlertNotificationV1, nowMs: number) => Promise<AlertSinkResult>;
};

export type AlertChannelConfig = {
  enabled: boolean;
  /** Env vars alone never flip this to PO_AUTHORIZED */
  authorization_gate: 'OFF' | 'PO_AUTHORIZED';
  provider: 'none' | 'email' | 'incident_mgmt' | 'webhook_independent' | 'fake';
  rate_limit_per_window: number;
  rate_window_ms: number;
  cooldown_ms: number;
  storm_threshold: number;
  max_payload_bytes: number;
};

export const DEFAULT_ALERT_CHANNEL_CONFIG: AlertChannelConfig = {
  enabled: false,
  authorization_gate: 'OFF',
  provider: 'none',
  rate_limit_per_window: DEFAULT_RATE_LIMIT_PER_WINDOW,
  rate_window_ms: DEFAULT_RATE_WINDOW_MS,
  cooldown_ms: DEFAULT_COOLDOWN_MS,
  storm_threshold: DEFAULT_STORM_THRESHOLD,
  max_payload_bytes: MAX_ALERT_PAYLOAD_BYTES,
};

export function validateAlertNotification(
  raw: unknown,
): { ok: true; payload: AlertNotificationV1 } | { ok: false; code: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'payload_missing' };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!ALLOWED_KEYS.has(k)) return { ok: false, code: `additional_property:${k}` };
  }
  if (o.schema_version !== ALERT_SCHEMA_VERSION) return { ok: false, code: 'schema_mismatch' };
  if (typeof o.event_id !== 'string' || o.event_id.length < 8 || o.event_id.length > 80) {
    return { ok: false, code: 'event_id_invalid' };
  }
  if (o.source !== 'watchdog' && o.source !== 'observer' && o.source !== 'external_observer') {
    return { ok: false, code: 'source_invalid' };
  }
  if (o.environment !== STAGE_ENVIRONMENT) return { ok: false, code: 'environment_mismatch' };
  if (o.severity !== 'P0' && o.severity !== 'P1' && o.severity !== 'P2') {
    return { ok: false, code: 'severity_invalid' };
  }
  if (typeof o.classification !== 'string') return { ok: false, code: 'classification_invalid' };
  if (typeof o.reason_code !== 'string' || o.reason_code.length > 80) {
    return { ok: false, code: 'reason_invalid' };
  }
  if (typeof o.observed_at !== 'string' || !Number.isFinite(Date.parse(o.observed_at))) {
    return { ok: false, code: 'observed_at_invalid' };
  }
  if (typeof o.first_detected_at !== 'string' || !Number.isFinite(Date.parse(o.first_detected_at))) {
    return { ok: false, code: 'first_detected_invalid' };
  }
  if (typeof o.dedup_key !== 'string' || o.dedup_key.length < 4 || o.dedup_key.length > 160) {
    return { ok: false, code: 'dedup_invalid' };
  }
  if (o.run_reference !== undefined) {
    if (typeof o.run_reference !== 'string' || !/^\d+$/.test(o.run_reference)) {
      return { ok: false, code: 'run_reference_invalid' };
    }
  }
  if (typeof o.action_required !== 'string' || o.action_required.length > 200) {
    return { ok: false, code: 'action_invalid' };
  }
  if (o.status !== 'open' && o.status !== 'firing' && o.status !== 'resolved' && o.status !== 'suppressed') {
    return { ok: false, code: 'status_invalid' };
  }

  const blob = JSON.stringify(o);
  if (blob.length > MAX_ALERT_PAYLOAD_BYTES) return { ok: false, code: 'payload_too_large' };
  if (FORBIDDEN_CONTENT.test(blob)) return { ok: false, code: 'forbidden_content' };
  // Reject emails / PII shapes in free text
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(blob)) {
    return { ok: false, code: 'pii_email_rejected' };
  }
  return { ok: true, payload: o as AlertNotificationV1 };
}

export function sanitizeAlertNotification(input: AlertNotificationV1): AlertNotificationV1 {
  return {
    ...input,
    reason_code: redactText(input.reason_code, 80),
    action_required: redactText(input.action_required, 200),
    dedup_key: redactText(input.dedup_key, 160),
  };
}

type SinkState = {
  recent: Array<{ dedup_key: string; at: number }>;
  lastByDedup: Map<string, number>;
};

function prune(state: SinkState, nowMs: number, windowMs: number): void {
  state.recent = state.recent.filter((e) => nowMs - e.at <= windowMs);
}

/**
 * In-memory fake sink — records attempts, never delivers externally.
 * operationally_active always false.
 */
export function createInMemoryAlertSink(
  config: AlertChannelConfig = DEFAULT_ALERT_CHANNEL_CONFIG,
): AlertSink & { attempts: AlertNotificationV1[]; state: SinkState } {
  const attempts: AlertNotificationV1[] = [];
  const state: SinkState = { recent: [], lastByDedup: new Map() };

  return {
    kind: 'in_memory_fake',
    operationally_active: false as const,
    attempts,
    state,
    async send(raw, nowMs) {
      const v = validateAlertNotification(raw);
      if (!v.ok) return { ok: false, code: v.code, event_id: (raw as AlertNotificationV1)?.event_id };

      if (!config.enabled || config.authorization_gate !== 'PO_AUTHORIZED') {
        return { ok: true, delivered: false, code: 'alert_channel_disabled', event_id: v.payload.event_id };
      }

      // Even when "authorized" in tests, fake sink never claims external delivery.
      const payload = sanitizeAlertNotification(v.payload);
      prune(state, nowMs, config.rate_window_ms);

      const last = state.lastByDedup.get(payload.dedup_key);
      if (last != null && nowMs - last < config.cooldown_ms) {
        return { ok: true, delivered: false, code: 'cooldown_suppressed', event_id: payload.event_id };
      }

      const sameDedup = state.recent.filter((e) => e.dedup_key === payload.dedup_key).length;
      if (sameDedup >= config.rate_limit_per_window) {
        return { ok: true, delivered: false, code: 'rate_limited', event_id: payload.event_id };
      }

      if (state.recent.length >= config.storm_threshold) {
        return { ok: true, delivered: false, code: 'alert_storm_suppressed', event_id: payload.event_id };
      }

      attempts.push(payload);
      state.recent.push({ dedup_key: payload.dedup_key, at: nowMs });
      state.lastByDedup.set(payload.dedup_key, nowMs);
      return { ok: true, delivered: false, code: 'fake_sink_recorded', event_id: payload.event_id };
    },
  };
}

/** Default production-path sink: always disabled. */
export function createDisabledAlertSink(): AlertSink {
  return {
    kind: 'disabled',
    operationally_active: false,
    async send(raw) {
      const id = (raw as AlertNotificationV1)?.event_id ?? 'unknown';
      return { ok: true, delivered: false, code: 'alert_channel_not_authorized', event_id: id };
    },
  };
}

/**
 * Resolve sink from config. Presence of env vars NEVER enables a real provider.
 * Real providers are stubs returning not_authorized until separate PO gate.
 */
export function resolveAlertSink(
  config: AlertChannelConfig = DEFAULT_ALERT_CHANNEL_CONFIG,
  env: Record<string, string | undefined> = {},
): AlertSink {
  // Explicitly ignore env tokens for activation
  void env.BOTH_ALERT_WEBHOOK_URL;
  void env.BOTH_ALERT_EMAIL;
  void env.ALERT_CHANNEL_TOKEN;

  if (config.provider === 'fake' && config.enabled && config.authorization_gate === 'PO_AUTHORIZED') {
    return createInMemoryAlertSink(config);
  }
  return createDisabledAlertSink();
}

export const ALERT_CHANNEL_ARCHITECTURE = {
  compared: ['email', 'monitoring_notify', 'incident_mgmt', 'independent_webhook'] as const,
  recommended: 'independent_webhook' as const,
  rationale:
    'Provider-neutral contract; can target PagerDuty/Opsgenie/Slack-inbound later without coupling to GitHub Issues; fail-closed offline sink available now.',
  po_decision_pending: true,
  provisioned: false,
  operationally_active: false,
  github_issues_as_channel: 'insufficient_shared_failure_domain',
} as const;
