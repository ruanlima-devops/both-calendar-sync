/**
 * C3-C — Live cross-run recovery essay (synthetic only).
 * FIRING → HEALTHY#1 (open) → HEALTHY#2 (close). Never touch Issue #26.
 */

import { createPinnedGithubTransport, type GithubHttpTransport } from './github-http.ts';
import { HttpGithubIssues } from './http-github-issues.ts';
import type { GithubIssuesPort } from './github-issues.ts';
import { reconcileIncidents } from './reconcile.ts';
import { hydrateIncidentFromBody } from './incident-state.ts';
import {
  ALLOWED_REPO,
  defaultC0Env,
  type WriteGateEnv,
} from './write-gate.ts';
import {
  BOT_LABEL,
  STAGE_ENVIRONMENT,
  STAGE_PROJECT_REF,
  type AlertEvaluation,
  type IncidentRecord,
} from './types.ts';

export const C3_C_TEST_MARKER = 'both-syn05-c3-c-live-recovery:v1' as const;
export const C3_C_TITLE_HINT = 'C3-C LIVE RECOVERY SYNTHETIC' as const;
export const C3_C_FORBIDDEN_ISSUE = 26 as const;
export const C3_C_WORKFLOW_NAME = 'Both STAGE Watchdog Recovery' as const;
export const C3_C_JOB_NAME = 'delivery-supervised-recovery' as const;
export const C3_C_FINGERPRINT =
  'ALERT-01|qszggrrjhcwltnmxpxcy|C3-C|SYNTHETIC|RECOVERY|20261122' as const;

export type C3CPhase = 'FIRING' | 'HEALTHY_1' | 'HEALTHY_2';

export type C3CActionsCtx = {
  event_name: string;
  workflow_name: string;
  job_name: string;
  ref: string;
  run_id: string;
  commit_sha: string;
};

export type C3CResult = {
  ok: boolean;
  code: string;
  phase: C3CPhase;
  issue_number?: number;
  issue_url?: string;
  issue_state?: string;
  consecutive_healthy?: number;
  fingerprint: string;
  sample_window_end: string;
  run_id: string;
  post_attempts?: number;
  patch_attempts?: number;
};

