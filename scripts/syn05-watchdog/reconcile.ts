import type { GithubIssuesPort } from './github-issues.ts';
import { isBotOwned } from './github-issues.ts';
import type { AlertEvaluation, IncidentRecord, ReconcileAction, WatchdogRunResult } from './types.ts';

export type ReconcileOptions = {
  /** Require N consecutive HEALTHY evaluations before close */
  healthyToResolve?: number;
  dryRun: boolean;
  nowIso?: string;
};

/**
 * Reconcile evaluations against bot-owned incidents.
 * Never closes on UNKNOWN / DATA_UNAVAILABLE.
 * Never mutates non-bot issues.
 */
export async function reconcileIncidents(
  issues: GithubIssuesPort,
  evaluations: AlertEvaluation[],
  opts: ReconcileOptions,
): Promise<{ actions: ReconcileAction[]; incidents: IncidentRecord[] }> {
  const needHealthy = opts.healthyToResolve ?? 2;
  const open = await issues.listBotIncidents('open');
  const byFp = new Map(open.map((i) => [i.fingerprint, i]));
  const actions: ReconcileAction[] = [];

  for (const ev of evaluations) {
    const existing = byFp.get(ev.fingerprint);

    if (
      ev.evaluation_status === 'DATA_UNAVAILABLE' ||
      ev.evaluation_status === 'UNKNOWN'
    ) {
      if (existing) {
        // Keep open; optional touch of last_seen only when writing enabled — still update evidence in dry path
        actions.push({ type: 'noop', reason: 'unavailable_keep_open', evaluation: ev, incident: existing });
      } else {
        actions.push({ type: 'noop', reason: 'unavailable_no_create', evaluation: ev });
      }
      continue;
    }

    if (ev.evaluation_status === 'FIRING') {
      if (!existing) {
        actions.push({ type: 'create', evaluation: ev });
        // Port applies mutation (memory/dry-run recorder). Real GitHub write is opt-in outside.
        const created = await issues.createIncident(ev);
        byFp.set(created.fingerprint, created);
      } else {
        actions.push({ type: 'update', incident: existing, evaluation: ev });
        const updated = await issues.updateIncident(existing, ev);
        byFp.set(updated.fingerprint, updated);
      }
      continue;
    }

    // HEALTHY / RESOLVED path
    if (!existing) {
      actions.push({ type: 'noop', reason: 'healthy_no_incident', evaluation: ev });
      continue;
    }

    const nextHealthy = existing.consecutive_healthy + 1;
    if (nextHealthy < needHealthy) {
      // bump consecutive via update without closing
      const bumped: IncidentRecord = { ...existing, consecutive_healthy: nextHealthy };
      await issues.updateIncident(bumped, { ...ev, evaluation_status: 'RECOVERING' });
      actions.push({
        type: 'noop',
        reason: `recovering_${nextHealthy}/${needHealthy}`,
        evaluation: { ...ev, evaluation_status: 'RECOVERING' },
        incident: bumped,
      });
      continue;
    }

    actions.push({ type: 'resolve', incident: existing, evaluation: ev });
    await issues.closeIncident(existing, ev);
    byFp.delete(existing.fingerprint);
  }

  // Safety: ensure we never planned mutations on non-bot
  for (const a of actions) {
    if ('incident' in a && a.incident && !isBotOwned(a.incident) && a.type !== 'noop') {
      throw new Error('reconcile_refused_non_bot');
    }
  }

  return { actions, incidents: [...byFp.values()] };
}

export function summarizeRun(partial: Omit<WatchdogRunResult, 'actions'> & { actions: ReconcileAction[] }): WatchdogRunResult {
  return {
    dry_run: partial.dry_run,
    project_ref: partial.project_ref,
    evaluated_at: partial.evaluated_at,
    evaluations: partial.evaluations,
    actions: partial.actions,
    data_available: partial.data_available,
    api_error: partial.api_error,
  };
}
