/**
 * C3-B.5 — Supervised oneshot delivery of a synthetic test Issue.
 * Real HTTP only when explicitly wired by CLI under Actions oneshot job.
 * Create-once; never update/close/reopen; never retry POST after ambiguity.
 */

import {
  buildDeliveryArtifact,
  verifyArtifactProvenance,
  type DeliveryArtifactV1,
  type ProvenanceContext,
} from './delivery-artifact.ts';
import {
  createPinnedGithubTransport,
  type GithubHttpTransport,
} from './github-http.ts';
import { STAGE_ENVIRONMENT, STAGE_PROJECT_REF } from './types.ts';
import {
  C3_B5_FINGERPRINT_PREFIX,
  C3_B5_TEST_MARKER,
  C3_B5_TEST_TITLE,
  consumePostAttempt,
  evaluateQuota,
  isC3B5TestIssue,
  type QuotaIssueProbe,
  type QuotaLedger,
  type QuotaSnapshot,
} from './supervised-quota.ts';
import {
  ALLOWED_REPO,
  C3_B5_JOB_NAME,
  C3_B5_WORKFLOW_NAME,
  evaluateWriteGate,
  type WriteGateEnv,
} from './write-gate.ts';

export type SupervisedSearchPort = {
  searchTestIssues(): Promise<QuotaIssueProbe[]>;
};

export type SupervisedCreatePort = {
  createTestIssue(body: {
    title: string;
    body: string;
    labels?: string[];
  }): Promise<{ number: number; html_url: string; status: number }>;
};

export type SupervisedDeliveryDeps = {
  search: SupervisedSearchPort;
  create: SupervisedCreatePort;
  env: WriteGateEnv;
  provenance: ProvenanceContext;
  actions: {
    event_name: string;
    workflow_name: string;
    job_name: string;
    ref: string;
    run_id: string;
    commit_sha: string;
  };
  permission_issues_write_available: boolean;
  token_present: boolean;
  now_iso?: string;
  fingerprint_suffix?: string;
};

export type SupervisedDeliveryResult = {
  ok: boolean;
  code: string;
  http_status?: number;
  issue_number?: number;
  issue_url?: string;
  post_attempts: number;
  quota: QuotaSnapshot;
  artifact?: DeliveryArtifactV1;
  artifact_sha256?: string;
  fingerprint?: string;
};

export function buildSyntheticFingerprint(suffix: string): string {
  const clean = suffix.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80);
  return `${C3_B5_FINGERPRINT_PREFIX}${STAGE_PROJECT_REF}|${clean || 'oneshot'}`;
}