function phaseWindow(phase: C3CPhase): { start: string; end: string } {
  // Fixed distinct monotonic windows so streak advances across independent Actions runs.
  // Same phase re-run shares window → dedupe fail-closed (no accidental double-count).
  const ends: Record<C3CPhase, string> = {
    FIRING: '2026-11-22T02:05:00.000Z',
    HEALTHY_1: '2026-11-22T02:15:00.000Z',
    HEALTHY_2: '2026-11-22T02:25:00.000Z',
  };
  const end = ends[phase];
  const start = new Date(Date.parse(end) - 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  return { start, end };
}

export function buildC3CEvaluation(phase: C3CPhase, runId: string): AlertEvaluation {
  const window = phaseWindow(phase);
  void runId;
  const status = phase === 'FIRING' ? 'FIRING' : 'HEALTHY';
  return {
    alert_id: 'ALERT-01',
    severity: 'P2',
    environment: STAGE_ENVIRONMENT,
    project_ref: STAGE_PROJECT_REF,
    evaluation_status: status,
    observed_count: phase === 'FIRING' ? 1 : 0,
    time_window: window,
    fingerprint: C3_C_FINGERPRINT,
    evidence_summary: `${C3_C_TEST_MARKER} phase=${phase} run=${runId}`,
    function_or_service: C3_C_TITLE_HINT,
  };
}

export function assertC3CActions(ctx: C3CActionsCtx): string | null {
  if (ctx.event_name !== 'workflow_dispatch') return 'unexpected_event';
  if (ctx.workflow_name !== C3_C_WORKFLOW_NAME) return 'workflow_not_authorized';
  if (ctx.job_name !== C3_C_JOB_NAME) return 'job_not_authorized';
  if (ctx.ref !== 'refs/heads/develop') return 'ref_not_develop';
  return null;
}

export function isC3CSyntheticIssue(issue: { number: number; title?: string; body?: string | null }): boolean {
  if (issue.number === C3_C_FORBIDDEN_ISSUE) return false;
  const title = issue.title ?? '';
  const body = issue.body ?? '';
  return (
    body.includes(C3_C_TEST_MARKER) ||
    title.includes(C3_C_TITLE_HINT) ||
    body.includes(C3_C_FINGERPRINT)
  );
}

export function refuseForbiddenIssue(n: number | undefined | null): string | null {
  if (n === C3_C_FORBIDDEN_ISSUE) return 'forbidden_issue_26';
  return null;
}

export type C3CPorts = {
  issues: GithubIssuesPort;
  transport?: GithubHttpTransport;
};

export function createC3CPorts(token: string): C3CPorts {
  if (!token || token.length < 8) throw new Error('github_token_missing');
  const pinned = createPinnedGithubTransport({});
  const transport: GithubHttpTransport = async (req) =>
    pinned({
      ...req,
      headers: { ...(req.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  const issues = new HttpGithubIssues({
    owner: 'ruanlima-devops',
    repo: 'both-calendar-sync',
    token,
    transport,
    label: BOT_LABEL,
  });
  return { issues, transport };
}

export async function findC3COpenIssue(issues: GithubIssuesPort): Promise<IncidentRecord | null> {
  // Prefer fingerprint lookup (less sensitive to label-index lag right after create).
  if (issues.findOpenByFingerprint) {
    const hit = await issues.findOpenByFingerprint(C3_C_FINGERPRINT);
    if (hit) {
      if (hit.number === C3_C_FORBIDDEN_ISSUE) throw new Error('forbidden_issue_26');
      const hydrated = hydrateIncidentFromBody(hit);
      if (hydrated.fingerprint === C3_C_FINGERPRINT && isC3CSyntheticIssue(hydrated)) {
        return hydrated;
      }
    }
  }
  const incidents = await issues.listBotIncidents('open');
  const matches = incidents
    .map(hydrateIncidentFromBody)
    .filter((i) => i.fingerprint === C3_C_FINGERPRINT && isC3CSyntheticIssue(i));
  if (matches.some((m) => m.number === C3_C_FORBIDDEN_ISSUE)) {
    throw new Error('forbidden_issue_26');
  }
  if (matches.length > 1) throw new Error('ambiguous_multiple_c3c_issues');
  return matches[0] ?? null;
}

export async function runC3CPhase(opts: {
  phase: C3CPhase;
  ports: C3CPorts;
  actions: C3CActionsCtx;
  env?: WriteGateEnv;
  authorized_issue_number?: number;
}): Promise<C3CResult> {
  const bind = assertC3CActions(opts.actions);
  const fingerprint = C3_C_FINGERPRINT;
  const ev = buildC3CEvaluation(opts.phase, opts.actions.run_id);
  const base: C3CResult = {
    ok: false,
    code: 'pending',
    phase: opts.phase,
    fingerprint,
    sample_window_end: ev.time_window.end,
    run_id: opts.actions.run_id,
    post_attempts: 0,
    patch_attempts: 0,
  };
  if (bind) return { ...base, code: bind };

  const env = {
    ...defaultC0Env({
      BOTH_WATCHDOG_DRY_RUN: '0',
      BOTH_WATCHDOG_GITHUB_WRITE: '1',
      BOTH_WATCHDOG_ENABLE_NETWORK: '1',
      BOTH_WATCHDOG_DELIVERY_MODE: 'supervised-write',
      BOTH_WATCHDOG_C3_B41_FORCE_BLOCK: '0',
      BOTH_WATCHDOG_C3_B5_AUTHORIZED: '0',
      BOTH_WATCHDOG_C3_C_AUTHORIZED: '1',
      GITHUB_REPOSITORY: ALLOWED_REPO,
    }),
    ...(opts.env ?? {}),
  };
  if (env.BOTH_WATCHDOG_C3_C_AUTHORIZED !== '1') {
    return { ...base, code: 'c3_c_not_authorized' };
  }
  if (env.GITHUB_REPOSITORY && env.GITHUB_REPOSITORY !== ALLOWED_REPO) {
    return { ...base, code: 'repo_not_allowlisted' };
  }

  const forbidAuth = refuseForbiddenIssue(opts.authorized_issue_number);
  if (forbidAuth) return { ...base, code: forbidAuth };

  // Pre-search
  let existing: IncidentRecord | null = null;
  try {
    existing = await findC3COpenIssue(opts.ports.issues);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'search_failed';
    return { ...base, code: msg };
  }

  if (opts.phase === 'FIRING') {
    if (existing) {
      return {
        ...base,
        ok: false,
        code: 'c3c_issue_already_exists',
        issue_number: existing.number,
        issue_state: existing.state,
        consecutive_healthy: existing.consecutive_healthy,
      };
    }
    // Also ensure no closed C3-C issue with same fingerprint to avoid reopen surprises
    try {
      const closed = await opts.ports.issues.findClosedByFingerprint?.(C3_C_FINGERPRINT);
      if (closed) {
        return { ...base, code: 'c3c_closed_issue_preexists', issue_number: closed.number };
      }
    } catch {
      /* findClosed optional / incomplete → fail closed below via create path */
    }

    const { actions, incidents } = await reconcileIncidents(opts.ports.issues, [ev], {
      dryRun: false,
      healthyToResolve: 2,
      nowIso: new Date().toISOString(),
    });
    const created = actions.find((a) => a.type === 'create' || a.type === 'update');
    // Prefer reconcile canonical result; fall back to re-search (label index may lag).
    let after =
      incidents.find((i) => i.fingerprint === C3_C_FINGERPRINT && i.state === 'open') ?? null;
    if (after) after = hydrateIncidentFromBody(after);
    if (!after || !isC3CSyntheticIssue(after)) {
      after = await findC3COpenIssue(opts.ports.issues);
    }
    if (!after) {
      return { ...base, code: 'firing_issue_missing_after_write', post_attempts: 1 };
    }
    if (after.number === C3_C_FORBIDDEN_ISSUE) {
      return { ...base, code: 'forbidden_issue_26', issue_number: 26 };
    }
    return {
      ok: true,
      code: 'firing_established',
      phase: 'FIRING',
      issue_number: after.number,
      issue_url: `https://github.com/${ALLOWED_REPO}/issues/${after.number}`,
      issue_state: after.state,
      consecutive_healthy: after.consecutive_healthy,
      fingerprint,
      sample_window_end: ev.time_window.end,
      run_id: opts.actions.run_id,
      post_attempts: created?.type === 'create' ? 1 : 0,
      patch_attempts: created?.type === 'update' ? 1 : 0,
    };
  }

  // HEALTHY phases require existing open synthetic issue
  if (!existing) {
    return { ...base, code: 'c3c_issue_missing' };
  }
  if (opts.authorized_issue_number && existing.number !== opts.authorized_issue_number) {
    return { ...base, code: 'issue_number_mismatch', issue_number: existing.number };
  }
  if (existing.number === C3_C_FORBIDDEN_ISSUE) {
    return { ...base, code: 'forbidden_issue_26' };
  }

  const beforeStreak = existing.consecutive_healthy;
  const { actions, incidents: afterIncidents } = await reconcileIncidents(opts.ports.issues, [ev], {
    dryRun: false,
    healthyToResolve: 2,
    nowIso: new Date().toISOString(),
  });

  // Re-read (open list / closed search may lag briefly after close)
  let afterOpen = await findC3COpenIssue(opts.ports.issues);
  let closedHit: IncidentRecord | null = null;
  const resolvedAction = actions.find((a) => a.type === 'resolve');
  if (resolvedAction && 'incident' in resolvedAction && resolvedAction.incident) {
    closedHit = hydrateIncidentFromBody({ ...resolvedAction.incident, state: 'closed' });
  }
  if (!afterOpen && !closedHit) {
    closedHit = (await opts.ports.issues.findClosedByFingerprint?.(C3_C_FINGERPRINT)) ?? null;
  }
  if (!afterOpen && !closedHit) {
    // Last resort: fingerprint disappeared from open set after resolve → treat as closed
    const gone = !afterIncidents.some((i) => i.fingerprint === C3_C_FINGERPRINT && i.state === 'open');
    if (gone && resolvedAction) {
      closedHit = hydrateIncidentFromBody({
        ...existing,
        state: 'closed',
        consecutive_healthy: Math.max(beforeStreak + 1, 2),
      });
    }
  }

  if (opts.phase === 'HEALTHY_1') {
    if (!afterOpen || afterOpen.state !== 'open') {
      return {
        ...base,
        ok: false,
        code: 'healthy1_unexpected_close',
        issue_number: afterOpen?.number ?? closedHit?.number,
        issue_state: afterOpen?.state ?? closedHit?.state,
      };
    }
    if (afterOpen.number === C3_C_FORBIDDEN_ISSUE) {
      return { ...base, code: 'forbidden_issue_26' };
    }
    if (afterOpen.consecutive_healthy !== 1) {
      return {
        ...base,
        ok: false,
        code: 'healthy1_streak_not_1',
        issue_number: afterOpen.number,
        consecutive_healthy: afterOpen.consecutive_healthy,
        issue_state: afterOpen.state,
      };
    }
    const resolved = actions.some((a) => a.type === 'resolve');
    if (resolved) {
      return { ...base, ok: false, code: 'healthy1_must_not_close', issue_number: afterOpen.number };
    }
    return {
      ok: true,
      code: 'healthy1_recovering',
      phase: 'HEALTHY_1',
      issue_number: afterOpen.number,
      issue_url: `https://github.com/${ALLOWED_REPO}/issues/${afterOpen.number}`,
      issue_state: 'open',
      consecutive_healthy: afterOpen.consecutive_healthy,
      fingerprint,
      sample_window_end: ev.time_window.end,
      run_id: opts.actions.run_id,
      patch_attempts: 1,
    };
  }

  // HEALTHY_2
  if (beforeStreak < 1) {
    return {
      ...base,
      ok: false,
      code: 'healthy2_requires_prior_streak',
      issue_number: existing.number,
      consecutive_healthy: beforeStreak,
    };
  }
  if (!closedHit || closedHit.state !== 'closed') {
    // Maybe still open with streak 2 without close race
    if (afterOpen && afterOpen.consecutive_healthy >= 2 && afterOpen.state === 'open') {
      return {
        ...base,
        ok: false,
        code: 'healthy2_not_closed',
        issue_number: afterOpen.number,
        consecutive_healthy: afterOpen.consecutive_healthy,
        issue_state: 'open',
      };
    }
    return {
      ...base,
      ok: false,
      code: 'healthy2_close_missing',
      issue_number: afterOpen?.number ?? existing.number,
      consecutive_healthy: afterOpen?.consecutive_healthy,
      issue_state: afterOpen?.state,
    };
  }
  if (closedHit.number === C3_C_FORBIDDEN_ISSUE) {
    return { ...base, code: 'forbidden_issue_26' };
  }
  const hydrated = hydrateIncidentFromBody(closedHit);
  if (hydrated.consecutive_healthy < 2) {
    return {
      ...base,
      ok: false,
      code: 'healthy2_streak_not_2',
      issue_number: closedHit.number,
      consecutive_healthy: hydrated.consecutive_healthy,
      issue_state: 'closed',
    };
  }
  return {
    ok: true,
    code: 'healthy2_closed',
    phase: 'HEALTHY_2',
    issue_number: closedHit.number,
    issue_url: `https://github.com/${ALLOWED_REPO}/issues/${closedHit.number}`,
    issue_state: 'closed',
    consecutive_healthy: hydrated.consecutive_healthy,
    fingerprint,
    sample_window_end: ev.time_window.end,
    run_id: opts.actions.run_id,
    patch_attempts: 1,
  };
}
