import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import {
  classifyDeployChanges,
  assertSec07TombstonePresent,
  FRONTEND_CLIENT_SAFE_SKIP_EXACT,
  isUnsafePathShape,
  frontendAllowlistContentRejected,
} from './classify-deploy-changes';
import { assertDeployDecision } from './assert-deploy-decision';
import { readFileSync } from 'node:fs';

/** Exact changed paths from merge #42 (first-parent diff). */
const PR42_AUTH_PATHS = [
  'app/(app)/(tabs)/settings.tsx',
  'app/(auth)/confirm-email.tsx',
  'app/(auth)/forgot-password.tsx',
  'app/(auth)/login.tsx',
  'app/(auth)/sign-up.tsx',
  'app/auth/update-password.tsx',
  'components/auth/AuthPasswordField.tsx',
  'components/auth/AuthPrimaryButton.tsx',
  'components/auth/AuthTextField.tsx',
  'lib/auth/email-password.ts',
  'lib/auth/errors.password.test.ts',
  'lib/auth/errors.ts',
  'lib/auth/identity-safety.test.ts',
  'lib/auth/identity-safety.ts',
  'lib/auth/password-policy.test.ts',
  'lib/auth/password-policy.ts',
] as const;

/** Exact changed paths from PR #43 head vs merge-base #42. */
const PR43_ONBOARDING_PATHS = [
  'app/(onboarding)/index.tsx',
  'lib/calendars/lifecycle.test.ts',
  'lib/calendars/lifecycle.ts',
  'lib/onboarding/calendar-step.test.ts',
  'lib/onboarding/calendar-step.ts',
  'lib/onboarding/journey.test.ts',
  'lib/onboarding/journey.ts',
] as const;

/** Exact changed paths from PR #44 vs develop (HEAD 12f95dd). */
const PR44_CALENDAR_PATHS = [
  'app/(app)/(tabs)/calendars.tsx',
  'app/+not-found.tsx',
  'lib/calendars/disconnect-confirm.test.ts',
  'lib/calendars/disconnect-confirm.ts',
] as const;

/** Exact changed paths from PR #45 vs develop (HEAD 9514845). */
const PR45_PAYWALL_PATHS = [
  'app/(app)/_layout.tsx',
  'app/(app)/paywall.tsx',
  'lib/billing/entitlement-gate.test.ts',
  'lib/billing/entitlement-gate.ts',
  'lib/billing/entitlement.test.ts',
  'lib/billing/paywall-params.test.ts',
  'lib/billing/paywall-params.ts',
  'lib/billing/paywall-scenarios.test.ts',
  'lib/billing/paywall-scenarios.ts',
] as const;

