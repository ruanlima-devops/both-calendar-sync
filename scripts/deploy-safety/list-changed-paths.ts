/**
 * SYN-05 C0.5 — list changed paths between base..head via local git.
 * Fail-closed: empty/error → exit 2 and write marker for workflow.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type ListResult = {
  ok: boolean;
  paths: string[];
  reason: string;
  base: string;
  head: string;
};

export function listChangedPaths(base: string, head: string, cwd = process.cwd()): ListResult {
  if (!base || !head) {
    return { ok: false, paths: [], reason: 'missing_base_or_head', base, head };
  }
  if (base === head) {
    return { ok: false, paths: [], reason: 'base_equals_head', base, head };
  }
  try {
    const out = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${base}...${head}`],
      { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    const paths = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (paths.length === 0) {
      return { ok: false, paths: [], reason: 'empty_diff', base, head };
    }
    return { ok: true, paths, reason: 'ok', base, head };
  } catch (e) {
    return {
      ok: false,
      paths: [],
      reason: `git_diff_failed:${e instanceof Error ? e.message : String(e)}`,
      base,
      head,
    };
  }
}

const isMain =
  !!process.argv[1] &&
  (process.argv[1].endsWith('/list-changed-paths.ts') ||
    process.argv[1].endsWith('\\list-changed-paths.ts'));

if (isMain) {
  const base = process.env.DEPLOY_BASE_SHA ?? process.argv[2];
  const head = process.env.DEPLOY_HEAD_SHA ?? process.argv[3];
  const outFile = process.env.DEPLOY_PATHS_FILE ?? process.argv[4] ?? 'deploy-changed-paths.txt';
  const result = listChangedPaths(base ?? '', head ?? '');
  mkdirSync(dirname(outFile) || '.', { recursive: true });
  if (!result.ok) {
    writeFileSync(outFile, `# ERROR ${result.reason}\n`);
    console.error(JSON.stringify(result));
    process.exitCode = 2;
  } else {
    writeFileSync(outFile, result.paths.join('\n') + '\n');
    console.log(JSON.stringify({ ok: true, count: result.paths.length, base, head }));
  }
}
