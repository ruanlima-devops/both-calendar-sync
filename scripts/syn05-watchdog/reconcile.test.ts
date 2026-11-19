import { describe, expect, it } from 'vitest';
import { DryRunGithubIssues, MemoryGithubIssues, isBotOwned } from './github-issues.ts';
import { reconcileIncidents } from './reconcile.ts';
import { evaluateAll } from './evaluation.ts';
import type { AlertEvaluation, NormalizedSignal } from './types.ts';
import { STAGE_PROJECT_REF } from './types.ts';

const NOW = Date.parse('2026-11-18T18:00:00.000Z');

function firingEval(overrides: Partial<AlertEvaluation> = {}): AlertEvaluation {
  return {
    alert_id: 'ALERT-01',
    severity: 'P1',
    environment: 'stage',
    project_ref: STAGE_PROJECT_REF,
    evaluation_status: 'FIRING',
    observed_count: 3,
    time_window: { start: 't0', end: 't1' },
    fingerprint: 'ALERT-01|stage|fp1',
    evidence_summary: '5xx',
    function_or_service: 'billing-webhook',
    ...overrides,
  };
}

describe('issue reconciliation', () => {
  it('creates then dedupes fingerprint updates', async () => {
    const mem = new MemoryGithubIssues();
    const issues = new DryRunGithubIssues(mem);
    const ev = firingEval();
    const r1 = await reconcileIncidents(issues, [ev], { dryRun: true });
    expect(r1.actions.some((a) => a.type === 'create')).toBe(true);
    const r2 = await reconcileIncidents(issues, [ev], { dryRun: true });
    expect(r2.actions.some((a) => a.type === 'update')).toBe(true);
    expect(r2.actions.some((a) => a.type === 'create')).toBe(false);
    expect(issues.planned.filter((p) => p.op === 'create')).toHaveLength(1);
  });

  it('does not close on DATA_UNAVAILABLE / UNKNOWN', async () => {
    const mem = new MemoryGithubIssues();
    const issues = new DryRunGithubIssues(mem);
    const ev = firingEval();
    await reconcileIncidents(issues, [ev], { dryRun: true });
    const unavailable = firingEval({ evaluation_status: 'DATA_UNAVAILABLE', evidence_summary: 'api' });
    const r = await reconcileIncidents(issues, [unavailable], { dryRun: true });
    expect(r.actions[0]?.type).toBe('noop');
    const open = await issues.listBotIncidents('open');
    expect(open).toHaveLength(1);
  });

  it('requires two healthy evaluations to resolve', async () => {
    const mem = new MemoryGithubIssues();
    const issues = new DryRunGithubIssues(mem);
    const fire = firingEval();
    await reconcileIncidents(issues, [fire], { dryRun: true });
    const healthy = firingEval({ evaluation_status: 'HEALTHY', evidence_summary: 'ok', observed_count: 0 });
    const r1 = await reconcileIncidents(issues, [healthy], { dryRun: true, healthyToResolve: 2 });
    expect(r1.actions.some((a) => a.type === 'resolve')).toBe(false);
    const r2 = await reconcileIncidents(issues, [healthy], { dryRun: true, healthyToResolve: 2 });
    expect(r2.actions.some((a) => a.type === 'resolve')).toBe(true);
  });

  it('never mutates human issues', async () => {
    const mem = new MemoryGithubIssues();
    const human = mem.seedHumanIssue();
    expect(isBotOwned(human)).toBe(false);
    const issues = new DryRunGithubIssues(mem);
    await reconcileIncidents(issues, [firingEval()], { dryRun: true });
    const still = mem.store.get(human.number)!;
    expect(still.title).toBe('Human triage note');
    expect(still.labels).toEqual(['human']);
  });

  it('sanitizes titles and does not embed bearer tokens', async () => {
    const mem = new MemoryGithubIssues();
    const issues = new DryRunGithubIssues(mem);
    await reconcileIncidents(
      issues,
      [
        firingEval({
          evidence_summary: 'Authorization Bearer eyJabc.def.ghi leaked',
        }),
      ],
      { dryRun: true },
    );
    const open = await issues.listBotIncidents('open');
    expect(open[0]!.body).toContain('[redacted]');
    expect(open[0]!.body).not.toMatch(/eyJabc/);
  });
});

