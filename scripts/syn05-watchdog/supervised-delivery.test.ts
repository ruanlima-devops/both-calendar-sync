/**
 * C3-B.5 — offline supervised oneshot tests (fake transport; no network).
 */

import { describe, expect, it } from 'vitest';
import { C3_B5_FINGERPRINT_PREFIX, C3_B5_TEST_TITLE, evaluateQuota } from './supervised-quota.ts';
import {
  assertActionsBinding,
  buildSyntheticFingerprint,
  buildTestIssueBody,
  runSupervisedOneshot,
  type SupervisedCreatePort,
  type SupervisedSearchPort,
} from './supervised-delivery.ts';
import { evaluateWriteGate, defaultC0Env } from './write-gate.ts';
import { validateDeliveryArtifact } from './delivery-artifact.ts';
import { COLLECTOR_FORBIDS_GITHUB_ISSUES } from './collector.ts';
import { EVALUATOR_FORBIDS_GITHUB_ISSUES, EVALUATOR_FORBIDS_REMOTE_HTTP } from './evaluator.ts';
import { STAGE_PROJECT_REF } from './types.ts';

const COMMIT = '52aae4e633c69b43c8b3f184d98d9e110f83720d';
const RUN = '44999999999';

function actions(over: Partial<{ event_name: string; workflow_name: string; job_name: string; ref: string }> = {}) {
  return {
    event_name: 'workflow_dispatch',
    workflow_name: 'Both STAGE Watchdog Delivery',
    job_name: 'delivery-supervised',
    ref: 'refs/heads/develop',
    run_id: RUN,
    commit_sha: COMMIT,
    ...over,
  };
}

function supervisedEnv() {
  return {
    BOTH_WATCHDOG_DRY_RUN: '0',
    BOTH_WATCHDOG_GITHUB_WRITE: '1',
    BOTH_WATCHDOG_ENABLE_NETWORK: '1',
    BOTH_WATCHDOG_DELIVERY_MODE: 'supervised-write',
    BOTH_WATCHDOG_C3_B5_AUTHORIZED: '1',
    BOTH_WATCHDOG_C3_B41_FORCE_BLOCK: '0',
    GITHUB_REPOSITORY: 'ruanlima-devops/both-calendar-sync',
  };
}

function fakePorts(opts?: {
  existing?: Array<{ number: number; title: string; body?: string; state: string }>;
  createImpl?: SupervisedCreatePort['createTestIssue'];
}): { search: SupervisedSearchPort; create: SupervisedCreatePort } {
  return {
    search: {
      async searchTestIssues() {
        return opts?.existing ?? [];
      },
    },
    create: {
      createTestIssue: async (body) => {
        if (opts?.createImpl) return opts.createImpl(body);
        return {
          number: 4242,
          html_url: 'https://github.com/ruanlima-devops/both-calendar-sync/issues/4242',
          status: 201,
        };
      },
    },
  };
}

describe('C3-B.5 identity isolation', () => {
  it('collector/evaluator forbid issues write surfaces', () => {
    expect(COLLECTOR_FORBIDS_GITHUB_ISSUES).toBe(true);
    expect(EVALUATOR_FORBIDS_GITHUB_ISSUES).toBe(true);
    expect(EVALUATOR_FORBIDS_REMOTE_HTTP).toBe(true);
  });
});

