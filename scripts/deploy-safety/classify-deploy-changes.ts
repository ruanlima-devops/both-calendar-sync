/**
 * SYN-05 C0.5 — fail-closed deploy change classifier.
 * Callers supply changed paths; no network.
 */

import { readFileSync, existsSync } from 'node:fs';

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

function normalize(p: string): string {
  return p.replace(/^\.\//, '').replace(/\\/g, '/');
}

function isSafeSkip(path: string): boolean {
  if (SAFE_SKIP_EXACT.has(path)) return true;
  return SAFE_SKIP_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function classifyDeployChanges(changedPaths: string[]): ClassifyResult {
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

  for (const path of paths) {
    if (isSafeSkip(path)) {
      matched.safe_skip.push(path);
      continue;
    }
    if (path === '.github/workflows/deploy-stage.yml' || (path.startsWith('.github/workflows/') && path.includes('deploy'))) {
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
    return blocked('UNKNOWN_BLOCKED', ['unclassified_paths', ...matched.other.slice(0, 5)]);
  }
  if (matched.pipeline.length) {
    return blocked('BOOTSTRAP_REVIEW', ['pipeline_workflow_changed']);
  }
  if (matched.config.length && !matched.migrations.length && !matched.functions.length) {
    return blocked('REQUIRES_REVIEW', ['supabase_config_changed']);
  }

  const db = matched.migrations.length > 0;
  const fn = matched.functions.length > 0 || matched.config.length > 0;

  if (!db && !fn) {
    return {
      decision: 'SAFE_SKIP',
      reasons: ['only_safe_skip_paths'],
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
      const result = classifyDeployChanges(paths);
      console.log(JSON.stringify(result, null, 2));
      if (result.decision === 'UNKNOWN_BLOCKED' || result.decision === 'BOOTSTRAP_REVIEW' || result.decision === 'REQUIRES_REVIEW') {
        process.exitCode = 2;
      }
    }
  }
}