describe('evaluateAll integration', () => {
  it('fires ALERT-01 for 5xx and ignores 410', () => {
    const signals: NormalizedSignal[] = [
      {
        kind: 'edge_http',
        timestamp: new Date(NOW - 60_000).toISOString(),
        status: 410,
        functionName: 'sync-calendar',
        method: 'POST',
      },
      ...[1, 2, 3].map((i) => ({
        kind: 'edge_http' as const,
        timestamp: new Date(NOW - i * 30_000).toISOString(),
        status: 500,
        functionName: 'billing-webhook',
        method: 'POST',
      })),
    ];
    const ev = evaluateAll({ signals, dataAvailable: true, nowMs: NOW });
    const a01 = ev.find((e) => e.alert_id === 'ALERT-01')!;
    expect(a01.evaluation_status).toBe('FIRING');
  });

  it('marks DATA_UNAVAILABLE when logs API fails — not HEALTHY', () => {
    const ev = evaluateAll({
      signals: [],
      dataAvailable: false,
      apiError: 'rate_limited',
      nowMs: NOW,
    });
    expect(ev.every((e) => e.evaluation_status === 'DATA_UNAVAILABLE')).toBe(true);
  });

  it('detects cron miss and billing apply_failed', () => {
    const signals: NormalizedSignal[] = [
      {
        kind: 'edge_http',
        timestamp: new Date(NOW - 40 * 60_000).toISOString(),
        status: 200,
        functionName: 'reconcile-sync',
        method: 'POST',
      },
      ...[1, 2, 3].map((i) => ({
        kind: 'console_event' as const,
        timestamp: new Date(NOW - i * 60_000).toISOString(),
        event_name: 'billing-webhook_apply_failed',
        message: '[billing-webhook] apply_failed',
        raw_keys: ['event_name'],
      })),
      {
        kind: 'console_event',
        timestamp: new Date(NOW - 30_000).toISOString(),
        event_name: 'billing-webhook_invalid_signature',
        message: '[billing-webhook] invalid_signature',
        raw_keys: [],
      },
    ];
    const ev = evaluateAll({ signals, dataAvailable: true, nowMs: NOW });
    expect(ev.find((e) => e.alert_id === 'ALERT-02')!.evaluation_status).toBe('FIRING');
    expect(ev.find((e) => e.alert_id === 'ALERT-03')!.evaluation_status).toBe('FIRING');
  });

  it('keeps cron healthy when reconcile-sync 200 is fresh', () => {
    const signals: NormalizedSignal[] = [
      {
        kind: 'edge_http',
        timestamp: new Date(NOW - 5 * 60_000).toISOString(),
        status: 200,
        functionName: 'reconcile-sync',
        method: 'POST',
      },
    ];
    const ev = evaluateAll({ signals, dataAvailable: true, nowMs: NOW });
    expect(ev.find((e) => e.alert_id === 'ALERT-02')!.evaluation_status).toBe('HEALTHY');
  });

  it('does not fire ALERT-03 on invalid_signature alone or skipped_deleted_account', () => {
    const signals: NormalizedSignal[] = [
      {
        kind: 'edge_http',
        timestamp: new Date(NOW - 60_000).toISOString(),
        status: 200,
        functionName: 'reconcile-sync',
        method: 'POST',
      },
      ...[1, 2, 3].map((i) => ({
        kind: 'console_event' as const,
        timestamp: new Date(NOW - i * 60_000).toISOString(),
        event_name: 'billing-webhook_invalid_signature',
        message: '[billing-webhook] invalid_signature',
        raw_keys: [],
      })),
      {
        kind: 'console_event',
        timestamp: new Date(NOW - 20_000).toISOString(),
        event_name: 'billing-webhook_skipped_deleted_account',
        message: '[billing-webhook] skipped_deleted_account',
        outcome: 'skipped',
        raw_keys: [],
      },
    ];
    const ev = evaluateAll({ signals, dataAvailable: true, nowMs: NOW });
    expect(ev.find((e) => e.alert_id === 'ALERT-03')!.evaluation_status).toBe('HEALTHY');
  });
});
