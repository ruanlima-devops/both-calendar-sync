import { describe, expect, it } from 'vitest';
import { FakeGithubIssuesTransport } from './github-http.ts';
import { HttpGithubIssues, isRealGithubIssuesEnabled } from './http-github-issues.ts';
import { MemoryGithubIssues, DryRunGithubIssues, isGithubWriteEnabled } from './github-issues.ts';
import { parseIncidentState } from './incident-state.ts';
import { reconcileIncidents } from './reconcile.ts';
import { STAGE_PROJECT_REF, type AlertEvaluation } from './types.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NOW = '2026-11-19T10:00:00.000Z';

function firing(partial: Partial<AlertEvaluation> = {}): AlertEvaluation {
  return {
    alert_id: 'ALERT-01',
    severity: 'P1',
    environment: 'stage',
    project_ref: STAGE_PROJECT_REF,
    evaluation_status: 'FIRING',
    observed_count: 3,
    time_window: { start: '2026-11-19T09:00:00.000Z', end: '2026-11-19T09:10:00.000Z' },
    fingerprint: 'ALERT-01|qszggrrjhcwltnmxpxcy|fp-http',
    evidence_summary: '5xx',
    function_or_service: 'billing-webhook',
    ...partial,
  };
}

function healthy(end: string): AlertEvaluation {
  return firing({
    evaluation_status: 'HEALTHY',
    observed_count: 0,
    evidence_summary: 'ok',
    time_window: { start: 's', end },
  });
}

function makeHttp(fake: FakeGithubIssuesTransport) {
  return new HttpGithubIssues({
    owner: 'ruanlima-devops',
    repo: 'both-calendar-sync',
    token: 'test-token-xxxxxxxx',
    transport: fake.transport,
    sleep: async () => {},
  });
}

