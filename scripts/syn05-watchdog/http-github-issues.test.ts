import { describe, expect, it } from 'vitest';
import {
  assertGithubApiUrl,
  assertGithubIssuesPath,
  createPinnedGithubTransport,
  FakeGithubIssuesTransport,
  GITHUB_API_ORIGIN,
  GithubHttpError,
  parseGithubNextLink,
} from './github-http.ts';
import {
  AmbiguousCreateError,
  HttpGithubIssues,
  isRealGithubIssuesEnabled,
  ReconcileRequiredError,
  SearchIncompleteError,
} from './http-github-issues.ts';
import {
  BOT_LABEL,
  BOT_MARKER,
  BOT_FINGERPRINT_PREFIX,
  DryRunGithubIssues,
  isGithubWriteEnabled,
  MemoryGithubIssues,
} from './github-issues.ts';
import { parseIncidentState, serializeIncidentState, upsertIncidentStateBlock } from './incident-state.ts';
import { reconcileIncidents } from './reconcile.ts';
import { STAGE_PROJECT_REF, type AlertEvaluation } from './types.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FP = 'ALERT-01|qszggrrjhcwltnmxpxcy|fp-http';

function firing(partial: Partial<AlertEvaluation> = {}): AlertEvaluation {
  return {
    alert_id: 'ALERT-01',
    severity: 'P1',
    environment: 'stage',
    project_ref: STAGE_PROJECT_REF,
    evaluation_status: 'FIRING',
    observed_count: 3,
    time_window: { start: '2026-11-19T09:00:00.000Z', end: '2026-11-19T09:10:00.000Z' },
    fingerprint: FP,
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

function makeHttp(fake: FakeGithubIssuesTransport, extra?: Partial<ConstructorParameters<typeof HttpGithubIssues>[0]>) {
  return new HttpGithubIssues({
    owner: 'ruanlima-devops',
    repo: 'both-calendar-sync',
    token: 'test-token-xxxxxxxx',
    transport: fake.transport,
    sleep: async () => {},
    ...extra,
  });
}

function botBody(fp = FP): string {
  const state = {
    schema_version: 1 as const,
    project_ref: STAGE_PROJECT_REF,
    environment: 'stage' as const,
    alert_id: 'ALERT-01',
    fingerprint: fp,
    first_seen_at: '2026-11-19T09:00:00.000Z',
    last_seen_at: '2026-11-19T09:00:00.000Z',
    consecutive_healthy: 0,
    alert_status: 'FIRING' as const,
    last_transition_at: '2026-11-19T09:00:00.000Z',
    last_sample_window_end: '2026-11-19T09:10:00.000Z',
  };
  return upsertIncidentStateBlock(
    `${BOT_MARKER}\n${BOT_FINGERPRINT_PREFIX}${fp}\n`,
    state,
  );
}

describe('host pin / transport safety', () => {
  it('rejects non-https and wrong host/port/credentials', () => {
    expect(() => assertGithubApiUrl(new URL('http://api.github.com/repos/x'))).toThrow(/https/);
    expect(() => assertGithubApiUrl(new URL('https://evil.example/repos/x'))).toThrow(/host/);
    expect(() => assertGithubApiUrl(new URL('https://api.github.com:8443/repos/x'))).toThrow(/port/);
    expect(() => assertGithubApiUrl(new URL('https://user:pass@api.github.com/repos/x'))).toThrow(
      /credentials/,
    );
  });

  it('rejects path injection and non-allowlisted paths', () => {
    expect(() => assertGithubIssuesPath('https://api.github.com/repos/x')).toThrow();
    expect(() => assertGithubIssuesPath('/repos/other/repo/issues')).toThrow();
    expect(() => assertGithubIssuesPath('/repos/ruanlima-devops/both-calendar-sync/issues')).not.toThrow();
  });

  it('parseGithubNextLink only accepts api.github.com issues paths', () => {
    const next = parseGithubNextLink(
      `<${GITHUB_API_ORIGIN}/repos/ruanlima-devops/both-calendar-sync/issues?page=2>; rel="next"`,
    );
    expect(next).toContain('page=2');
    expect(() =>
      parseGithubNextLink('<https://evil.example/repos/ruanlima-devops/both-calendar-sync/issues?page=2>; rel="next"'),
    ).toThrow(/host/);
  });

  it('pinned transport rejects redirect and wrong host via fetchImpl', async () => {
    const transport = createPinnedGithubTransport({
      timeoutMs: 1000,
      fetchImpl: (async (url: RequestInfo | URL) => {
        expect(String(url).startsWith(GITHUB_API_ORIGIN)).toBe(true);
        throw new Error('redirect blocked in test');
      }) as unknown as typeof fetch,
    });
    await expect(
      transport({
        method: 'GET',
        path: '/repos/ruanlima-devops/both-calendar-sync/issues',
        headers: { Authorization: 'Bearer secret-token-value' },
      }),
    ).rejects.toThrow();
  });

  it('does not leak Authorization in fake call log', async () => {
    const fake = new FakeGithubIssuesTransport();
    const issues = makeHttp(fake);
    await issues.listBotIncidents('open');
    const auth = JSON.stringify(fake.calls);
    expect(auth).not.toContain('test-token-xxxxxxxx');
    expect(auth).toMatch(/\[redacted\]/);
  });

  it('rejects non-allowlisted repo at construct', () => {
    const fake = new FakeGithubIssuesTransport();
    expect(
      () =>
        new HttpGithubIssues({
          owner: 'evil',
          repo: 'repo',
          token: 'test-token-xxxxxxxx',
          transport: fake.transport,
        }),
    ).toThrow(/allowlisted/);
  });
});

describe('pagination / completeness', () => {
  it('finds issue on second page', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.pageSize = 2;
    for (let i = 1; i <= 3; i++) {
      fake.seedIssue({
        number: i,
        labels: [BOT_LABEL],
        body: botBody(`ALERT-01|qszggrrjhcwltnmxpxcy|fp-${i}`),
        state: 'open',
      });
    }
    const issues = makeHttp(fake, { maxPages: 5 });
    const found = await issues.findOpenByFingerprint('ALERT-01|qszggrrjhcwltnmxpxcy|fp-3');
    expect(found?.number).toBe(3);
  });

  it('empty page is complete', async () => {
    const fake = new FakeGithubIssuesTransport();
    const issues = makeHttp(fake);
    const list = await issues.listBotIncidents('open');
    expect(list).toEqual([]);
  });

  it('invalid next link yields incomplete and blocks create', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.script.push({
      status: 200,
      headers: { link: '<https://evil.example/x>; rel="next"' },
      body: '[]',
    });
    const issues = makeHttp(fake);
    await expect(issues.createIncident(firing())).rejects.toBeInstanceOf(SearchIncompleteError);
  });

  it('max pages exceeded is incomplete and blocks create', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.pageSize = 1;
    fake.maxFakePages = 100;
    for (let i = 1; i <= 5; i++) {
      fake.seedIssue({
        number: i,
        labels: [BOT_LABEL],
        body: botBody(`ALERT-01|qszggrrjhcwltnmxpxcy|p-${i}`),
      });
    }
    const issues = makeHttp(fake, { maxPages: 2, maxIssues: 100 });
    await expect(issues.createIncident(firing({ fingerprint: 'ALERT-01|qszggrrjhcwltnmxpxcy|missing' }))).rejects.toBeInstanceOf(
      SearchIncompleteError,
    );
  });

  it('filters pull_request items from issue lists', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.seedIssue({
      number: 1,
      labels: [BOT_LABEL],
      body: botBody(),
      pull_request: { url: 'https://api.github.com/repos/x/pulls/1' },
    });
    const issues = makeHttp(fake);
    const list = await issues.listBotIncidents('open');
    expect(list).toHaveLength(0);
  });
});

