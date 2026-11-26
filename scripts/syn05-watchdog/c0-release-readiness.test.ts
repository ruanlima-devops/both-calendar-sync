/**
 * C0 release-readiness static invariants — no network, no remotes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGE_PROJECT_REF } from './types.ts';
import { isGithubWriteEnabled } from './github-issues.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const primary = path.join(root, '.github/workflows/both-stage-watchdog.yml');
const selfYml = path.join(root, '.github/workflows/both-stage-watchdog-self.yml');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
  engines?: { node?: string };
};

function load(p: string): string {
  return readFileSync(p, 'utf8');
}

function activeTriggers(yml: string): string[] {
  const onIdx = yml.search(/^\s*on:\s*$/m);
  if (onIdx < 0) return [];
  const rest = yml.slice(onIdx);
  const end = rest.search(/^\s*(permissions|concurrency|env|jobs):/m);
  const block = end > 0 ? rest.slice(0, end) : rest;
  const triggers: string[] = [];
  for (const key of [
    'schedule',
    'push',
    'pull_request',
    'pull_request_target',
    'workflow_call',
    'workflow_run',
    'repository_dispatch',
    'workflow_dispatch',
  ]) {
    // Active (non-comment) line under on:
    const re = new RegExp(`^\\s*${key}\\s*:`, 'm');
    const lines = block.split('\n');
    for (const line of lines) {
      if (line.trimStart().startsWith('#')) continue;
      if (re.test(line)) triggers.push(key);
    }
  }
  return triggers;
}

function hasActivePermission(yml: string, key: string, value: string): boolean {
  return new RegExp(`^\\s*${key}\\s*:\\s*${value}\\s*$`, 'm').test(yml);
}

describe('C0 YAML release readiness — primary watchdog', () => {
  const yml = load(primary);

  it('file exists and parses as non-empty YAML-ish structure', () => {
    expect(existsSync(primary)).toBe(true);
    expect(yml).toContain('name:');
    expect(yml).toContain('on:');
    expect(yml).toContain('jobs:');
    expect(yml).toContain('steps:');
  });

  it('dry-run default ON and write/network forced OFF', () => {
    expect(yml).toContain("BOTH_WATCHDOG_DRY_RUN: '1'");
    expect(yml).toContain("BOTH_WATCHDOG_GITHUB_WRITE: '0'");
    expect(yml).toContain("BOTH_WATCHDOG_ENABLE_NETWORK: '0'");
  });

  it('schedule inactive; only workflow_dispatch trigger', () => {
    expect(yml).toMatch(/#\s*schedule:/);
    const triggers = activeTriggers(yml);
    expect(triggers).toEqual(['workflow_dispatch']);
  });

  it('permissions: contents read only; no dangerous writes', () => {
    expect(yml).toContain('contents: read');
    expect(hasActivePermission(yml, 'issues', 'write')).toBe(false);
    expect(hasActivePermission(yml, 'actions', 'write')).toBe(false);
    expect(hasActivePermission(yml, 'deployments', 'write')).toBe(false);
    expect(hasActivePermission(yml, 'id-token', 'write')).toBe(false);
    expect(hasActivePermission(yml, 'security-events', 'write')).toBe(false);
    expect(hasActivePermission(yml, 'packages', 'write')).toBe(false);
  });

  it('no secrets hardcoded / no deploy / stripe / sql / live target', () => {
    expect(yml).not.toMatch(/sk_live|ghp_|github_pat_|eyJ[A-Za-z0-9_-]+\.|whsec_|sbp_/);
    expect(yml).not.toMatch(/supabase functions deploy|db push|stripe/i);
    expect(yml).not.toMatch(/^\s*environment:\s*production\s*$/m);
    expect(yml).not.toMatch(/SELECT\s+.+\s+FROM/i);
  });

  it('workflow_dispatch has no bypass inputs', () => {
    expect(yml).not.toMatch(/^\s*inputs:/m);
    // After `workflow_dispatch:` there should be no `inputs:` before permissions
    const m = yml.match(/workflow_dispatch:\n([\s\S]*?)\npermissions:/);
    const between = (m?.[1] ?? '')
      .split('\n')
      .filter((l) => l.trim() && !l.trimStart().startsWith('#'))
      .join('\n');
    expect(between).toBe('');
  });

  it('STAGE ref fixed; concurrency; timeout; npm ci; node 24', () => {
    expect(yml).toContain(`STAGE_PROJECT_REF: ${STAGE_PROJECT_REF}`);
    expect(yml).toContain('concurrency:');
    expect(yml).toContain('both-stage-watchdog-qszggrrjhcwltnmxpxcy');
    expect(yml).toContain('timeout-minutes: 10');
    expect(yml).toContain('npm ci');
    expect(yml).toContain('node-version: 24');
    expect(yml).toContain('runs-on: ubuntu-latest');
  });

  it('pins actions/checkout and setup-node to verified full SHAs', () => {
    expect(yml).toContain('actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
    expect(yml).toContain('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1');
    expect(yml).not.toMatch(/uses:\s*actions\/checkout@v\d/);
    expect(yml).not.toMatch(/uses:\s*actions\/setup-node@v\d/);
  });

  it('reachable scripts are local watchdog paths only', () => {
    expect(yml).toContain('scripts/syn05-watchdog');
    expect(yml).toContain('scripts/syn05-watchdog/run.ts');
    expect(yml).not.toMatch(/curl |wget |npx supabase/i);
  });
});

describe('C0 YAML release readiness — self-monitor', () => {
  const yml = load(selfYml);

  it('separate workflow; schedule inactive; dispatch only', () => {
    expect(existsSync(selfYml)).toBe(true);
    expect(yml).toContain('both-stage-watchdog-self');
    expect(activeTriggers(yml)).toEqual(['workflow_dispatch']);
    expect(hasActivePermission(yml, 'issues', 'write')).toBe(false);
    expect(yml).toContain('contents: read');
    expect(yml).toContain('actions: read');
  });

  it('dry-run flags and STAGE only; no write surface', () => {
    expect(yml).toContain("BOTH_WATCHDOG_DRY_RUN: '1'");
    expect(yml).toContain("BOTH_WATCHDOG_GITHUB_WRITE: '0'");
    expect(yml).toContain("BOTH_WATCHDOG_ENABLE_NETWORK: '0'");
    expect(yml).toContain(`STAGE_PROJECT_REF: ${STAGE_PROJECT_REF}`);
    expect(yml).not.toMatch(/sk_live|ghp_|github_pat_/);
    expect(yml).not.toMatch(/supabase functions deploy|stripe/i);
  });

  it('pins actions to verified SHAs', () => {
    expect(yml).toContain('actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803');
    expect(yml).toContain('actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1');
  });
});

describe('C0 runtime flags without credentials', () => {
  it('write remains disabled when env unset or misconfigured', () => {
    expect(isGithubWriteEnabled({})).toBe(false);
    expect(isGithubWriteEnabled({ BOTH_WATCHDOG_GITHUB_WRITE: '1', BOTH_WATCHDOG_DRY_RUN: '1' })).toBe(
      false,
    );
    expect(isGithubWriteEnabled({ BOTH_WATCHDOG_GITHUB_WRITE: 'true' })).toBe(false);
    expect(isGithubWriteEnabled({ BOTH_WATCHDOG_GITHUB_WRITE: '1' })).toBe(true); // only when dry-run not forced 1
  });

  it('package test script is vitest; lockfile present for npm ci', () => {
    expect(packageJson.scripts.test).toBe('vitest run');
    expect(existsSync(path.join(root, 'package-lock.json'))).toBe(true);
  });

  it('no pull_request trigger on watchdog files (fork isolation)', () => {
    for (const f of [primary, selfYml]) {
      expect(activeTriggers(load(f))).not.toContain('pull_request');
      expect(activeTriggers(load(f))).not.toContain('pull_request_target');
    }
  });
});
