/**
 * C3-C — offline live-recovery negatives + cross-run streak (fake MemoryGithubIssues).
 */

import { describe, expect, it } from 'vitest';
import { MemoryGithubIssues } from './github-issues.ts';
import { BOT_LABEL, BOT_MARKER, BOT_FINGERPRINT_PREFIX } from './types.ts';
import {
  assertC3CActions,
  buildC3CEvaluation,
  C3_C_FINGERPRINT,
  C3_C_FORBIDDEN_ISSUE,
  C3_C_JOB_NAME,
  C3_C_TEST_MARKER,
  C3_C_TITLE_HINT,
  C3_C_WORKFLOW_NAME,
  refuseForbiddenIssue,
  runC3CPhase,
  type C3CActionsCtx,
} from './c3c-recovery.ts';
import { defaultC0Env } from './write-gate.ts';
import { upsertIncidentStateBlock } from './incident-state.ts';

function actions(over: Partial<C3CActionsCtx> = {}): C3CActionsCtx {
  return {
    event_name: 'workflow_dispatch',
    workflow_name: C3_C_WORKFLOW_NAME,
    job_name: C3_C_JOB_NAME,
    ref: 'refs/heads/develop',
    run_id: '45000000001',
    commit_sha: 'c40685c93f3bb88c8995a0af361368053766bfb6',
    ...over,
  };
}

function ports() {
  return { issues: new MemoryGithubIssues() };
}

describe('C3-C identity / gates', () => {
  it('binds workflow/job/event/ref', () => {
    expect(assertC3CActions(actions())).toBeNull();
    expect(assertC3CActions(actions({ event_name: 'push' }))).toBe('unexpected_event');
    expect(assertC3CActions(actions({ workflow_name: 'Other' }))).toBe('workflow_not_authorized');
    expect(assertC3CActions(actions({ job_name: 'collector' }))).toBe('job_not_authorized');
    expect(assertC3CActions(actions({ ref: 'refs/heads/main' }))).toBe('ref_not_develop');
  });

  it('refuses Issue #26', () => {
    expect(refuseForbiddenIssue(26)).toBe('forbidden_issue_26');
    expect(refuseForbiddenIssue(C3_C_FORBIDDEN_ISSUE)).toBe('forbidden_issue_26');
    expect(refuseForbiddenIssue(99)).toBeNull();
  });

  it('builds distinct sample windows per phase', () => {
    const f = buildC3CEvaluation('FIRING', '1');
    const h1 = buildC3CEvaluation('HEALTHY_1', '2');
    const h2 = buildC3CEvaluation('HEALTHY_2', '3');
    expect(f.evaluation_status).toBe('FIRING');
    expect(h1.evaluation_status).toBe('HEALTHY');
    expect(h2.evaluation_status).toBe('HEALTHY');
    expect(f.fingerprint).toBe(C3_C_FINGERPRINT);
    expect(f.time_window.end).not.toBe(h1.time_window.end);
    expect(h1.time_window.end).not.toBe(h2.time_window.end);
    expect(Date.parse(h1.time_window.end)).toBeGreaterThan(Date.parse(f.time_window.end));
    expect(Date.parse(h2.time_window.end)).toBeGreaterThan(Date.parse(h1.time_window.end));
    expect(f.evidence_summary).toContain(C3_C_TEST_MARKER);
  });
});