function toIsoZ(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

export function buildSyntheticArtifact(opts: {
  run_id: string;
  commit_sha: string;
  fingerprint: string;
  window_end?: string;
}): ReturnType<typeof buildDeliveryArtifact> {
  const endDate = opts.window_end ? new Date(opts.window_end) : new Date();
  const end = toIsoZ(endDate);
  const start = toIsoZ(new Date(Date.parse(end) - 10 * 60 * 1000));
  return buildDeliveryArtifact({
    alert_id: 'ALERT-01',
    fingerprint: opts.fingerprint,
    evaluation_status: 'FIRING',
    sample_window_start: start,
    sample_window_end: end,
    event_count: 0,
    completeness: 'complete',
    evaluation_run_id: opts.run_id,
    source_commit_sha: opts.commit_sha,
  });
}

export function buildTestIssueBody(meta: {
  fingerprint: string;
  run_id: string;
  commit_sha: string;
  artifact_sha256: string;
  utc: string;
}): string {
  return [
    C3_B5_TEST_MARKER,
    '',
    'Teste controlado do watchdog Both. Não representa incidente operacional. Não modificar ou encerrar automaticamente.',
    '',
    `environment: ${STAGE_ENVIRONMENT}`,
    `project_ref: ${STAGE_PROJECT_REF}`,
    'alert_id: ALERT-01 (synthetic)',
    `fingerprint: ${meta.fingerprint}`,
    `run_id: ${meta.run_id}`,
    `commit_sha: ${meta.commit_sha}`,
    `artifact_sha256: ${meta.artifact_sha256}`,
    `utc: ${meta.utc}`,
    'status: SUPERVISED_TEST',
    'authorization: C3-B.5',
    '',
    'Automated synthetic test marker only. No user data. No logs. No secrets.',
  ].join('\n');
}

/**
 * Execute supervised oneshot. At most one POST create.
 * On ambiguous create: do not retry; reconcile by read-only search only.
 */
export async function runSupervisedOneshot(
  deps: SupervisedDeliveryDeps,
  ledger: QuotaLedger = { create_posts_attempted: 0 },
): Promise<SupervisedDeliveryResult> {
  const utc = deps.now_iso ?? new Date().toISOString();
  const fp = buildSyntheticFingerprint(deps.fingerprint_suffix ?? deps.actions.run_id);

  const existing = await deps.search.searchTestIssues();
  let quota = evaluateQuota(existing, ledger);
  if (quota.blocked) {
    return { ok: false, code: quota.code, post_attempts: ledger.create_posts_attempted, quota };
  }

  const built = buildSyntheticArtifact({
    run_id: deps.actions.run_id,
    commit_sha: deps.actions.commit_sha,
    fingerprint: fp,
    window_end: utc,
  });
  if (!built.ok) {
    return {
      ok: false,
      code: built.code,
      post_attempts: ledger.create_posts_attempted,
      quota,
    };
  }

  const proven = verifyArtifactProvenance(built, deps.provenance);
  if (!proven.ok) {
    return {
      ok: false,
      code: proven.code,
      post_attempts: ledger.create_posts_attempted,
      quota,
      artifact: built.artifact,
      artifact_sha256: built.sha256,
      fingerprint: fp,
    };
  }

  const gate = evaluateWriteGate({
    env: deps.env,
    artifact: proven.artifact,
    validated: proven,
    permission_issues_write_available: deps.permission_issues_write_available,
    adapter_enabled: true,
    token_present: deps.token_present,
    trusted_provenance: true,
    concurrency_ok: true,
    within_authorized_window: true,
    operations_remaining: quota.remaining_creates,
    repo_full_name: ALLOWED_REPO,
    synthetic_fixture: true,
    actions_event_name: deps.actions.event_name,
    actions_workflow_name: deps.actions.workflow_name,
    actions_job_name: deps.actions.job_name,
    actions_ref: deps.actions.ref,
    expected_commit_sha: deps.actions.commit_sha,
  });

  if (!gate.authorized) {
    return {
      ok: false,
      code: gate.code,
      post_attempts: ledger.create_posts_attempted,
      quota,
      artifact: proven.artifact,
      artifact_sha256: proven.sha256,
      fingerprint: fp,
    };
  }

  const nextLedger = consumePostAttempt(ledger);
  quota = evaluateQuota(existing, nextLedger);

  const body = buildTestIssueBody({
    fingerprint: fp,
    run_id: deps.actions.run_id,
    commit_sha: deps.actions.commit_sha,
    artifact_sha256: proven.sha256,
    utc,
  });

  try {
    const created = await deps.create.createTestIssue({
      title: C3_B5_TEST_TITLE,
      body,
      labels: ['both-syn05-test'],
    });
    if (created.status >= 200 && created.status < 300 && created.number > 0) {
      const after = evaluateQuota(
        [...existing, { number: created.number, title: C3_B5_TEST_TITLE, body, state: 'open' }],
        nextLedger,
      );
      return {
        ok: true,
        code: 'created',
        http_status: created.status,
        issue_number: created.number,
        issue_url: created.html_url,
        post_attempts: nextLedger.create_posts_attempted,
        quota: after,
        artifact: proven.artifact,
        artifact_sha256: proven.sha256,
        fingerprint: fp,
      };
    }
    return {
      ok: false,
      code: 'create_unexpected_status',
      http_status: created.status,
      post_attempts: nextLedger.create_posts_attempted,
      quota,
      artifact: proven.artifact,
      artifact_sha256: proven.sha256,
      fingerprint: fp,
    };
  } catch {
    let reconciled: QuotaIssueProbe[] = existing;
    try {
      reconciled = await deps.search.searchTestIssues();
    } catch {
      /* keep */
    }
    const after = evaluateQuota(reconciled, nextLedger);
    if (after.existing_test_issues.length === 1) {
      const hit = after.existing_test_issues[0];
      return {
        ok: true,
        code: 'created_reconciled_after_ambiguity',
        issue_number: hit.number,
        post_attempts: nextLedger.create_posts_attempted,
        quota: after,
        artifact: proven.artifact,
        artifact_sha256: proven.sha256,
        fingerprint: fp,
      };
    }
    return {
      ok: false,
      code: after.existing_test_issues.length > 1 ? 'ambiguous_multiple_issues' : 'create_ambiguous',
      post_attempts: nextLedger.create_posts_attempted,
      quota: after,
      artifact: proven.artifact,
      artifact_sha256: proven.sha256,
      fingerprint: fp,
    };
  }
}

/** Live GitHub search/create using pinned transport + job GITHUB_TOKEN (never logged). */
export function createLiveSupervisedPorts(token: string): {
  search: SupervisedSearchPort;
  create: SupervisedCreatePort;
  transport: GithubHttpTransport;
} {
  if (!token || token.length < 8) {
    throw new Error('github_token_missing');
  }
  const pinned = createPinnedGithubTransport({});
  const transport: GithubHttpTransport = async (req) =>
    pinned({
      ...req,
      headers: {
        ...(req.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });

  return {
    transport,
    search: {
      async searchTestIssues() {
        const res = await transport({
          method: 'GET',
          path: `/repos/ruanlima-devops/both-calendar-sync/issues?state=all&per_page=100`,
        });
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`github_search_status_${res.status}`);
        }
        const parsed = JSON.parse(res.body) as Array<{
          number: number;
          title: string;
          body?: string | null;
          state: string;
          pull_request?: unknown;
        }>;
        return parsed
          .filter((i) => !i.pull_request)
          .map((i) => ({
            number: i.number,
            title: i.title,
            body: i.body ?? '',
            state: i.state,
          }))
          .filter(isC3B5TestIssue);
      },
    },
    create: {
      async createTestIssue({ title, body, labels }) {
        const res = await transport({
          method: 'POST',
          path: `/repos/ruanlima-devops/both-calendar-sync/issues`,
          body: JSON.stringify({ title, body, labels: labels ?? ['both-syn05-test'] }),
        });
        let json: { number?: number; html_url?: string } = {};
        try {
          json = JSON.parse(res.body) as { number?: number; html_url?: string };
        } catch {
          json = {};
        }
        if (res.status === 201 && json.number) {
          return {
            number: json.number,
            html_url: json.html_url ?? `https://github.com/${ALLOWED_REPO}/issues/${json.number}`,
            status: res.status,
          };
        }
        throw new Error(`github_create_status_${res.status}`);
      },
    },
  };
}

export function assertActionsBinding(actions: SupervisedDeliveryDeps['actions']): string | null {
  if (actions.event_name !== 'workflow_dispatch') return 'unexpected_event';
  if (actions.workflow_name !== C3_B5_WORKFLOW_NAME) return 'workflow_not_authorized';
  if (actions.job_name !== C3_B5_JOB_NAME) return 'job_not_authorized';
  if (actions.ref !== 'refs/heads/develop') return 'ref_not_develop';
  return null;
}
