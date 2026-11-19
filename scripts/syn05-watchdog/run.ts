/**
 * Watchdog entrypoint — DEFAULT dry-run, no network.
 *
 * Env:
 * - BOTH_WATCHDOG_DRY_RUN=1 (default if unset)
 * - BOTH_WATCHDOG_GITHUB_WRITE must NOT be 1 in this phase
 * - BOTH_WATCHDOG_ENABLE_NETWORK=1 required to call Supabase (still forbidden in Gate B local)
 */

import { evaluateAll, DEFAULT_THRESHOLDS } from './evaluation.ts';
import { DryRunGithubIssues, isGithubWriteEnabled, MemoryGithubIssues } from './github-issues.ts';
import {
  normalizeConsoleRows,
  normalizeEdgeRows,
  normalizePostgresCronRows,
} from './normalize.ts';
import { reconcileIncidents, summarizeRun } from './reconcile.ts';
import { computeQueryWindow, SupabaseLogsClient } from './supabase-logs-client.ts';
import { STAGE_PROJECT_REF, type NormalizedSignal, type WatchdogRunResult } from './types.ts';
import { safeErrorMessage } from './redact.ts';

export type RunOptions = {
  nowMs?: number;
  dryRun?: boolean;
  /** Injected signals skip network entirely */
  injectedSignals?: NormalizedSignal[];
  dataAvailable?: boolean;
  apiError?: string;
  issues?: DryRunGithubIssues;
};

export async function runWatchdogOnce(opts: RunOptions = {}): Promise<WatchdogRunResult> {
  const dryRun = opts.dryRun ?? process.env.BOTH_WATCHDOG_DRY_RUN !== '0';
  const nowMs = opts.nowMs ?? Date.now();
  const issues = opts.issues ?? new DryRunGithubIssues(new MemoryGithubIssues());

  if (isGithubWriteEnabled(process.env)) {
    throw new Error('github_write_forbidden_in_gate_b_local');
  }

  let signals: NormalizedSignal[] = opts.injectedSignals ?? [];
  let dataAvailable = opts.dataAvailable ?? Boolean(opts.injectedSignals);
  let apiError = opts.apiError;

  const networkEnabled = process.env.BOTH_WATCHDOG_ENABLE_NETWORK === '1';
  if (!opts.injectedSignals && networkEnabled) {
    // Still STAGE-only client; Gate B local certification must not set this.
    const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
    const client = new SupabaseLogsClient({ accessToken: token || 'invalid-token-placeholder' });
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
        dataAvailable = false;
        apiError = edge.error ?? consoleLogs.error ?? 'logs_query_failed';
      } else {
        dataAvailable = true;
        signals = [
          ...normalizeEdgeRows(edge.rows),
          ...normalizeConsoleRows(consoleLogs.rows),
          ...(pg.ok ? normalizePostgresCronRows(pg.rows) : []),
        ];
        if (edge.truncated || consoleLogs.truncated) {
          // Fail-closed: truncated window must not be treated as full HEALTHY evidence for recovery.
          apiError = 'result_truncated';
          // Keep dataAvailable true for FIRING detection, but mark unknown recovery — handled by not resolving when truncated flag set on evaluations below.
        }
      }
    } catch (err) {
      dataAvailable = false;
      apiError = safeErrorMessage(err);
    }
  }

  const evaluations = evaluateAll({
    signals,
    dataAvailable,
    apiError,
    nowMs,
  });

  // Truncation: force DATA_UNAVAILABLE on HEALTHY paths by flipping data if truncated without inject
  if (apiError === 'result_truncated') {
    for (const ev of evaluations) {
      if (ev.evaluation_status === 'HEALTHY') {
        ev.evaluation_status = 'UNKNOWN';
        ev.evidence_summary = 'result_truncated_unknown';
      }
    }
  }

  const { actions } = await reconcileIncidents(issues, evaluations, {
    dryRun,
    healthyToResolve: 2,
  });

  return summarizeRun({
    dry_run: dryRun,
    project_ref: STAGE_PROJECT_REF,
    evaluated_at: new Date(nowMs).toISOString(),
    evaluations,
    actions,
    data_available: dataAvailable,
    api_error: apiError,
  });
}

/** CLI: node --experimental-strip-types scripts/syn05-watchdog/run.ts */
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('/scripts/syn05-watchdog/run.ts') ||
    process.argv[1].endsWith('\\scripts\\syn05-watchdog\\run.ts'));
if (isMain) {
  // Empty inject + dataAvailable true → evaluates with no edge rows (cron may FIRE — expected dry demo).
  runWatchdogOnce({ injectedSignals: [], dataAvailable: true })
    .then((r) => {
      console.log(
        JSON.stringify({
          dry_run: r.dry_run,
          actions: r.actions.length,
          evaluations: r.evaluations.map((e) => ({ id: e.alert_id, status: e.evaluation_status })),
        }),
      );
    })
    .catch((err) => {
      console.error(JSON.stringify({ error: safeErrorMessage(err) }));
      process.exitCode = 1;
    });
}