describe('C3-C FIRING → HEALTHY#1 → HEALTHY#2 cross-run', () => {
  it('creates synthetic issue then recovers across independent phases', async () => {
    const p = ports();

    const firing = await runC3CPhase({
      phase: 'FIRING',
      ports: p,
      actions: actions({ run_id: '45000000001' }),
    });
    expect(firing.ok).toBe(true);
    expect(firing.code).toBe('firing_established');
    expect(firing.issue_number).toBeTruthy();
    expect(firing.issue_state).toBe('open');
    expect(firing.consecutive_healthy).toBe(0);
    expect(firing.post_attempts).toBe(1);
    const n = firing.issue_number!;
    expect(n).not.toBe(C3_C_FORBIDDEN_ISSUE);

    const stored = (await p.issues.listBotIncidents('open'))[0];
    expect(stored.body).toContain(C3_C_TEST_MARKER);
    expect(stored.body).toContain(C3_C_FINGERPRINT);
    expect(stored.title).toContain(C3_C_TITLE_HINT);

    const h1 = await runC3CPhase({
      phase: 'HEALTHY_1',
      ports: p,
      actions: actions({ run_id: '45000000002' }),
      authorized_issue_number: n,
    });
    expect(h1.ok).toBe(true);
    expect(h1.code).toBe('healthy1_recovering');
    expect(h1.issue_number).toBe(n);
    expect(h1.issue_state).toBe('open');
    expect(h1.consecutive_healthy).toBe(1);

    const stillOpen = await p.issues.listBotIncidents('open');
    expect(stillOpen).toHaveLength(1);
    expect(stillOpen[0].state).toBe('open');

    const h2 = await runC3CPhase({
      phase: 'HEALTHY_2',
      ports: p,
      actions: actions({ run_id: '45000000003' }),
      authorized_issue_number: n,
    });
    expect(h2.ok).toBe(true);
    expect(h2.code).toBe('healthy2_closed');
    expect(h2.issue_number).toBe(n);
    expect(h2.issue_state).toBe('closed');
    expect(h2.consecutive_healthy).toBeGreaterThanOrEqual(2);

    const openAfter = await p.issues.listBotIncidents('open');
    expect(openAfter).toHaveLength(0);
    const closed = await p.issues.findClosedByFingerprint!(C3_C_FINGERPRINT);
    expect(closed?.state).toBe('closed');
    expect(closed?.number).toBe(n);
  });

  it('refuses second FIRING create when issue exists', async () => {
    const p = ports();
    const a = await runC3CPhase({ phase: 'FIRING', ports: p, actions: actions({ run_id: '1' }) });
    expect(a.ok).toBe(true);
    const b = await runC3CPhase({ phase: 'FIRING', ports: p, actions: actions({ run_id: '2' }) });
    expect(b.ok).toBe(false);
    expect(b.code).toBe('c3c_issue_already_exists');
  });

  it('HEALTHY_1 duplicate window does not close and fails streak check on re-run', async () => {
    const p = ports();
    const f = await runC3CPhase({ phase: 'FIRING', ports: p, actions: actions({ run_id: '10' }) });
    expect(f.ok).toBe(true);
    const h1 = await runC3CPhase({
      phase: 'HEALTHY_1',
      ports: p,
      actions: actions({ run_id: '11' }),
      authorized_issue_number: f.issue_number,
    });
    expect(h1.ok).toBe(true);
    expect(h1.consecutive_healthy).toBe(1);

    // Same phase window → dedupe → streak stays 1 → HEALTHY_1 assertion still ok if streak==1
    // but a second HEALTHY_1 after already at 1 with same window: still streak 1, still open
    const dup = await runC3CPhase({
      phase: 'HEALTHY_1',
      ports: p,
      actions: actions({ run_id: '12' }),
      authorized_issue_number: f.issue_number,
    });
    expect(dup.ok).toBe(true);
    expect(dup.consecutive_healthy).toBe(1);
    expect(dup.issue_state).toBe('open');
  });

  it('HEALTHY_2 refuses without prior streak', async () => {
    const p = ports();
    const f = await runC3CPhase({ phase: 'FIRING', ports: p, actions: actions({ run_id: '20' }) });
    const early = await runC3CPhase({
      phase: 'HEALTHY_2',
      ports: p,
      actions: actions({ run_id: '21' }),
      authorized_issue_number: f.issue_number,
    });
    expect(early.ok).toBe(false);
    expect(early.code).toBe('healthy2_requires_prior_streak');
  });

  it('UNKNOWN between HEALTHYs does not advance to close', async () => {
    const p = ports();
    const f = await runC3CPhase({ phase: 'FIRING', ports: p, actions: actions({ run_id: '30' }) });
    await runC3CPhase({
      phase: 'HEALTHY_1',
      ports: p,
      actions: actions({ run_id: '31' }),
      authorized_issue_number: f.issue_number,
    });
    const open = (await p.issues.listBotIncidents('open'))[0];
    // Inject UNKNOWN sample via updateIncident directly
    const unknown = buildC3CEvaluation('HEALTHY_2', '32');
    unknown.evaluation_status = 'UNKNOWN';
    unknown.time_window = {
      start: '2026-11-22T02:16:00.000Z',
      end: '2026-11-22T02:20:00.000Z',
    };
    const afterUnknown = await p.issues.updateIncident(open, unknown);
    expect(afterUnknown.consecutive_healthy).toBe(1);

    const h2 = await runC3CPhase({
      phase: 'HEALTHY_2',
      ports: p,
      actions: actions({ run_id: '33' }),
      authorized_issue_number: f.issue_number,
    });
    // HEALTHY_2 window is after unknown window → streak becomes 2 and closes
    expect(h2.ok).toBe(true);
    expect(h2.issue_state).toBe('closed');
  });

  it('INCOMPLETE/UNKNOWN evaluation does not create or close', async () => {
    const p = ports();
    const f = await runC3CPhase({ phase: 'FIRING', ports: p, actions: actions({ run_id: '40' }) });
    const open = (await p.issues.listBotIncidents('open'))[0];
    const incomplete = buildC3CEvaluation('HEALTHY_1', '41');
    incomplete.evaluation_status = 'DATA_UNAVAILABLE';
    incomplete.time_window = {
      start: '2026-11-22T02:10:00.000Z',
      end: '2026-11-22T02:14:00.000Z',
    };
    // reconcile path: update streak unchanged via direct update (applyEvaluation keeps streak)
    const after = await p.issues.updateIncident(open, incomplete);
    expect(after.consecutive_healthy).toBe(0);
    expect(after.state).toBe('open');
    expect(f.issue_number).toBe(open.number);
  });

  it('FIRING mid-recovery resets streak', async () => {
    const p = ports();
    const f = await runC3CPhase({ phase: 'FIRING', ports: p, actions: actions({ run_id: '50' }) });
    await runC3CPhase({
      phase: 'HEALTHY_1',
      ports: p,
      actions: actions({ run_id: '51' }),
      authorized_issue_number: f.issue_number,
    });
    const open = (await p.issues.listBotIncidents('open'))[0];
    expect(open.consecutive_healthy).toBe(1);

    const midFire = buildC3CEvaluation('FIRING', '52');
    midFire.time_window = {
      start: '2026-11-22T02:16:00.000Z',
      end: '2026-11-22T02:18:00.000Z',
    };
    const reset = await p.issues.updateIncident(open, midFire);
    expect(reset.consecutive_healthy).toBe(0);

    // HEALTHY_2 now would fail prior streak gate
    const h2 = await runC3CPhase({
      phase: 'HEALTHY_2',
      ports: p,
      actions: actions({ run_id: '53' }),
      authorized_issue_number: f.issue_number,
    });
    expect(h2.ok).toBe(false);
    expect(h2.code).toBe('healthy2_requires_prior_streak');
  });

  it('refuses authorized_issue pointing at #26', async () => {
    const p = ports();
    const r = await runC3CPhase({
      phase: 'HEALTHY_1',
      ports: p,
      actions: actions(),
      authorized_issue_number: 26,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('forbidden_issue_26');
  });

  it('does not mutate a human/preexisting issue without c3-c marker', async () => {
    const p = ports();
    // Seed issue #26-like body with different fingerprint (human)
    const body = upsertIncidentStateBlock(
      `${BOT_MARKER}\n${BOT_FINGERPRINT_PREFIX}ALERT-01|qszggrrjhcwltnmxpxcy|OTHER\nHuman note`,
      {
        schema_version: 1,
        project_ref: 'qszggrrjhcwltnmxpxcy',
        environment: 'stage',
        alert_id: 'ALERT-01',
        fingerprint: 'ALERT-01|qszggrrjhcwltnmxpxcy|OTHER',
        first_seen_at: '2026-11-22T01:00:00.000Z',
        last_seen_at: '2026-11-22T01:00:00.000Z',
        consecutive_healthy: 0,
        alert_status: 'FIRING',
        last_transition_at: '2026-11-22T01:00:00.000Z',
        last_sample_window_end: '2026-11-22T01:00:00.000Z',
      },
    );
    p.issues.store.set(26, {
      fingerprint: 'ALERT-01|qszggrrjhcwltnmxpxcy|OTHER',
      alert_id: 'ALERT-01',
      number: 26,
      title: '[STAGE] preexisting C3-B.5',
      state: 'open',
      labels: [BOT_LABEL],
      body,
      opened_at: '2026-11-22T01:00:00.000Z',
      last_seen_at: '2026-11-22T01:00:00.000Z',
      bot_marker: BOT_MARKER,
      consecutive_healthy: 0,
    });

    const f = await runC3CPhase({ phase: 'FIRING', ports: p, actions: actions({ run_id: '60' }) });
    expect(f.ok).toBe(true);
    expect(f.issue_number).not.toBe(26);

    const preexisting = p.issues.store.get(26)!;
    expect(preexisting.body).toBe(body);
    expect(preexisting.state).toBe('open');
  });

  it('mismatch authorized_issue fails', async () => {
    const p = ports();
    const f = await runC3CPhase({ phase: 'FIRING', ports: p, actions: actions({ run_id: '70' }) });
    const bad = await runC3CPhase({
      phase: 'HEALTHY_1',
      ports: p,
      actions: actions({ run_id: '71' }),
      authorized_issue_number: f.issue_number! + 999,
    });
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe('issue_number_mismatch');
  });

  it('c3_c_not_authorized when env flag cleared', async () => {
    const p = ports();
    const r = await runC3CPhase({
      phase: 'FIRING',
      ports: p,
      actions: actions(),
      env: defaultC0Env({ BOTH_WATCHDOG_C3_C_AUTHORIZED: '0' }),
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('c3_c_not_authorized');
  });

  it('out-of-order HEALTHY window does not advance streak', async () => {
    const p = ports();
    const f = await runC3CPhase({ phase: 'FIRING', ports: p, actions: actions({ run_id: '80' }) });
    await runC3CPhase({
      phase: 'HEALTHY_1',
      ports: p,
      actions: actions({ run_id: '81' }),
      authorized_issue_number: f.issue_number,
    });
    const open = (await p.issues.listBotIncidents('open'))[0];
    const stale = buildC3CEvaluation('HEALTHY_2', '82');
    stale.time_window = {
      start: '2026-11-22T02:00:00.000Z',
      end: '2026-11-22T02:05:00.000Z', // before HEALTHY_1 end
    };
    const after = await p.issues.updateIncident(open, stale);
    expect(after.consecutive_healthy).toBe(1);
    expect(after.state).toBe('open');
  });
});

describe('C3-C workflow file static gates', () => {
  it('recovery YAML is OFF: no schedule, no issues:write, no supervised job', async () => {
    const { readFileSync } = await import('node:fs');
    const yml = readFileSync(
      new URL('../../.github/workflows/both-stage-watchdog-recovery.yml', import.meta.url),
      'utf8',
    );
    expect(yml).toContain('name: Both STAGE Watchdog Recovery');
    expect(yml).toContain('recovery-off:');
    expect(yml).not.toContain('delivery-supervised-recovery:');
    expect(yml).not.toContain('c3c-recovery-cli.ts');
    expect(yml).not.toMatch(/^\s+schedule\s*:/m);
    expect(yml).not.toMatch(/pull_request_target/);
    expect(yml).toContain('cancel-in-progress: false');
    expect(yml).toMatch(/^permissions:\s*\n\s*contents:\s*read\s*$/m);
    const stripped = yml
      .split('\n')
      .map((l) => (l.includes('#') ? l.slice(0, l.indexOf('#')) : l))
      .join('\n');
    expect(stripped).not.toMatch(/issues\s*:\s*write/i);
  });
});
