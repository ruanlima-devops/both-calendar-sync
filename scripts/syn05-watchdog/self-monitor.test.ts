import { describe, expect, it } from 'vitest';
import { evaluateWatchdogHeartbeat, SELF_MONITOR_ARCHITECTURE } from './self-monitor.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NOW = Date.parse('2026-11-18T18:00:00.000Z');
const here = path.dirname(fileURLToPath(import.meta.url));

describe('self-monitor', () => {
  it('fires when heartbeat missing or stale', () => {
    const missing = evaluateWatchdogHeartbeat({
      last_success_at: null,
      expected_interval_ms: 10 * 60_000,
      grace_ms: 5 * 60_000,
      now_ms: NOW,
    });
    expect(missing.evaluation_status).toBe('FIRING');

    const stale = evaluateWatchdogHeartbeat({
      last_success_at: new Date(NOW - 30 * 60_000).toISOString(),
      expected_interval_ms: 10 * 60_000,
      grace_ms: 5 * 60_000,
      now_ms: NOW,
    });
    expect(stale.evaluation_status).toBe('FIRING');
  });

  it('healthy within interval+grace (scheduler delay tolerant)', () => {
    const ok = evaluateWatchdogHeartbeat({
      last_success_at: new Date(NOW - 12 * 60_000).toISOString(),
      expected_interval_ms: 10 * 60_000,
      grace_ms: 5 * 60_000,
      now_ms: NOW,
    });
    expect(ok.evaluation_status).toBe('HEALTHY');
  });

  it('documents that same-workflow job is insufficient independence', () => {
    expect(SELF_MONITOR_ARCHITECTURE.insufficient).toBe('same_workflow_second_job');
    expect(SELF_MONITOR_ARCHITECTURE.recommended_mvp).toContain('separate_workflow');
  });
});

describe('workflow local artifacts', () => {
  const root = path.resolve(here, '../..');

  it('watchdog workflow is dry-run, schedule commented, no secrets hardcoded', () => {
    const yml = readFileSync(path.join(root, '.github/workflows/both-stage-watchdog.yml'), 'utf8');
    expect(yml).toContain('BOTH_WATCHDOG_DRY_RUN: \'1\'');
    expect(yml).toContain('BOTH_WATCHDOG_GITHUB_WRITE: \'0\'');
    expect(yml).toContain('BOTH_WATCHDOG_ENABLE_NETWORK: \'0\'');
    expect(yml).toMatch(/#\s*schedule:/);
    expect(yml).not.toMatch(/^\s*inputs:/m);
    // Active permission must not grant issues write (comments mentioning it are OK).
    expect(yml).not.toMatch(/^\s*issues:\s*write\s*$/m);
    expect(yml).toContain('permissions:');
    expect(yml).toContain('contents: read');
    expect(yml).toContain('concurrency:');
    expect(yml).not.toMatch(/sk_live|ghp_|github_pat_|eyJhbGci/);
    expect(yml).not.toMatch(/supabase functions deploy|db push|stripe/i);
  });

  it('self-monitor workflow is separate file with schedule commented', () => {
    const yml = readFileSync(path.join(root, '.github/workflows/both-stage-watchdog-self.yml'), 'utf8');
    expect(yml).toMatch(/#\s*schedule:/);
    expect(yml).toContain('both-stage-watchdog-self');
    expect(yml).not.toMatch(/^\s*issues:\s*write\s*$/m);
  });
});