/** Exact OAuth *client* paths from PR #50 (Edge Functions / migration stay deployable). */
const PR50_OAUTH_CLIENT_PATHS = [
  'app/oauth.tsx',
  'context/session.tsx',
  'lib/auth/routing.ts',
  'lib/auth/routing.test.ts',
  'lib/errors.ts',
  'lib/oauth.ts',
  'lib/oauth-complete.ts',
  'lib/oauth-complete.test.ts',
] as const;

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

  /**
   * Recovery from incident 2026-11-22 (Deploy STAGE run 45030676921).
   * T11b from diagnostic worktree asserted UNKNOWN_BLOCKED pre-fix; post-fix
   * the audited exact paths must SAFE_SKIP with run_*=false (no Supabase deploy).
   */
  it('T11b PR42 auth frontend exact paths → SAFE_SKIP (deploy target only)', () => {
    for (const p of PR42_AUTH_PATHS) {
      expect(FRONTEND_CLIENT_SAFE_SKIP_EXACT.has(p)).toBe(true);
    }
    const r = classifyDeployChanges([...PR42_AUTH_PATHS], {
      contentByPath: Object.fromEntries(PR42_AUTH_PATHS.map((p) => [p, 'export const x = 1;\n'])),
    });
    expect(r.decision).toBe('SAFE_SKIP');
    expect(r.reasons).toContain('only_safe_skip_paths');
    expect(r.run_db).toBe(false);
    expect(r.run_functions).toBe(false);
    expect(r.may_skip_remote_deploy).toBe(true);
    expect(r.matched.other).toEqual([]);
    expect(r.matched.migrations).toEqual([]);
    expect(r.matched.functions).toEqual([]);

    const decisionPath = writeDecision(r);
    const a = assertDeployDecision(decisionPath);
    expect(a.ok).toBe(true);
    expect(a.decision).toBe('SAFE_SKIP');
    expect(a.run_db).toBe(false);
    expect(a.run_functions).toBe(false);
    expect(a.skip_remote).toBe(true);
  });

  it('T11c PR43 onboarding exact paths → SAFE_SKIP', () => {
    const r = classifyDeployChanges([...PR43_ONBOARDING_PATHS], {
      contentByPath: Object.fromEntries(PR43_ONBOARDING_PATHS.map((p) => [p, 'export const y = 1;\n'])),
    });
    expect(r.decision).toBe('SAFE_SKIP');
    expect(r.run_db).toBe(false);
    expect(r.run_functions).toBe(false);
    expect(r.may_skip_remote_deploy).toBe(true);
  });

  it('T11d sibling under app/ not in exact allowlist → UNKNOWN_BLOCKED', () => {
    const r = classifyDeployChanges(['app/(auth)/brand-new-screen.tsx']);
    expect(r.decision).toBe('UNKNOWN_BLOCKED');
    expect(r.reasons[0]).toBe('unclassified_paths');
    expect(r.may_skip_remote_deploy).toBe(false);
  });

  it('T11e no generic app/** components/** lib/** allowlist', () => {
    for (const p of [
      'app/evil.tsx',
      'components/ui/Button.tsx',
      'lib/supabase.ts',
      'lib/billing/client.ts',
      'lib/oauth-extra.ts',
    ]) {
      const r = classifyDeployChanges([p]);
      expect(r.decision).toBe('UNKNOWN_BLOCKED');
    }
  });

  it('T11f mixed safe frontend + unknown → UNKNOWN_BLOCKED', () => {
    const r = classifyDeployChanges([
      'app/(auth)/login.tsx',
      'package.json',
    ]);
    expect(r.decision).toBe('UNKNOWN_BLOCKED');
    expect(r.may_skip_remote_deploy).toBe(false);
  });

  it('T11g mixed safe frontend + function → DEPLOY_CANDIDATE_FUNCTIONS', () => {
    const r = classifyDeployChanges([
      'app/(auth)/login.tsx',
      'supabase/functions/delete-account/index.ts',
    ]);
    expect(r.decision).toBe('DEPLOY_CANDIDATE_FUNCTIONS');
    expect(r.run_functions).toBe(true);
    expect(r.may_skip_remote_deploy).toBe(false);
  });

  it('T11h mixed safe frontend + migration → DEPLOY_CANDIDATE_DB', () => {
    const r = classifyDeployChanges([
      'lib/onboarding/journey.ts',
      'supabase/migrations/20261118000099_x.sql',
    ]);
    expect(r.decision).toBe('DEPLOY_CANDIDATE_DB');
    expect(r.run_db).toBe(true);
    expect(r.may_skip_remote_deploy).toBe(false);
  });

  it('T11i path traversal / absolute never SAFE_SKIP', () => {
    expect(isUnsafePathShape('../app/(auth)/login.tsx')).toBe(true);
    expect(isUnsafePathShape('app/../supabase/migrations/x.sql')).toBe(true);
    expect(isUnsafePathShape('/etc/passwd')).toBe(true);
    expect(isUnsafePathShape('app//login.tsx')).toBe(true);
    for (const p of [
      '../app/(auth)/login.tsx',
      'app/../../supabase/functions/x/index.ts',
      'app/(auth)/../(auth)/login.tsx',
    ]) {
      const r = classifyDeployChanges([p]);
      expect(r.decision).toBe('UNKNOWN_BLOCKED');
      expect(r.may_skip_remote_deploy).toBe(false);
    }
  });

  it('T11j SQL content on allowlisted path → UNKNOWN_BLOCKED (rename-onto)', () => {
    expect(frontendAllowlistContentRejected('CREATE TABLE foo (id int);\n')).toBe(true);
    const r = classifyDeployChanges(['app/(auth)/login.tsx'], {
      contentByPath: {
        'app/(auth)/login.tsx': 'CREATE TABLE secrets (token text);\n',
      },
    });
    expect(r.decision).toBe('UNKNOWN_BLOCKED');
    expect(r.matched.other).toContain('app/(auth)/login.tsx');
  });

  it('T11k case mismatch / deploy-looking sibling stays blocked', () => {
    expect(classifyDeployChanges(['App/(auth)/login.tsx']).decision).toBe('UNKNOWN_BLOCKED');
    expect(classifyDeployChanges(['app/(auth)/deploy.ts']).decision).toBe('UNKNOWN_BLOCKED');
    expect(classifyDeployChanges(['components/auth/config.toml']).decision).toBe('UNKNOWN_BLOCKED');
    expect(classifyDeployChanges(['lib/auth/secret.env']).decision).toBe('UNKNOWN_BLOCKED');
  });

  it('T11l lockfile / package.json / workflow / config remain blocked or reviewed', () => {
    expect(classifyDeployChanges(['package-lock.json']).decision).toBe('UNKNOWN_BLOCKED');
    expect(classifyDeployChanges(['package.json']).decision).toBe('UNKNOWN_BLOCKED');
    expect(classifyDeployChanges(['supabase/config.toml']).decision).toBe('REQUIRES_REVIEW');
    expect(classifyDeployChanges(['.github/workflows/deploy-stage.yml']).decision).toBe(
      'BOOTSTRAP_REVIEW',
    );
  });

  it('T11m deletion of allowlisted frontend path (no content) → SAFE_SKIP', () => {
    const r = classifyDeployChanges(['lib/auth/errors.ts'], {
      contentByPath: { 'lib/auth/errors.ts': null },
    });
    expect(r.decision).toBe('SAFE_SKIP');
    expect(r.run_db).toBe(false);
    expect(r.run_functions).toBe(false);
  });

  it('T11n allowlist is exact-set only (count guard against broad expansion)', () => {
    // Guardrail: keep the set intentionally small; bump only with semantic audit.
    // 23 (#42+#43) + 4 (#44) + 9 (#45) + 8 (#50 oauth client) + 4 (email callback token_hash) = 48
    expect(FRONTEND_CLIENT_SAFE_SKIP_EXACT.size).toBe(48);
  });

  it('T11o PR44 calendar UX exact paths → SAFE_SKIP', () => {
    for (const p of PR44_CALENDAR_PATHS) {
      expect(FRONTEND_CLIENT_SAFE_SKIP_EXACT.has(p)).toBe(true);
    }
    const r = classifyDeployChanges([...PR44_CALENDAR_PATHS], {
      contentByPath: Object.fromEntries(PR44_CALENDAR_PATHS.map((p) => [p, 'export const c = 1;\n'])),
    });
    expect(r.decision).toBe('SAFE_SKIP');
    expect(r.run_db).toBe(false);
    expect(r.run_functions).toBe(false);
    expect(r.may_skip_remote_deploy).toBe(true);
    expect(r.matched.other).toEqual([]);
  });

  it('T11p PR45 paywall UX exact paths → SAFE_SKIP (client-only billing helpers)', () => {
    for (const p of PR45_PAYWALL_PATHS) {
      expect(FRONTEND_CLIENT_SAFE_SKIP_EXACT.has(p)).toBe(true);
    }
    const r = classifyDeployChanges([...PR45_PAYWALL_PATHS], {
      contentByPath: Object.fromEntries(PR45_PAYWALL_PATHS.map((p) => [p, 'export const p = 1;\n'])),
    });
    expect(r.decision).toBe('SAFE_SKIP');
    expect(r.run_db).toBe(false);
    expect(r.run_functions).toBe(false);
    expect(r.may_skip_remote_deploy).toBe(true);
  });

  it('T11q no generic lib/billing/** allowlist — sibling stays UNKNOWN', () => {
    expect(classifyDeployChanges(['lib/billing/client.ts']).decision).toBe('UNKNOWN_BLOCKED');
    expect(classifyDeployChanges(['lib/billing/purchases.ts']).decision).toBe('UNKNOWN_BLOCKED');
    expect(classifyDeployChanges(['lib/billing/new-helper.ts']).decision).toBe('UNKNOWN_BLOCKED');
  });

  it('T11q2 PR50 OAuth client exact paths → SAFE_SKIP; lib/oauth sibling stays UNKNOWN', () => {
    for (const p of PR50_OAUTH_CLIENT_PATHS) {
      expect(FRONTEND_CLIENT_SAFE_SKIP_EXACT.has(p)).toBe(true);
    }
    const r = classifyDeployChanges([...PR50_OAUTH_CLIENT_PATHS], {
      contentByPath: Object.fromEntries(PR50_OAUTH_CLIENT_PATHS.map((p) => [p, 'export const o = 1;\n'])),
    });
    expect(r.decision).toBe('SAFE_SKIP');
    expect(r.may_skip_remote_deploy).toBe(true);
    expect(classifyDeployChanges(['lib/oauth-server.ts']).decision).toBe('UNKNOWN_BLOCKED');
    expect(classifyDeployChanges(['app/oauth-admin.tsx']).decision).toBe('UNKNOWN_BLOCKED');
  });

  it('T11q3 PR50 client + migration + functions → DEPLOY_CANDIDATE_BOTH (not UNKNOWN)', () => {
    const paths = [
      ...PR50_OAUTH_CLIENT_PATHS,
      'supabase/migrations/20261001000001_oauth_completion_ticket.sql',
      'supabase/functions/google-oauth/index.ts',
      'supabase/functions/microsoft-oauth/index.ts',
      'supabase/functions/_shared/oauth.ts',
      'scripts/oauth-local/schema.sql',
      'e2e/oauth/lifecycle.playwright.test.ts',
      'wrangler.jsonc',
      '.gitignore',
    ];
    const r = classifyDeployChanges(paths, {
      contentByPath: Object.fromEntries([
        ...PR50_OAUTH_CLIENT_PATHS.map((p) => [p, 'export const o = 1;\n'] as const),
        ['wrangler.jsonc', '{ "name": "both-calendar-sync-stage" }\n'],
        ['.gitignore', 'node_modules/\n'],
        ['scripts/oauth-local/schema.sql', '-- local only\n'],
        ['e2e/oauth/lifecycle.playwright.test.ts', 'export {}\n'],
      ]),
    });
    expect(r.decision).toBe('DEPLOY_CANDIDATE_BOTH');
    expect(r.run_db).toBe(true);
    expect(r.run_functions).toBe(true);
    expect(r.may_skip_remote_deploy).toBe(false);
    expect(r.matched.other).toEqual([]);
  });

  it('T11r Stripe secret / service_role content on allowlisted billing path → UNKNOWN', () => {
    const r = classifyDeployChanges(['lib/billing/paywall-params.ts'], {
      contentByPath: {
        'lib/billing/paywall-params.ts': 'const k = "sk_live_example";\n',
      },
    });
    expect(r.decision).toBe('UNKNOWN_BLOCKED');
    expect(frontendAllowlistContentRejected('whsec_abc')).toBe(true);
    expect(frontendAllowlistContentRejected('service_role')).toBe(true);
  });

  it('T11s mixed calendar safe + unknown billing sibling → UNKNOWN_BLOCKED', () => {
    const r = classifyDeployChanges([
      'app/(app)/(tabs)/calendars.tsx',
      'lib/billing/client.ts',
    ]);
    expect(r.decision).toBe('UNKNOWN_BLOCKED');
    expect(r.may_skip_remote_deploy).toBe(false);
  });

  it('T11t mixed paywall safe + edge function → DEPLOY_CANDIDATE_FUNCTIONS', () => {
    const r = classifyDeployChanges([
      'app/(app)/paywall.tsx',
      'supabase/functions/billing-webhook/index.ts',
    ]);
    expect(r.decision).toBe('DEPLOY_CANDIDATE_FUNCTIONS');
    expect(r.run_functions).toBe(true);
    expect(r.may_skip_remote_deploy).toBe(false);
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