describe('ambiguous create / timeout', () => {
  it('search-before-create dedupes fingerprint', async () => {
    const fake = new FakeGithubIssuesTransport();
    const issues = makeHttp(fake);
    const a = await issues.createIncident(firing());
    const b = await issues.createIncident(
      firing({ time_window: { start: 's', end: '2026-11-19T09:20:00.000Z' } }),
    );
    expect(a.number).toBe(b.number);
    expect([...fake.issues.values()]).toHaveLength(1);
  });

  it('timeout after successful create re-searches and returns canonical', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.createSucceedsThenTimeout = true;
    const issues = makeHttp(fake);
    const created = await issues.createIncident(firing());
    expect(created.number).toBeGreaterThan(0);
    expect(issues.lastAmbiguousCreate?.fingerprint).toBe(FP);
    // Only one issue despite timeout
    expect([...fake.issues.values()]).toHaveLength(1);
    // Must not have issued a second POST
    const posts = fake.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
  });

  it('ambiguous create with empty complete search does not blind-retry POST', async () => {
    const fake = new FakeGithubIssuesTransport();
    // open search → closed search → POST timeout (no create) → re-search open empty
    fake.script.push({ status: 200, headers: {}, body: '[]' });
    fake.script.push({ status: 200, headers: {}, body: '[]' });
    fake.script.push(async () => {
      throw new GithubHttpError('timeout', 0, undefined, 'timeout');
    });
    const issues = makeHttp(fake);
    await expect(issues.createIncident(firing())).rejects.toBeInstanceOf(AmbiguousCreateError);
    expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('createFlaky 500 without create → ambiguous, no blind POST retry loop', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.createFlaky = true;
    const issues = makeHttp(fake);
    await expect(issues.createIncident(firing())).rejects.toBeInstanceOf(AmbiguousCreateError);
    expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });
});