describe('HttpGithubIssues offline', () => {
  it('search-before-create dedupes fingerprint', async () => {
    const fake = new FakeGithubIssuesTransport();
    const issues = makeHttp(fake);
    const a = await issues.createIncident(firing());
    const b = await issues.createIncident(firing({ time_window: { start: 's', end: '2026-11-19T09:20:00.000Z' } }));
    expect(a.number).toBe(b.number);
    expect([...fake.issues.values()]).toHaveLength(1);
  });

  it('persists consecutive_healthy across restart via body', async () => {
    const mem = new MemoryGithubIssues();
    await mem.createIncident(firing());
    await mem.updateIncident((await mem.listBotIncidents('open'))[0]!, healthy('w1'));
    const snapshot = await mem.listBotIncidents('open');
    expect(snapshot[0]!.consecutive_healthy).toBe(1);
    const restarted = MemoryGithubIssues.fromSerializedBodies(snapshot.map((r) => ({ ...r, consecutive_healthy: 999 })));
    // force wrong in-memory field — hydrate from body must win fail-closed trusted parse
    const hydrated = await restarted.listBotIncidents('open');
    expect(hydrated[0]!.consecutive_healthy).toBe(1);
    await restarted.updateIncident(hydrated[0]!, healthy('w2'));
    const after = await restarted.listBotIncidents('open');
    expect(after[0]!.consecutive_healthy).toBe(2);
  });

  it('recovery closes after two HEALTHY across reconcile runs', async () => {
    const mem = new MemoryGithubIssues();
    const dry = new DryRunGithubIssues(mem);
    await reconcileIncidents(dry, [firing()], { dryRun: true });
    const r1 = await reconcileIncidents(dry, [healthy('h1')], { dryRun: true });
    expect(r1.actions.some((a) => a.type === 'resolve')).toBe(false);
    const r2 = await reconcileIncidents(dry, [healthy('h2')], { dryRun: true });
    expect(r2.actions.some((a) => a.type === 'resolve')).toBe(true);
    expect(await mem.listBotIncidents('open')).toHaveLength(0);
  });

  it('handles 429 then succeeds', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.script.push({
      status: 429,
      headers: { 'retry-after': '0' },
      body: '{"message":"rate"}',
    });
    const issues = makeHttp(fake);
    const created = await issues.createIncident(firing());
    expect(created.number).toBeGreaterThan(0);
  });

  it('maps 403/404/422 to errors', async () => {
    const fake = new FakeGithubIssuesTransport();
    const issues = makeHttp(fake);
    fake.failNext = { status: 403, headers: {}, body: '{}' };
    await expect(issues.listBotIncidents('open')).rejects.toThrow(/http_403/);
    fake.failNext = { status: 404, headers: {}, body: '{}' };
    await expect(issues.listBotIncidents('open')).rejects.toThrow(/http_404/);
    fake.failNext = { status: 422, headers: {}, body: '{}' };
    await expect(issues.createIncident(firing())).rejects.toThrow(/http_422/);
  });

  it('retries 5xx then search-before-create after flaky create', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.createFlaky = true;
    const issues = makeHttp(fake);
    const created = await issues.createIncident(firing());
    expect(created.number).toBeGreaterThan(0);
  });

  it('rejects non-allowlisted repo', () => {
    const fake = new FakeGithubIssuesTransport();
    expect(
      () =>
        new HttpGithubIssues({
          owner: 'evil',
          repo: 'repo',
          token: 'test-token-xxxxxxxx',
          transport: fake.transport,
        }),
    ).toThrow(/not_allowlisted/);
  });

  it('sanitizes secrets in evidence via body builder', async () => {
    const fake = new FakeGithubIssuesTransport();
    const issues = makeHttp(fake);
    await issues.createIncident(
      firing({ evidence_summary: 'Authorization Bearer eyJabc.def.ghi sbp_secret123456789012345678901234' }),
    );
    const body = [...fake.issues.values()][0]!.body;
    expect(body).toContain('[redacted]');
    expect(body).not.toMatch(/eyJabc/);
    expect(body).not.toMatch(/sbp_secret/);
  });

  it('reports duplicate fingerprints without deleting', async () => {
    const mem = new MemoryGithubIssues();
    const a = await mem.createIncident(firing());
    // force second store entry same fp
    mem.store.set(99, {
      ...a,
      number: 99,
      body: a.body,
    });
    const r = await reconcileIncidents(mem, [firing({ time_window: { start: 's', end: 'later' } })], {
      dryRun: true,
    });
    expect(r.duplicateFingerprints).toContain(a.fingerprint);
    expect(mem.store.size).toBe(2);
  });

  it('same-window HEALTHY does not advance twice', async () => {
    const mem = new MemoryGithubIssues();
    await mem.createIncident(firing());
    const open = (await mem.listBotIncidents('open'))[0]!;
    await mem.updateIncident(open, healthy('same'));
    const mid = (await mem.listBotIncidents('open'))[0]!;
    expect(mid.consecutive_healthy).toBe(1);
    await mem.updateIncident(mid, healthy('same'));
    const again = (await mem.listBotIncidents('open'))[0]!;
    expect(again.consecutive_healthy).toBe(1);
  });

  it('legacy body without state fails closed (streak 0)', async () => {
    const mem = MemoryGithubIssues.fromSerializedBodies([
      {
        fingerprint: 'ALERT-01|qszggrrjhcwltnmxpxcy|legacy',
        alert_id: 'ALERT-01',
        number: 1,
        title: 'legacy',
        state: 'open',
        labels: ['both-watchdog'],
        body: '<!-- both-syn05-watchdog -->\nboth-syn05-fp:ALERT-01|qszggrrjhcwltnmxpxcy|legacy\n',
        opened_at: NOW,
        last_seen_at: NOW,
        bot_marker: '<!-- both-syn05-watchdog -->',
        consecutive_healthy: 5,
      },
    ]);
    const list = await mem.listBotIncidents('open');
    expect(list[0]!.consecutive_healthy).toBe(0);
  });

  it('C0 flags keep real github disabled', () => {
    expect(isRealGithubIssuesEnabled({ BOTH_WATCHDOG_DRY_RUN: '1' })).toBe(false);
    expect(isGithubWriteEnabled({ BOTH_WATCHDOG_GITHUB_WRITE: '0', BOTH_WATCHDOG_DRY_RUN: '1' })).toBe(
      false,
    );
    expect(
      isRealGithubIssuesEnabled({
        BOTH_WATCHDOG_GITHUB_HTTP: '1',
        BOTH_WATCHDOG_GITHUB_WRITE: '1',
        BOTH_WATCHDOG_DRY_RUN: '0',
      }),
    ).toBe(true);
  });

  it('workflow still omits issues:write and schedule', () => {
    const yml = readFileSync(resolve('.github/workflows/both-stage-watchdog.yml'), 'utf8');
    expect(yml).toMatch(/#\s*schedule:/);
    expect(yml).not.toMatch(/^\s*issues:\s*write\s*$/m);
    expect(yml).toContain("BOTH_WATCHDOG_DRY_RUN: '1'");
    expect(yml).toContain("BOTH_WATCHDOG_GITHUB_WRITE: '0'");
    expect(yml).toContain("BOTH_WATCHDOG_ENABLE_NETWORK: '0'");
  });

  it('corrupt state block does not parse as trusted', () => {
    const parsed = parseIncidentState('<!-- both-syn05-state:v1\n{"schema_version":1}\n-->');
    expect(parsed.ok).toBe(false);
  });

  it('409 conflict surfaces', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.failNext = { status: 409, headers: {}, body: '{"message":"conflict"}' };
    const issues = makeHttp(fake);
    await expect(issues.createIncident(firing())).rejects.toThrow(/http_409/);
  });
});
