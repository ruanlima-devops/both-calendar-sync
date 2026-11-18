/**
 * Independent self-monitor model (local evaluation only).
 * A second job in the *same* workflow is NOT sufficient independence —
 * this module evaluates heartbeats produced by an external checker.
 */

import { STAGE_ENVIRONMENT, STAGE_PROJECT_REF, type AlertEvaluation } from './types.ts';
import { redactText } from './redact.ts';

export type HeartbeatSample = {
  /** ISO time of last successful primary watchdog run */
  last_success_at: string | null;
  /** Expected primary schedule interval */
  expected_interval_ms: number;
  /** Extra grace for Actions queue delay */
  grace_ms: number;
  now_ms: number;
};

export function evaluateWatchdogHeartbeat(sample: HeartbeatSample): AlertEvaluation {
  const end = new Date(sample.now_ms).toISOString();
  const start = new Date(sample.now_ms - sample.expected_interval_ms - sample.grace_ms).toISOString();
  const limit = sample.expected_interval_ms + sample.grace_ms;

  if (!sample.last_success_at) {
    return {
      alert_id: 'ALERT-SELF',
      severity: 'P1',
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      evaluation_status: 'FIRING',
      observed_count: 0,
      time_window: { start, end },
      fingerprint: `ALERT-SELF|${STAGE_PROJECT_REF}|none`,
      evidence_summary: 'primary_watchdog_heartbeat_missing',
      function_or_service: 'watchdog',
    };
  }

  const age = sample.now_ms - Date.parse(sample.last_success_at);
  const firing = !Number.isFinite(age) || age > limit;
  return {
    alert_id: 'ALERT-SELF',
    severity: 'P1',
    environment: STAGE_ENVIRONMENT,
    project_ref: STAGE_PROJECT_REF,
    evaluation_status: firing ? 'FIRING' : 'HEALTHY',
    observed_count: 1,
    time_window: { start, end },
    fingerprint: `ALERT-SELF|${STAGE_PROJECT_REF}|primary`,
    evidence_summary: redactText(
      firing
        ? `primary_watchdog_stale age_ms=${age} limit_ms=${limit}`
        : `primary_watchdog_ok age_ms=${age}`,
      200,
    ),
    function_or_service: 'watchdog',
  };
}

/**
 * Architecture note (documentation helper):
 * Viable independence options (none provisioned in this phase):
 * 1) Separate GitHub workflow with distinct schedule + secrets, writing heartbeat issue/label.
 * 2) External uptime monitor hitting a future read-only health gist/artifact URL.
 * 3) Second repo/org Actions observing workflow_run conclusions via GitHub API RO.
 */
export const SELF_MONITOR_ARCHITECTURE = {
  insufficient: 'same_workflow_second_job',
  recommended_mvp: 'separate_workflow_watchdog_self_yml',
  alternative: 'external_uptime_on_heartbeat_artifact',
} as const;