describe('safe reopen', () => {
  it('reopens closed bot issue on FIRING instead of creating duplicate', async () => {
    const fake = new FakeGithubIssuesTransport();
    const n = fake.seedIssue({
      number: 7,
      state: 'closed',
      labels: [BOT_LABEL],
      body: botBody(),
    });
    const issues = makeHttp(fake);
    const reopened = await issues.createIncident(
      firing({ time_window: { start: 's', end: '2026-11-19T10:00:00.000Z' } }),
    );
    expect(reopened.number).toBe(n);
    expect(reopened.state).toBe('open');
    expect(fake.issues.get(n)!.state).toBe('open');
    expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('refuses reopen with corrupt state', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.seedIssue({
      number: 8,
      state: 'closed',
      labels: [BOT_LABEL],
      body: `${BOT_MARKER}\n${BOT_FINGERPRINT_PREFIX}${FP}\n<!-- both-syn05-state:v1\n{not-json}\n-->`,
    });
    const issues = makeHttp(fake);
    await expect(issues.createIncident(firing())).rejects.toThrow(/corrupt_state/);
  });

  it('refuses reopen of human issue', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.seedIssue({
      number: 9,
      state: 'closed',
      labels: ['human'],
      body: 'manual note',
    });
    const issues = makeHttp(fake);
    // no bot closed match → would try create; human ignored
    const created = await issues.createIncident(firing());
    expect(created.number).not.toBe(9);
  });

  it('refuses stale sample reopen', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.seedIssue({
      number: 10,
      state: 'closed',
      labels: [BOT_LABEL],
      body: botBody(),
    });
    const issues = makeHttp(fake);
    await expect(
      issues.createIncident(
        firing({ time_window: { start: 's', end: '2026-11-19T08:00:00.000Z' } }),
      ),
    ).rejects.toThrow(/stale_sample/);
  });

  it('multiple closed candidates → reconcile required', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.seedIssue({ number: 11, state: 'closed', labels: [BOT_LABEL], body: botBody() });
    fake.seedIssue({ number: 12, state: 'closed', labels: [BOT_LABEL], body: botBody() });
    const issues = makeHttp(fake);
    await expect(issues.findClosedByFingerprint(FP)).rejects.toBeInstanceOf(ReconcileRequiredError);
  });
});