describe('C3-B.5 write gate supervised', () => {
  it('defaults still deny', () => {
    const fp = buildSyntheticFingerprint(RUN);
    const built = validateDeliveryArtifact({
      schema_version: 'both-syn05-delivery-artifact:v1',
      project_ref: STAGE_PROJECT_REF,
      environment: 'stage',
      alert_id: 'ALERT-01',
      fingerprint: fp,
      evaluation_status: 'FIRING',
      sample_window_start: '2026-11-22T00:00:00.000Z',
      sample_window_end: '2026-11-22T00:10:00.000Z',
      event_count: 0,
      completeness: 'complete',
      evaluation_run_id: RUN,
      source_commit_sha: COMMIT,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const g = evaluateWriteGate({
      env: defaultC0Env(),
      artifact: built.artifact,
      validated: built,
      permission_issues_write_available: true,
      adapter_enabled: true,
      token_present: true,
      trusted_provenance: true,
      synthetic_fixture: true,
    });
    expect(g.authorized).toBe(false);
  });

  it('authorizes only with full C3-B.5 bag + synthetic fp', async () => {
    const ports = fakePorts();
    const r = await runSupervisedOneshot({
      search: ports.search,
      create: ports.create,
      env: supervisedEnv(),
      provenance: { expected_run_id: RUN, expected_commit_sha: COMMIT },
      actions: actions(),
      permission_issues_write_available: true,
      token_present: true,
      now_iso: '2026-11-22T00:10:00.000Z',
    });
    expect(r.ok).toBe(true);
    expect(r.issue_number).toBe(4242);
    expect(r.post_attempts).toBe(1);
    expect(r.fingerprint?.startsWith(C3_B5_FINGERPRINT_PREFIX)).toBe(true);
  });

  it('denies wrong repo/workflow/job/event/ref', async () => {
    for (const over of [
      { event_name: 'push' },
      { workflow_name: 'CI' },
      { job_name: 'delivery-off' },
      { ref: 'refs/heads/main' },
    ] as const) {
      const ports = fakePorts();
      const r = await runSupervisedOneshot({
        search: ports.search,
        create: ports.create,
        env: supervisedEnv(),
        provenance: { expected_run_id: RUN, expected_commit_sha: COMMIT },
        actions: actions(over),
        permission_issues_write_available: true,
        token_present: true,
        now_iso: '2026-11-22T00:10:00.000Z',
      });
      expect(r.ok).toBe(false);
      expect(r.post_attempts).toBe(0);
    }
  });

  it('denies token/permission absent', async () => {
    const ports = fakePorts();
    const r = await runSupervisedOneshot({
      search: ports.search,
      create: ports.create,
      env: supervisedEnv(),
      provenance: { expected_run_id: RUN, expected_commit_sha: COMMIT },
      actions: actions(),
      permission_issues_write_available: false,
      token_present: false,
      now_iso: '2026-11-22T00:10:00.000Z',
    });
    expect(r.ok).toBe(false);
    expect(r.post_attempts).toBe(0);
  });

  it('denies non-synthetic fingerprint path via write gate', () => {
    const built = validateDeliveryArtifact({
      schema_version: 'both-syn05-delivery-artifact:v1',
      project_ref: STAGE_PROJECT_REF,
      environment: 'stage',
      alert_id: 'ALERT-01',
      fingerprint: `ALERT-01|${STAGE_PROJECT_REF}|edge`,
      evaluation_status: 'FIRING',
      sample_window_start: '2026-11-22T00:00:00.000Z',
      sample_window_end: '2026-11-22T00:10:00.000Z',
      event_count: 0,
      completeness: 'complete',
      evaluation_run_id: RUN,
      source_commit_sha: COMMIT,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const g = evaluateWriteGate({
      env: supervisedEnv(),
      artifact: built.artifact,
      validated: built,
      permission_issues_write_available: true,
      adapter_enabled: true,
      token_present: true,
      trusted_provenance: true,
      synthetic_fixture: true,
      operations_remaining: 1,
      actions_event_name: 'workflow_dispatch',
      actions_workflow_name: 'Both STAGE Watchdog Delivery',
      actions_job_name: 'delivery-supervised',
      actions_ref: 'refs/heads/develop',
      expected_commit_sha: COMMIT,
    });
    expect(g.authorized).toBe(false);
    if (!g.authorized) expect(g.code).toBe('fingerprint_not_c3_b5_test');
  });
});

describe('C3-B.5 quota oneshot', () => {
  it('blocks when test issue already exists', async () => {
    const ports = fakePorts({
      existing: [{ number: 7, title: C3_B5_TEST_TITLE, body: 'both-syn05-c3-b5-supervised-test:v1', state: 'open' }],
    });
    const r = await runSupervisedOneshot({
      search: ports.search,
      create: ports.create,
      env: supervisedEnv(),
      provenance: { expected_run_id: RUN, expected_commit_sha: COMMIT },
      actions: actions(),
      permission_issues_write_available: true,
      token_present: true,
      now_iso: '2026-11-22T00:10:00.000Z',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('quota_issue_already_exists');
    expect(r.post_attempts).toBe(0);
  });

  it('second create blocked after first success (ledger)', async () => {
    let existing: Array<{ number: number; title: string; body?: string; state: string }> = [];
    const search: SupervisedSearchPort = {
      async searchTestIssues() {
        return existing;
      },
    };
    const create: SupervisedCreatePort = {
      async createTestIssue({ title, body }) {
        existing = [{ number: 99, title, body, state: 'open' }];
        return { number: 99, html_url: 'https://github.com/ruanlima-devops/both-calendar-sync/issues/99', status: 201 };
      },
    };
    const deps = {
      search,
      create,
      env: supervisedEnv(),
      provenance: { expected_run_id: RUN, expected_commit_sha: COMMIT },
      actions: actions(),
      permission_issues_write_available: true,
      token_present: true,
      now_iso: '2026-11-22T00:10:00.000Z',
    };
    const r1 = await runSupervisedOneshot(deps, { create_posts_attempted: 0 });
    expect(r1.ok).toBe(true);
    const r2 = await runSupervisedOneshot(deps, { create_posts_attempted: r1.post_attempts });
    expect(r2.ok).toBe(false);
    expect(r2.code).toMatch(/quota/);
  });

  it('does not retry POST after ambiguous failure', async () => {
    let posts = 0;
    const ports = fakePorts({
      createImpl: async () => {
        posts += 1;
        throw new Error('timeout');
      },
    });
    const r = await runSupervisedOneshot({
      search: ports.search,
      create: ports.create,
      env: supervisedEnv(),
      provenance: { expected_run_id: RUN, expected_commit_sha: COMMIT },
      actions: actions(),
      permission_issues_write_available: true,
      token_present: true,
      now_iso: '2026-11-22T00:10:00.000Z',
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('create_ambiguous');
    expect(r.post_attempts).toBe(1);
    expect(posts).toBe(1);
    const q = evaluateQuota([], { create_posts_attempted: 1 });
    expect(q.blocked).toBe(true);
  });

  it('issue body has no PII markers', () => {
    const body = buildTestIssueBody({
      fingerprint: buildSyntheticFingerprint(RUN),
      run_id: RUN,
      commit_sha: COMMIT,
      artifact_sha256: 'a'.repeat(64),
      utc: '2026-11-22T00:10:00.000Z',
    });
    expect(body).toContain('both-syn05-c3-b5-supervised-test:v1');
    expect(body).toMatch(/SUPERVISED_TEST/);
    expect(body).not.toMatch(/eyJ[a-zA-Z0-9_-]+\.|Bearer [A-Za-z0-9]|service_role|@gmail\.com/);
  });
});

describe('C3-B.5 actions binding', () => {
  it('assertActionsBinding', () => {
    expect(assertActionsBinding(actions())).toBeNull();
    expect(assertActionsBinding(actions({ event_name: 'schedule' }))).toBe('unexpected_event');
  });
});
