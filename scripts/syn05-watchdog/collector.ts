/**
 * C3-B.4.1 — Collector boundary (logical).
 * No GitHub Issues access. No import-time network. Logs client only via explicit call.
 */

import { computeQueryWindow, SupabaseLogsClient } from './supabase-logs-client.ts';
import {
  normalizeConsoleRows,
  normalizeEdgeRows,
  normalizePostgresCronRows,
} from './normalize.ts';
import { DEFAULT_THRESHOLDS } from './evaluation.ts';
import { STAGE_PROJECT_REF, type NormalizedSignal } from './types.ts';
import { safeErrorMessage } from './redact.ts';

export type CollectorResult = {
  project_ref: typeof STAGE_PROJECT_REF;
  signals: NormalizedSignal[];
  data_available: boolean;
  completeness: 'complete' | 'incomplete';
  api_error?: string;
};

/** Pure offline collector from injected signals — used by C0 / tests. */
export function collectFromInjectedSignals(
  signals: NormalizedSignal[],
  opts?: { dataAvailable?: boolean; completeness?: 'complete' | 'incomplete'; apiError?: string },
): CollectorResult {
  return {
    project_ref: STAGE_PROJECT_REF,
    signals: [...signals],
    data_available: opts?.dataAvailable ?? true,
    completeness: opts?.completeness ?? 'complete',
    api_error: opts?.apiError,
  };
}

/**
 * Future network collect — NOT invoked by C0 runtime.
 * Requires BOTH_WATCHDOG_ENABLE_NETWORK=1 and a token; still never touches GitHub Issues.
 */
export async function collectStageLogs(opts: {
  accessToken: string;
  nowMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<CollectorResult> {
  if (!opts.accessToken || opts.accessToken.length < 8) {
    return {
      project_ref: STAGE_PROJECT_REF,
      signals: [],
      data_available: false,
      completeness: 'incomplete',
      api_error: 'token_absent',
    };
  }
  const client = new SupabaseLogsClient({
    accessToken: opts.accessToken,
    fetchImpl: opts.fetchImpl,
  });
  const nowMs = opts.nowMs ?? Date.now();
  const window = computeQueryWindow({
    nowMs,
    windowMs: DEFAULT_THRESHOLDS.edge5xx.windowMs,
    overlapMs: 2 * 60_000,
  });
  try {
    const edge = await client.query({
      source: 'function_edge_logs',
      iso_timestamp_start: window.start,
      iso_timestamp_end: window.end,
      limit: 300,
    });
    const consoleLogs = await client.query({
      source: 'function_logs',
      iso_timestamp_start: window.start,
      iso_timestamp_end: window.end,
      limit: 300,
    });
    const pg = await client.query({
      source: 'postgres_logs',
      iso_timestamp_start: window.start,
      iso_timestamp_end: window.end,
      whereExtra: "event_message like '%both_invoke_cron%'",
      limit: 100,
    });
    if (!edge.ok || !consoleLogs.ok) {
      return {
        project_ref: STAGE_PROJECT_REF,
        signals: [],
        data_available: false,
        completeness: 'incomplete',
        api_error: edge.error ?? consoleLogs.error ?? 'logs_query_failed',
      };
    }
    const incomplete =
      edge.completeness === 'incomplete' ||
      consoleLogs.completeness === 'incomplete' ||
      edge.truncated ||
      consoleLogs.truncated ||
      (pg.ok && (pg.completeness === 'incomplete' || pg.truncated));
    return {
      project_ref: STAGE_PROJECT_REF,
      signals: [
        ...normalizeEdgeRows(edge.rows),
        ...normalizeConsoleRows(consoleLogs.rows),
        ...(pg.ok ? normalizePostgresCronRows(pg.rows) : []),
      ],
      data_available: true,
      completeness: incomplete ? 'incomplete' : 'complete',
      api_error: incomplete ? 'result_truncated' : undefined,
    };
  } catch (err) {
    return {
      project_ref: STAGE_PROJECT_REF,
      signals: [],
      data_available: false,
      completeness: 'incomplete',
      api_error: safeErrorMessage(err),
    };
  }
}

/** Guard: Collector module must not export Issues ports. */
export const COLLECTOR_FORBIDS_GITHUB_ISSUES = true as const;