describe('HttpGithubIssues offline regression', () => {
  it('persists consecutive_healthy across restart via body', async () => {
    const mem = new MemoryGithubIssues();
    await mem.createIncident(firing());
    await mem.updateIncident((await mem.listBotIncidents('open'))[0]!, healthy('w1'));
    const snapshot = await mem.listBotIncidents('open');
    expect(snapshot[0]!.consecutive_healthy).toBe(1);
    const restarted = MemoryGithubIssues.fromSerializedBodies(
      snapshot.map((r) => ({ ...r, consecutive_healthy: 999 })),
    );
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

  it('handles 429 then succeeds on GET list', async () => {
    const fake = new FakeGithubIssuesTransport();
    fake.script.push({
      status: 429,
      headers: { 'retry-after': '0' },
      body: '{"message":"rate"}',
    });
    const issues = makeHttp(fake);
    const list = await issues.listBotIncidents('open');
    expect(list).toEqual([]);
  });

  it('maps 401/403/404/422', async () => {
    const fake = new FakeGithubIssuesTransport();
    const issues = makeHttp(fake);
    fake.failNext = { status: 403, headers: {}, body: '{}' };
    await expect(issues.listBotIncidents('open')).rejects.toThrow(/unauthorized|http_403/);
    fake.failNext = { status: 404, headers: {}, body: '{}' };
    await expect(issues.listBotIncidents('open')).rejects.toThrow(/not_found/);
    fake.failNext = { status: 422, headers: {}, body: '{}' };
    await expect(issues.listBotIncidents('open')).rejects.toThrow(/http_422|conflict/);
  });

  it('409 conflict surfaces without blind create retry', async () => {
    const fake = new FakeGithubIssuesTransport();
    // open + closed searches then POST 409
    fake.script.push({ status: 200, headers: {}, body: '[]' });
    fake.script.push({ status: 200, headers: {}, body: '[]' });
    fake.script.push({ status: 409, headers: {}, body: '{}' });
    const issues = makeHttp(fake);
    await expect(issues.createIncident(firing())).rejects.toThrow(/409|conflict/);
    expect(fake.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('sanitizes secrets in evidence via body builder', async () => {
    const fake = new FakeGithubIssuesTransport();
    const issues = makeHttp(fake);
    const created = await issues.createIncident(
      firing({ evidence_summary: 'Bearer supersecrettoken999 failed' }),
    );
    expect(created.body).not.toContain('supersecrettoken999');
  });

  it('reports duplicate fingerprints without deleting', async () => {
    const mem = new MemoryGithubIssues();
    const a = await mem.createIncident(firing());
    // force second open with same fingerprint via seed
    mem.store.set(99, { ...a, number: 99 });
    const dry = new DryRunGithubIssues(mem);
    const r = await reconcileIncidents(dry, [firing()], { dryRun: true });
    expect(r.duplicateFingerprints).toContain(a.fingerprint);
  });

  it('same-window HEALTHY does not advance twice', async () => {
    const mem = new MemoryGithubIssues();
    await mem.createIncident(firing());
    const open = (await mem.listBotIncidents('open'))[0]!;
    await mem.updateIncident(open, healthy('same'));
    const mid = (await mem.listBotIncidents('open'))[0]!;
    expect(mid.consecutive_healthy).toBe(1);
    await mem.updateIncident(mid, healthy('same'));
    const after = (await mem.listBotIncidents('open'))[0]!;
    expect(after.consecutive_healthy).toBe(1);
  });

  it('legacy body without state fails closed (streak 0)', async () => {
    const mem = MemoryGithubIssues.fromSerializedBodies([
      {
        fingerprint: FP,
        alert_id: 'ALERT-01',
        number: 1,
        title: 'x',
        state: 'open',
        labels: [BOT_LABEL],
        body: `${BOT_MARKER}\n${BOT_FINGERPRINT_PREFIX}${FP}\n`,
        opened_at: 't',
        last_seen_at: 't',
        bot_marker: BOT_MARKER,
        consecutive_healthy: 5,
      },
    ]);
    const list = await mem.listBotIncidents('open');
    expect(list[0]!.consecutive_healthy).toBe(0);
  });

  it('UNKNOWN does not close', async () => {
    const mem = new MemoryGithubIssues();
    const dry = new DryRunGithubIssues(mem);
    await reconcileIncidents(dry, [firing()], { dryRun: true });
    await reconcileIncidents(dry, [healthy('h1')], { dryRun: true });
    const r = await reconcileIncidents(
      dry,
      [firing({ evaluation_status: 'UNKNOWN', evidence_summary: 'incomplete' })],
      { dryRun: true },
    );
    expect(r.actions.some((a) => a.type === 'resolve')).toBe(false);
    expect(await mem.listBotIncidents('open')).toHaveLength(1);
  });

  it('C0 flags keep real github disabled', () => {
    expect(isRealGithubIssuesEnabled({ BOTH_WATCHDOG_DRY_RUN: '1' })).toBe(false);
    expect(isGithubWriteEnabled({ BOTH_WATCHDOG_GITHUB_WRITE: '1', BOTH_WATCHDOG_DRY_RUN: '1' })).toBe(
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
    const yml = readFileSync(resolve('scripts/syn05-watchdog/../../.github/workflows/both-stage-watchdog.yml'), 'utf8');
    expect(yml).toContain("BOTH_WATCHDOG_DRY_RUN: '1'");
    expect(yml).toContain("BOTH_WATCHDOG_GITHUB_WRITE: '0'");
    expect(yml).toContain("BOTH_WATCHDOG_ENABLE_NETWORK: '0'");
    expect(yml).toMatch(/# schedule:/);
    expect(yml).not.toMatch(/^\s*issues:\s*write/m);
  });

  it('corrupt state block does not parse as trusted', () => {
    const bad = '<!-- both-syn05-state:v1\n{bad}\n-->';
    expect(parseIncidentState(bad).ok).toBe(false);
  });

  it('no module-level network: serialize helpers are sync', () => {
    const s = serializeIncidentState({
      schema_version: 1,
      project_ref: STAGE_PROJECT_REF,
      environment: 'stage',
      alert_id: 'ALERT-01',
      fingerprint: FP,
      first_seen_at: '2026-11-19T09:00:00.000Z',
      last_seen_at: '2026-11-19T09:00:00.000Z',
      consecutive_healthy: 0,
      alert_status: 'FIRING',
      last_transition_at: '2026-11-19T09:00:00.000Z',
    });
    expect(s).toContain('both-syn05-state:v1');
  });
});
