import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import {
  classifyDeployChanges,
  assertSec07TombstonePresent,
} from './classify-deploy-changes';
import { assertDeployDecision } from './assert-deploy-decision';
import { readFileSync } from 'node:fs';

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
  delete process.env.DEPLOY_SAFETY_ALLOW_CANDIDATE;
});

function writeDecision(obj: unknown): string {
  const d = mkdtempSync(join(tmpdir(), 'c05-'));
  tmpDirs.push(d);
  const p = join(d, 'classify.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

describe('C0.5 classifyDeployChanges', () => {
  it('T01 watchdog-only → SAFE_SKIP', () => {
    const r = classifyDeployChanges([
      'scripts/syn05-watchdog/run.ts',
      '.github/workflows/both-stage-watchdog.yml',
      '.github/workflows/both-stage-watchdog-self.yml',
    ]);
    expect(r.decision).toBe('SAFE_SKIP');
    expect(r.may_skip_remote_deploy).toBe(true);
    expect(r.run_db).toBe(false);
    expect(r.run_functions).toBe(false);
  });

  it('T02 docs-only → SAFE_SKIP', () => {
    const r = classifyDeployChanges(['docs/STG-07-SYN-05-C0-5-DEPLOY-SAFETY-INTEGRATION.md']);
    expect(r.decision).toBe('SAFE_SKIP');
  });

  it('T03 migration → DEPLOY_CANDIDATE_DB', () => {
    const r = classifyDeployChanges(['supabase/migrations/20261118000001_x.sql']);
    expect(r.decision).toBe('DEPLOY_CANDIDATE_DB');
    expect(r.run_db).toBe(true);
    expect(r.run_functions).toBe(false);
  });

  it('T04 edge function → DEPLOY_CANDIDATE_FUNCTIONS', () => {
    const r = classifyDeployChanges(['supabase/functions/google-oauth/index.ts']);
    expect(r.decision).toBe('DEPLOY_CANDIDATE_FUNCTIONS');
    expect(r.run_functions).toBe(true);
  });

  it('T05 _shared → DEPLOY_CANDIDATE_FUNCTIONS', () => {
    const r = classifyDeployChanges(['supabase/functions/_shared/http.ts']);
    expect(r.decision).toBe('DEPLOY_CANDIDATE_FUNCTIONS');
  });

  it('T06 config.toml alone → REQUIRES_REVIEW', () => {
    const r = classifyDeployChanges(['supabase/config.toml']);
    expect(r.decision).toBe('REQUIRES_REVIEW');
    expect(r.run_db).toBe(false);
    expect(r.run_functions).toBe(false);
  });

  it('T07 deploy-stage.yml → BOOTSTRAP_REVIEW', () => {
    const r = classifyDeployChanges(['.github/workflows/deploy-stage.yml']);
    expect(r.decision).toBe('BOOTSTRAP_REVIEW');
    expect(r.may_skip_remote_deploy).toBe(false);
    expect(r.run_db).toBe(false);
    expect(r.run_functions).toBe(false);
  });

  it('T08 multi-commit range (mixed paths)', () => {
    const r = classifyDeployChanges([
      'docs/a.md',
      'scripts/syn05-watchdog/types.ts',
      'supabase/migrations/20261118000002_y.sql',
    ]);
    expect(r.decision).toBe('DEPLOY_CANDIDATE_DB');
  });

  it('T09 merge-like set with function + docs', () => {
    const r = classifyDeployChanges([
      'docs/x.md',
      'supabase/functions/billing-webhook/index.ts',
    ]);
    expect(r.decision).toBe('DEPLOY_CANDIDATE_FUNCTIONS');
  });

  it('T10 empty paths → UNKNOWN_BLOCKED', () => {
    const r = classifyDeployChanges([]);
    expect(r.decision).toBe('UNKNOWN_BLOCKED');
    expect(r.may_skip_remote_deploy).toBe(false);
  });

  it('T11 unknown path → UNKNOWN_BLOCKED', () => {
    const r = classifyDeployChanges(['package.json']);
    expect(r.decision).toBe('UNKNOWN_BLOCKED');
  });

  it('T12 migrations + functions → DEPLOY_CANDIDATE_BOTH', () => {
    const r = classifyDeployChanges([
      'supabase/migrations/20261118000003_z.sql',
      'supabase/functions/delete-account/index.ts',
    ]);
    expect(r.decision).toBe('DEPLOY_CANDIDATE_BOTH');
    expect(r.run_db).toBe(true);
    expect(r.run_functions).toBe(true);
  });

  it('T13 sensitive pipeline + docs still BOOTSTRAP_REVIEW', () => {
    const r = classifyDeployChanges([
      'docs/a.md',
      '.github/workflows/deploy-stage.yml',
      'scripts/deploy-safety/classify-deploy-changes.ts',
    ]);
    expect(r.decision).toBe('BOOTSTRAP_REVIEW');
  });

  it('T14 rename/deletion of function path still candidate', () => {
    const r = classifyDeployChanges(['supabase/functions/sync-calendar/index.ts']);
    expect(r.decision).toBe('DEPLOY_CANDIDATE_FUNCTIONS');
  });

  it('T15 watchdog + migration → not SAFE_SKIP', () => {
    const r = classifyDeployChanges([
      'scripts/syn05-watchdog/run.ts',
      'supabase/migrations/20261118000004_w.sql',
    ]);
    expect(r.decision).toBe('DEPLOY_CANDIDATE_DB');
    expect(r.may_skip_remote_deploy).toBe(false);
  });

  it('T16 rate-limit/API unavailable simulated as empty/error → UNKNOWN_BLOCKED', () => {
    // Caller maps API failure to empty list; classifier fail-closed.
    const r = classifyDeployChanges([]);
    expect(r.decision).toBe('UNKNOWN_BLOCKED');
  });

  it('T17 classifier crash path: assert rejects missing file', () => {
    const a = assertDeployDecision('/tmp/c05-does-not-exist-decision.json');
    expect(a.ok).toBe(false);
    expect(a.run_db).toBe(false);
    expect(a.run_functions).toBe(false);
  });

  it('T18 resultado ausente → sem deploy', () => {
    const a = assertDeployDecision('/nonexistent/classify.json');
    expect(a.ok).toBe(false);
    expect(a.run_db).toBe(false);
  });

  it('T19 resultado adulterado → sem deploy', () => {
    const p = writeDecision({
      decision: 'SAFE_SKIP',
      may_skip_remote_deploy: true,
      run_db: true,
      run_functions: false,
    });
    const a = assertDeployDecision(p);
    expect(a.ok).toBe(false);
    expect(a.reason).toBe('safe_skip_tampered');
    expect(a.run_db).toBe(false);
  });

  it('T20 branch/project-ref incorreto → sem deploy', () => {
    const p = writeDecision({
      decision: 'SAFE_SKIP',
      may_skip_remote_deploy: true,
      run_db: false,
      run_functions: false,
    });
    const a = assertDeployDecision(p, 'qszggrrjhcwltnmxpxcy', 'sknpqjodttkpttaytdut');
    expect(a.ok).toBe(false);
    expect(a.reason).toBe('project_ref_mismatch');
  });

  it('T21 project-ref diferente → sem deploy', () => {
    const p = writeDecision({
      decision: 'DEPLOY_CANDIDATE_BOTH',
      may_skip_remote_deploy: false,
      run_db: true,
      run_functions: true,
    });
    process.env.DEPLOY_SAFETY_ALLOW_CANDIDATE = '1';
    const a = assertDeployDecision(p, 'qszggrrjhcwltnmxpxcy', 'otherref');
    expect(a.ok).toBe(false);
    expect(a.run_db).toBe(false);
  });

  it('T22 bootstrap commit simulado → sem deploy', () => {
    const r = classifyDeployChanges([
      '.github/workflows/deploy-stage.yml',
      'scripts/deploy-safety/classify-deploy-changes.ts',
      'docs/STG-07-SYN-05-C0-5-BOOTSTRAP-SAFETY.md',
    ]);
    expect(r.decision).toBe('BOOTSTRAP_REVIEW');
    const p = writeDecision(r);
    const a = assertDeployDecision(p);
    expect(a.run_db).toBe(false);
    expect(a.run_functions).toBe(false);
  });

  it('T23 código develop com SEC-07 ausente → veto', () => {
    const root = mkdtempSync(join(tmpdir(), 'sec07-'));
    tmpDirs.push(root);
    mkdirSync(join(root, 'supabase/functions/sync-calendar'), { recursive: true });
    writeFileSync(
      join(root, 'supabase/functions/sync-calendar/index.ts'),
      'Deno.serve(() => new Response("legacy sync"))\n',
    );
    mkdirSync(join(root, 'supabase'), { recursive: true });
    writeFileSync(
      join(root, 'supabase/config.toml'),
      '[functions.sync-calendar]\nverify_jwt = false\n',
    );
    const v = assertSec07TombstonePresent(root);
    expect(v.ok).toBe(false);
  });

  it('T24 falha verificação drift → BLOCKED (veto false)', () => {
    const root = mkdtempSync(join(tmpdir(), 'sec07b-'));
    tmpDirs.push(root);
    mkdirSync(join(root, 'supabase/functions/sync-calendar'), { recursive: true });
    writeFileSync(
      join(root, 'supabase/functions/sync-calendar/index.ts'),
      '// SEC-07 handleLegacySyncCalendar 410 Gone\n',
    );
    writeFileSync(
      join(root, 'supabase/config.toml'),
      '[functions.sync-calendar]\nverify_jwt = false\n',
    );
    const v = assertSec07TombstonePresent(root);
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('sync_calendar_verify_jwt_not_true');
  });

  it('T25 db push condicionado — candidate blocked without release gate', () => {
    const r = classifyDeployChanges(['supabase/migrations/20261118000005.sql']);
    const p = writeDecision(r);
    const a = assertDeployDecision(p);
    expect(a.decision).toBe('DEPLOY_CANDIDATE_DB');
    expect(a.run_db).toBe(false);
    expect(a.reason).toBe('candidate_blocked_until_release_gate');
  });

  it('T26 functions deploy condicionado — candidate blocked without release gate', () => {
    const r = classifyDeployChanges(['supabase/functions/google-oauth/index.ts']);
    const p = writeDecision(r);
    const a = assertDeployDecision(p);
    expect(a.run_functions).toBe(false);
  });

  it('T27 workflow sem credenciais / invalid decision → fail-closed', () => {
    const p = writeDecision({ decision: 'HACKED', run_db: true, run_functions: true });
    const a = assertDeployDecision(p);
    expect(a.ok).toBe(false);
    expect(a.run_db).toBe(false);
  });

  it('T28 PR #17 merge simulado → SAFE_SKIP', () => {
    const r = classifyDeployChanges([
      '.github/workflows/both-stage-watchdog-self.yml',
      '.github/workflows/both-stage-watchdog.yml',
      'docs/STG-07-SYN-05-C0-1-PR-RESULT.md',
      'docs/STG-07-SYN-05-C0-3-TYPECHECK-FIX.md',
      'scripts/syn05-watchdog/run.ts',
      'scripts/syn05-watchdog/types.ts',
      'supabase/functions/_shared/observability/alert-evaluator.ts',
      'supabase/functions/_shared/observability/alert-evaluator.test.ts',
      'tsconfig.json',
      'vitest.config.ts',
    ]);
    expect(r.decision).toBe('SAFE_SKIP');
    const p = writeDecision(r);
    const a = assertDeployDecision(p);
    expect(a.skip_remote).toBe(true);
    expect(a.run_db).toBe(false);
    expect(a.run_functions).toBe(false);
  });

  it('T29 execução em cascata / candidate allowed still respects flags', () => {
    process.env.DEPLOY_SAFETY_ALLOW_CANDIDATE = '1';
    const r = classifyDeployChanges(['supabase/migrations/x.sql']);
    const p = writeDecision(r);
    const a = assertDeployDecision(p);
    expect(a.run_db).toBe(true);
    expect(a.run_functions).toBe(false);
  });

  it('T30 watchdog + edge function → not SAFE_SKIP', () => {
    const r = classifyDeployChanges([
      'scripts/syn05-watchdog/run.ts',
      'supabase/functions/sync-calendar/index.ts',
    ]);
    expect(r.decision).toBe('DEPLOY_CANDIDATE_FUNCTIONS');
  });

  it('SEC-07 tombstone ok fixture', () => {
    const root = mkdtempSync(join(tmpdir(), 'sec07ok-'));
    tmpDirs.push(root);
    mkdirSync(join(root, 'supabase/functions/sync-calendar'), { recursive: true });
    writeFileSync(
      join(root, 'supabase/functions/sync-calendar/index.ts'),
      '// SEC-07 handleLegacySyncCalendar returns 410 Gone\n',
    );
    writeFileSync(
      join(root, 'supabase/config.toml'),
      '[functions.sync-calendar]\nverify_jwt = true\n',
    );
    expect(assertSec07TombstonePresent(root).ok).toBe(true);
  });
});

describe('C0.5 workflow YAML invariants', () => {
  const yml = readFileSync(
    new URL('../../.github/workflows/deploy-stage.yml', import.meta.url),
    'utf8',
  );

  it('db push only under RUN_DB condition', () => {
    expect(yml).toMatch(/if:\s*env\.RUN_DB == 'true'[\s\S]*?supabase db push(?! --dry-run)/);
  });

  it('functions deploy only under RUN_FUNCTIONS', () => {
    expect(yml).toMatch(/if:\s*env\.RUN_FUNCTIONS == 'true'[\s\S]*?supabase functions deploy/);
  });

  it('deploy job requires assert_ok and run flags', () => {
    expect(yml).toContain("needs.classify.outputs.assert_ok == 'true'");
    expect(yml).toContain("needs.classify.outputs.run_db == 'true'");
    expect(yml).toContain("needs.classify.outputs.run_functions == 'true'");
  });

  it('pins immutable action SHAs', () => {
    expect(yml).toContain('actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
    expect(yml).toContain('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1');
    expect(yml).toContain('supabase/setup-cli@1dedf2c611547ede7232d26866dd3c56ab903bbb');
  });

  it('no unpinned @v floating tags for checkout/setup-node', () => {
    const uses = yml.split('\n').filter((l) => /^\s+- uses:/.test(l)).join('\n');
    expect(uses).not.toMatch(/actions\/checkout@v\d/);
    expect(uses).not.toMatch(/actions\/setup-node@v\d/);
    expect(uses).not.toMatch(/supabase\/setup-cli@v\d/);
  });

  it('permissions contents read only', () => {
    expect(yml).toMatch(/permissions:\s*\n\s*contents:\s*read/);
  });

  it('only triggers on develop push / workflow_dispatch', () => {
    expect(yml).toContain('branches:\n      - develop');
    expect(yml).not.toContain('pull_request:');
  });
});
