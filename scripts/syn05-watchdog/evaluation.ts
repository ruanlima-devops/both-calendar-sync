import {
  evaluateBillingFailures,
  evaluateCronMiss,
  evaluateEdge5xx,
  latestEdgeSuccess,
  type EdgeInvocation,
} from '../../supabase/functions/_shared/observability/alert-evaluator.ts';
import { redactText } from './redact.ts';
import {
  STAGE_ENVIRONMENT,
  STAGE_PROJECT_REF,
  type AlertEvaluation,
  type EvaluationStatus,
  type NormalizedSignal,
} from './types.ts';
import { edgeInvocationsFromSignals } from './normalize.ts';

export type ThresholdConfig = {
  edge5xx: { windowMs: number; minCount: number; allowlist: string[] };
  cron: { expectedIntervalMs: number; graceMs: number; jobName: string };
  billing: { windowMs: number; minProcessingFailures: number };
};

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  edge5xx: {
    windowMs: 15 * 60_000,
    minCount: 3,
    allowlist: [
      'billing-webhook',
      'reconcile-sync',
      'renew-subscriptions',
      'google-oauth',
      'sync-now',
      'delete-account',
    ],
  },
  cron: {
    expectedIntervalMs: 15 * 60_000,
    graceMs: 10 * 60_000,
    jobName: 'reconcile-sync',
  },
  billing: {
    windowMs: 15 * 60_000,
    minProcessingFailures: 3,
  },
};

function fingerprint(parts: string[]): string {
  return parts.join('|');
}

function toStatus(firing: boolean, dataOk: boolean): EvaluationStatus {
  if (!dataOk) return 'DATA_UNAVAILABLE';
  return firing ? 'FIRING' : 'HEALTHY';
}

export function evaluateAll(input: {
  signals: NormalizedSignal[];
  dataAvailable: boolean;
  apiError?: string;
  nowMs: number;
  thresholds?: ThresholdConfig;
}): AlertEvaluation[] {
  const thr = input.thresholds ?? DEFAULT_THRESHOLDS;
  const end = new Date(input.nowMs).toISOString();
  const windowStart = new Date(input.nowMs - thr.edge5xx.windowMs).toISOString();

  if (!input.dataAvailable) {
    const base = {
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      evaluation_status: 'DATA_UNAVAILABLE' as const,
      observed_count: 0,
      time_window: { start: windowStart, end },
      evidence_summary: redactText(input.apiError ?? 'logs_api_unavailable', 200),
    };
    return [
      {
        ...base,
        alert_id: 'ALERT-01',
        severity: 'P1',
        fingerprint: fingerprint(['ALERT-01', STAGE_PROJECT_REF, 'unavailable']),
      },
      {
        ...base,
        alert_id: 'ALERT-02',
        severity: 'P1',
        fingerprint: fingerprint(['ALERT-02', STAGE_PROJECT_REF, 'unavailable']),
      },
      {
        ...base,
        alert_id: 'ALERT-03',
        severity: 'P1',
        fingerprint: fingerprint(['ALERT-03', STAGE_PROJECT_REF, 'unavailable']),
      },
    ];
  }

  const edgeRows: EdgeInvocation[] = edgeInvocationsFromSignals(input.signals);
  const a01 = evaluateEdge5xx(edgeRows, {
    windowMs: thr.edge5xx.windowMs,
    minCount: thr.edge5xx.minCount,
    functionAllowlist: thr.edge5xx.allowlist,
    nowMs: input.nowMs,
  });

  const lastOk = latestEdgeSuccess(edgeRows, thr.cron.jobName);
  const a02 = evaluateCronMiss(lastOk, {
    jobName: thr.cron.jobName,
    expectedIntervalMs: thr.cron.expectedIntervalMs,
    graceMs: thr.cron.graceMs,
    nowMs: input.nowMs,
  });

  const billingEvents = input.signals
    .filter((s): s is Extract<NormalizedSignal, { kind: 'console_event' }> => s.kind === 'console_event')
    .filter(
      (s) =>
        s.event_name.toLowerCase().includes('billing') ||
        (s.message ?? '').toLowerCase().includes('billing'),
    )
    .map((s) => ({
      timestamp: s.timestamp,
      event_name: s.event_name,
      message: s.message,
      outcome: s.outcome,
    }));

  // Also treat edge 500 on billing-webhook as processing signal
  const billingEdgeFails = input.signals.filter(
    (s) => s.kind === 'edge_http' && s.functionName === 'billing-webhook' && s.status >= 500,
  );
  for (const e of billingEdgeFails) {
    billingEvents.push({
      timestamp: e.timestamp,
      event_name: 'billing-webhook_http_5xx',
      message: 'billing-webhook http 5xx',
      outcome: 'failed',
    });
  }

  const a03 = evaluateBillingFailures(billingEvents, {
    windowMs: thr.billing.windowMs,
    minProcessingFailures: thr.billing.minProcessingFailures,
    nowMs: input.nowMs,
  });

  return [
    {
      alert_id: 'ALERT-01',
      severity: a01.severity,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      evaluation_status: toStatus(a01.firing, true),
      observed_count: a01.sample_count,
      time_window: {
        start: a01.window_start ?? windowStart,
        end: a01.window_end ?? end,
      },
      fingerprint: fingerprint(['ALERT-01', STAGE_PROJECT_REF, a01.dedupe_key]),
      evidence_summary: redactText(a01.reason, 240),
      function_or_service: 'edge',
    },
    {
      alert_id: 'ALERT-02',
      severity: a02.severity,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      evaluation_status: toStatus(a02.firing, true),
      observed_count: a02.sample_count,
      time_window: { start: windowStart, end: a02.window_end ?? end },
      fingerprint: fingerprint(['ALERT-02', STAGE_PROJECT_REF, a02.dedupe_key]),
      evidence_summary: redactText(a02.reason, 240),
      function_or_service: thr.cron.jobName,
    },
    {
      alert_id: 'ALERT-03',
      severity: a03.severity,
      environment: STAGE_ENVIRONMENT,
      project_ref: STAGE_PROJECT_REF,
      evaluation_status: toStatus(a03.firing, true),
      observed_count: a03.sample_count,
      time_window: {
        start: a03.window_start ?? windowStart,
        end: a03.window_end ?? end,
      },
      fingerprint: fingerprint(['ALERT-03', STAGE_PROJECT_REF, a03.dedupe_key]),
      evidence_summary: redactText(a03.reason, 240),
      function_or_service: 'billing-webhook',
    },
  ];
}
