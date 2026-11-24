/**
 * SYN-05 C0.5 — fail-closed deploy change classifier.
 * Callers supply changed paths; no network.
 *
 * C3-B.4: `.github/workflows/both-stage-watchdog-delivery.yml` may SAFE_SKIP
 * only when path is exact and certified inert content validates (digest+structure).
 *
 * C3-C: `.github/workflows/both-stage-watchdog-recovery.yml` may SAFE_SKIP
 * only when path is exact and certified supervised recovery content validates.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  INERT_DELIVERY_WORKFLOW_PATH,
  validateInertDeliveryWorkflowContent,
} from './inert-delivery-workflow.ts';
import {
  SUPERVISED_RECOVERY_WORKFLOW_PATH,
  validateSupervisedRecoveryWorkflowContent,
} from './supervised-recovery-workflow.ts';

export type DeployDecision =
  | 'SAFE_SKIP'
  | 'DEPLOY_CANDIDATE_DB'
  | 'DEPLOY_CANDIDATE_FUNCTIONS'
  | 'DEPLOY_CANDIDATE_BOTH'
  | 'BOOTSTRAP_REVIEW'
  | 'REQUIRES_REVIEW'
  | 'UNKNOWN_BLOCKED';

export type ClassifyResult = {
  decision: DeployDecision;
  reasons: string[];
  matched: {
    safe_skip: string[];
    migrations: string[];
    functions: string[];
    shared: string[];
    config: string[];
    pipeline: string[];
    other: string[];
  };
  /** Never true unless decision === SAFE_SKIP */
  may_skip_remote_deploy: boolean;
  run_db: boolean;
  run_functions: boolean;
};

export type ClassifyOptions = {
  /** Repo root used to read workflow contents for inert-delivery allowlist. */
  repoRoot?: string;
  /** Optional content map; takes precedence over disk reads. */
  contentByPath?: Record<string, string | null | undefined>;
};

export const SAFE_SKIP_PREFIXES = ['scripts/syn05-watchdog/', 'docs/', 'scripts/deploy-safety/'] as const;

export const SAFE_SKIP_EXACT = new Set([
  '.github/workflows/both-stage-watchdog.yml',
  '.github/workflows/both-stage-watchdog-self.yml',
  'supabase/functions/_shared/observability/alert-evaluator.ts',
  'supabase/functions/_shared/observability/alert-evaluator.test.ts',
  'vitest.config.ts',
  'tsconfig.json',
  'docs/STG-07-SYN-05-C0-5-DEPLOY-SAFETY-INTEGRATION.md',
  'docs/STG-07-SYN-05-C0-5-BOOTSTRAP-SAFETY.md',
  'docs/STG-07-SYN-05-C0-5-PR-MANIFEST.md',
]);

/**
 * Exact client Expo paths proven (semantic audit) to have no Supabase deploy target.
 * NOT a directory allowlist — new siblings stay UNKNOWN_BLOCKED until audited.
 * APPLICATION_SECURITY_REVIEW remains separate from DEPLOY_TARGET_CLASSIFICATION.
 *
 * Proven by PR #42 (auth) + #43 (onboarding) + #44 (calendar UX) + #45 (paywall UX) audits.
 * lib/billing/* entries are client-only helpers (no Edge Function importers); NOT a billing/** prefix.
 */
export const FRONTEND_CLIENT_SAFE_SKIP_EXACT = new Set([
  // PR #42 — auth web
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
  // PR #43 — onboarding
  'app/(onboarding)/index.tsx',
  'lib/calendars/lifecycle.test.ts',
  'lib/calendars/lifecycle.ts',
  'lib/onboarding/calendar-step.test.ts',
  'lib/onboarding/calendar-step.ts',
  'lib/onboarding/journey.test.ts',
  'lib/onboarding/journey.ts',
  // PR #44 — calendar UX (web-safe confirm)
  'app/(app)/(tabs)/calendars.tsx',
  'app/+not-found.tsx',
  'lib/calendars/disconnect-confirm.ts',
  'lib/calendars/disconnect-confirm.test.ts',
  // PR #45 — paywall UX (client entitlement gate + canceled notice)
  'app/(app)/_layout.tsx',
  'app/(app)/paywall.tsx',
  'lib/billing/entitlement-gate.ts',
  'lib/billing/entitlement-gate.test.ts',
  'lib/billing/entitlement.test.ts',
  'lib/billing/paywall-params.ts',
  'lib/billing/paywall-params.test.ts',
  'lib/billing/paywall-scenarios.ts',
  'lib/billing/paywall-scenarios.test.ts',
]);

