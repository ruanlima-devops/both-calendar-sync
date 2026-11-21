import type { GithubIssuesPort } from './github-issues.ts';
import { isBotOwned } from './github-issues.ts';
import { pickCanonicalIncident } from './incident-state.ts';
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
 * Cross-run streak comes from durable state hydrated by the IssueStore.
 */
export async function reconcileIncidents(
  issues: GithubIssuesPort,
  evaluations: AlertEvaluation[],
  opts: ReconcileOptions,
): Promise<{ actions: ReconcileAction[]; incidents: IncidentRecord[]; duplicateFingerprints: string[] }> {
  const needHealthy = opts.healthyToResolve ?? 2;
  const open = await issues.listBotIncidents('open');
  const byFp = new Map<string, IncidentRecord[]>();
  for (const i of open) {
    const list = byFp.get(i.fingerprint) ?? [];
    list.push(i);
    byFp.set(i.fingerprint, list);
  }
  const duplicateFingerprints = [...byFp.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([fp]) => fp);

  const canonical = new Map<string, IncidentRecord>();
  for (const [fp, list] of byFp) {
    const picked = pickCanonicalIncident(list);
    if (picked) canonical.set(fp, picked);
  }

  const actions: ReconcileAction[] = [];

  for (const ev of evaluations) {
    let existing = canonical.get(ev.fingerprint) ?? null;

    // Search-before-create (adapter-level) when map miss
    if (!existing && issues.findOpenByFingerprint) {
      existing = await issues.findOpenByFingerprint(ev.fingerprint);
      if (existing) canonical.set(ev.fingerprint, existing);
    }

    if (ev.evaluation_status === 'DATA_UNAVAILABLE' || ev.evaluation_status === 'UNKNOWN') {
      if (existing) {
        actions.push({
          type: 'noop',
          reason: 'unavailable_keep_open',
          evaluation: ev,
          incident: existing,
        });
      } else {
        actions.push({ type: 'noop', reason: 'unavailable_no_create', evaluation: ev });
      }
      continue;
    }

    if (ev.evaluation_status === 'FIRING') {
      if (!existing) {
        // Prefer safe reopen of closed bot issue when port supports it (search-before-create still inside createIncident)
        let closed: IncidentRecord | null = null;
        if (issues.findClosedByFingerprint) {
          closed = await issues.findClosedByFingerprint(ev.fingerprint);
        }
        if (closed && issues.reopenIncident) {
          actions.push({ type: 'update', incident: closed, evaluation: ev });
          const reopened = await issues.reopenIncident(closed, ev);
          canonical.set(reopened.fingerprint, reopened);
        } else {
          actions.push({ type: 'create', evaluation: ev });
          const created = await issues.createIncident(ev);
          canonical.set(created.fingerprint, created);
        }
      } else {
        actions.push({ type: 'update', incident: existing, evaluation: ev });
        const updated = await issues.updateIncident(existing, ev);
        canonical.set(updated.fingerprint, updated);
      }
      continue;
    }

    // HEALTHY / RESOLVED path
    if (!existing) {
      actions.push({ type: 'noop', reason: 'healthy_no_incident', evaluation: ev });
      continue;
    }

    const updated = await issues.updateIncident(existing, ev);
    canonical.set(updated.fingerprint, updated);

    if (updated.consecutive_healthy < needHealthy) {
      actions.push({
        type: 'noop',
        reason: `recovering_${updated.consecutive_healthy}/${needHealthy}`,
        evaluation: { ...ev, evaluation_status: 'RECOVERING' },
        incident: updated,
      });
      continue;
    }

    actions.push({ type: 'resolve', incident: updated, evaluation: ev });
    await issues.closeIncident(updated, ev);
    canonical.delete(ev.fingerprint);
  }

  for (const a of actions) {
    if ('incident' in a && a.incident && !isBotOwned(a.incident) && a.type !== 'noop') {
      throw new Error('reconcile_refused_non_bot');
    }
  }

  return {
    actions,
    incidents: [...canonical.values()],
    duplicateFingerprints,
  };
}

export function summarizeRun(
  partial: Omit<WatchdogRunResult, 'actions'> & { actions: ReconcileAction[] },
): WatchdogRunResult {
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