/** Reject path traversal / absolute / empty segments before any allowlist match. */
export function isUnsafePathShape(path: string): boolean {
  if (!path || path.includes('\0')) return true;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return true;
  if (path.includes('\\')) return true;
  const segments = path.split('/');
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) return true;
  return false;
}

/**
 * Content sniff for exact frontend allowlist only.
 * Blocks rename-onto-allowlisted-path of SQL/config/deploy markers.
 * Missing content (deletion / not on disk) is allowed for path-based SAFE_SKIP.
 */
const FRONTEND_NON_CLIENT_CONTENT =
  /(?:^|\n)\s*(?:CREATE|ALTER|DROP)\s+(?:TABLE|FUNCTION|POLICY|TYPE|INDEX)\b|supabase\s+functions\s+deploy|\bverify_jwt\s*=|\bsk_live_|\bsk_test_|\bwhsec_|\bservice_role\b/i;

export function frontendAllowlistContentRejected(content: string | null | undefined): boolean {
  if (content == null || content === '') return false;
  return FRONTEND_NON_CLIENT_CONTENT.test(content);
}

function normalize(p: string): string {
  return p.replace(/^\.\//, '').replace(/\\/g, '/');
}

function isLegacySafeSkip(path: string): boolean {
  if (SAFE_SKIP_EXACT.has(path)) return true;
  return SAFE_SKIP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isFrontendClientSafeSkip(path: string, options?: ClassifyOptions): boolean {
  if (!FRONTEND_CLIENT_SAFE_SKIP_EXACT.has(path)) return false;
  const content = readPathContent(path, options);
  if (frontendAllowlistContentRejected(content)) return false;
  return true;
}

function isSafeSkip(path: string, options?: ClassifyOptions): boolean {
  if (isLegacySafeSkip(path)) return true;
  return isFrontendClientSafeSkip(path, options);
}

function readPathContent(path: string, options?: ClassifyOptions): string | null {
  if (options?.contentByPath && Object.prototype.hasOwnProperty.call(options.contentByPath, path)) {
    const v = options.contentByPath[path];
    return v == null ? null : v;
  }
  const root = options?.repoRoot ?? process.cwd();
  const abs = join(root, path);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf8');
}

export function classifyDeployChanges(
  changedPaths: string[],
  options?: ClassifyOptions,
): ClassifyResult {
  const paths = [...new Set(changedPaths.map(normalize).filter(Boolean))];
  const matched: ClassifyResult['matched'] = {
    safe_skip: [],
    migrations: [],
    functions: [],
    shared: [],
    config: [],
    pipeline: [],
    other: [],
  };

  const blocked = (decision: DeployDecision, reasons: string[]): ClassifyResult => ({
    decision,
    reasons,
    matched,
    may_skip_remote_deploy: false,
    run_db: false,
    run_functions: false,
  });

  if (paths.length === 0) {
    return blocked('UNKNOWN_BLOCKED', ['empty_changed_paths']);
  }

  let inertDeliverySeen = false;
  let inertDeliveryOk = false;
  let supervisedRecoverySeen = false;
  let supervisedRecoveryOk = false;
  const inertReasons: string[] = [];

  for (const path of paths) {
    // Fail-closed on traversal / absolute / empty segments before any allowlist.
    if (isUnsafePathShape(path)) {
      matched.other.push(path);
      continue;
    }

    // Exact-path allowlist for inert delivery workflow (never by prefix/rename).
    if (path === INERT_DELIVERY_WORKFLOW_PATH) {
      inertDeliverySeen = true;
      const content = readPathContent(path, options);
      if (content == null) {
        inertReasons.push('inert_delivery_file_missing');
        matched.other.push(path);
        continue;
      }
      const v = validateInertDeliveryWorkflowContent(content);
      if (!v.ok) {
        inertReasons.push(...v.reasons);
        matched.other.push(path);
        continue;
      }
      inertDeliveryOk = true;
      matched.safe_skip.push(path);
      continue;
    }

    // Exact-path allowlist for C3-C supervised recovery workflow.
    if (path === SUPERVISED_RECOVERY_WORKFLOW_PATH) {
      supervisedRecoverySeen = true;
      const content = readPathContent(path, options);
      if (content == null) {
        inertReasons.push('supervised_recovery_file_missing');
        matched.other.push(path);
        continue;
      }
      const v = validateSupervisedRecoveryWorkflowContent(content);
      if (!v.ok) {
        inertReasons.push(...v.reasons);
        matched.other.push(path);
        continue;
      }
      supervisedRecoveryOk = true;
      matched.safe_skip.push(path);
      continue;
    }

    // Near-miss names must never inherit the allowlist.
    if (
      path.startsWith('.github/workflows/') &&
      path.includes('watchdog-delivery') &&
      path !== INERT_DELIVERY_WORKFLOW_PATH
    ) {
      matched.other.push(path);
      inertReasons.push('inert_delivery_path_mismatch');
      continue;
    }
    if (
      path.startsWith('.github/workflows/') &&
      path.includes('watchdog-recovery') &&
      path !== SUPERVISED_RECOVERY_WORKFLOW_PATH
    ) {
      matched.other.push(path);
      inertReasons.push('supervised_recovery_path_mismatch');
      continue;
    }

    if (isSafeSkip(path, options)) {
      matched.safe_skip.push(path);
      continue;
    }
    // Exact frontend path with rejected content (e.g. SQL renamed onto allowlist) → other.
    if (FRONTEND_CLIENT_SAFE_SKIP_EXACT.has(path)) {
      matched.other.push(path);
      continue;
    }
    if (
      path === '.github/workflows/deploy-stage.yml' ||
      (path.startsWith('.github/workflows/') &&
        path.includes('deploy') &&
        path !== INERT_DELIVERY_WORKFLOW_PATH &&
        path !== SUPERVISED_RECOVERY_WORKFLOW_PATH)
    ) {
      matched.pipeline.push(path);
      continue;
    }
    if (path.startsWith('supabase/migrations/') && path.endsWith('.sql')) {
      matched.migrations.push(path);
      continue;
    }
    if (path === 'supabase/config.toml') {
      matched.config.push(path);
      continue;
    }
    if (path.startsWith('supabase/functions/_shared/')) {
      matched.shared.push(path);
      matched.functions.push(path);
      continue;
    }
    if (path.startsWith('supabase/functions/')) {
      matched.functions.push(path);
      continue;
    }
    matched.other.push(path);
  }

  if (matched.other.length) {
    return blocked('UNKNOWN_BLOCKED', [
      'unclassified_paths',
      ...matched.other.slice(0, 5),
      ...inertReasons.slice(0, 5),
    ]);
  }
  if (matched.pipeline.length) {
    // Certified workflow YAML must not land beside deploy-stage / other pipeline edits.
    if (inertDeliverySeen) {
      return blocked('UNKNOWN_BLOCKED', ['inert_delivery_workflow_mixed_changeset', 'pipeline_workflow_changed']);
    }
    if (supervisedRecoverySeen) {
      return blocked('UNKNOWN_BLOCKED', [
        'supervised_recovery_workflow_mixed_changeset',
        'pipeline_workflow_changed',
      ]);
    }
    return blocked('BOOTSTRAP_REVIEW', ['pipeline_workflow_changed']);
  }
  if (matched.config.length && !matched.migrations.length && !matched.functions.length) {
    if (inertDeliverySeen) {
      return blocked('UNKNOWN_BLOCKED', ['inert_delivery_workflow_mixed_changeset', 'supabase_config_changed']);
    }
    if (supervisedRecoverySeen) {
      return blocked('UNKNOWN_BLOCKED', [
        'supervised_recovery_workflow_mixed_changeset',
        'supabase_config_changed',
      ]);
    }
    return blocked('REQUIRES_REVIEW', ['supabase_config_changed']);
  }

  const db = matched.migrations.length > 0;
  const fn = matched.functions.length > 0 || matched.config.length > 0;

  if (inertDeliverySeen && (db || fn)) {
    return blocked('UNKNOWN_BLOCKED', ['inert_delivery_workflow_mixed_changeset']);
  }
  if (supervisedRecoverySeen && (db || fn)) {
    return blocked('UNKNOWN_BLOCKED', ['supervised_recovery_workflow_mixed_changeset']);
  }

  if (!db && !fn) {
    const reasons = ['only_safe_skip_paths'];
    if (inertDeliveryOk) reasons.push('inert_delivery_workflow_certified');
    if (supervisedRecoveryOk) reasons.push('supervised_recovery_workflow_certified');
    return {
      decision: 'SAFE_SKIP',
      reasons,
      matched,
      may_skip_remote_deploy: true,
      run_db: false,
      run_functions: false,
    };
  }

  if (db && fn) {
    return {
      decision: 'DEPLOY_CANDIDATE_BOTH',
      reasons: ['migrations_and_functions'],
      matched,
      may_skip_remote_deploy: false,
      run_db: true,
      run_functions: true,
    };
  }
  if (db) {
    return {
      decision: 'DEPLOY_CANDIDATE_DB',
      reasons: ['migrations_changed'],
      matched,
      may_skip_remote_deploy: false,
      run_db: true,
      run_functions: false,
    };
  }
  return {
    decision: 'DEPLOY_CANDIDATE_FUNCTIONS',
    reasons: ['functions_or_shared_or_config'],
    matched,
    may_skip_remote_deploy: false,
    run_db: false,
    run_functions: true,
  };
}

/** SEC-07: refuse functions republish if sync-calendar is not tombstone. */
export function assertSec07TombstonePresent(repoRoot: string): { ok: boolean; reason: string } {
  const indexPath = `${repoRoot}/supabase/functions/sync-calendar/index.ts`;
  const configPath = `${repoRoot}/supabase/config.toml`;
  if (!existsSync(indexPath)) {
    return { ok: false, reason: 'sync_calendar_index_missing' };
  }
  const index = readFileSync(indexPath, 'utf8');
  const hasTombstone =
    /handleLegacySyncCalendar/.test(index) ||
    /410 Gone/.test(index) ||
    /SEC-07/.test(index);
  if (!hasTombstone) {
    return { ok: false, reason: 'sync_calendar_not_tombstone_legacy_code' };
  }
  if (!existsSync(configPath)) {
    return { ok: false, reason: 'config_toml_missing' };
  }
  const cfg = readFileSync(configPath, 'utf8');
  // Require verify_jwt = true in sync-calendar section
  const section = cfg.split('[functions.sync-calendar]')[1]?.split('[functions.')[0] ?? '';
  if (!/verify_jwt\s*=\s*true/.test(section)) {
    return { ok: false, reason: 'sync_calendar_verify_jwt_not_true' };
  }
  return { ok: true, reason: 'sec07_tombstone_ok' };
}

const isMain =
  !!process.argv[1] &&
  (process.argv[1].endsWith('/classify-deploy-changes.ts') ||
    process.argv[1].endsWith('\\classify-deploy-changes.ts'));

if (isMain) {
  const mode = process.argv[2];
  if (mode === '--sec07-check') {
    const root = process.argv[3] ?? process.cwd();
    const r = assertSec07TombstonePresent(root);
    console.log(JSON.stringify(r));
    if (!r.ok) process.exitCode = 3;
  } else {
    const arg = process.argv[2];
    if (!arg) {
      console.error('usage: classify-deploy-changes.ts <paths-file> | --sec07-check [repoRoot]');
      process.exitCode = 2;
    } else {
      const raw = readFileSync(arg, 'utf8');
      const paths = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      const result = classifyDeployChanges(paths, { repoRoot: process.cwd() });
      console.log(JSON.stringify(result, null, 2));
      if (result.decision === 'UNKNOWN_BLOCKED' || result.decision === 'BOOTSTRAP_REVIEW' || result.decision === 'REQUIRES_REVIEW') {
        process.exitCode = 2;
      }
    }
  }
}
