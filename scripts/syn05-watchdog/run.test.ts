import { afterEach, describe, expect, it } from 'vitest';
import { DryRunGithubIssues, MemoryGithubIssues, isGithubWriteEnabled } from './github-issues.ts';
import { runWatchdogOnce } from './run.ts';
import type { NormalizedSignal } from './types.ts';

const NOW = Date.parse('2026-11-18T18:00:00.000Z');

describe('runWatchdogOnce', () => {
  afterEach(() => {
    delete process.env.BOTH_WATCHDOG_GITHUB_WRITE;
    delete process.env.BOTH_WATCHDOG_DRY_RUN;
    delete process.env.BOTH_WATCHDOG_ENABLE_NETWORK;
  });

  it('defaults to dry-run without network', async () => {
    const signals: NormalizedSignal[] = [
      {
        kind: 'edge_http',
        timestamp: new Date(NOW - 60_000).toISOString(),
        status: 200,
        functionName: 'reconcile-sync',
        method: 'POST',
      },
    ];
    const r = await runWatchdogOnce({
      nowMs: NOW,
      injectedSignals: signals,
      dataAvailable: true,
    });
    expect(r.dry_run).toBe(true);
    expect(r.project_ref).toBe('qszggrrjhcwltnmxpxcy');
    expect(r.evaluations).toHaveLength(3);
  });

  it('refuses when github write opt-in is set', async () => {
    process.env.BOTH_WATCHDOG_GITHUB_WRITE = '1';
    process.env.BOTH_WATCHDOG_DRY_RUN = '0';
    expect(isGithubWriteEnabled()).toBe(true);
    await expect(runWatchdogOnce({ injectedSignals: [], dataAvailable: true })).rejects.toThrow(
      /github_write_forbidden/,
    );
  });

  it('concurrent reconciles do not double-create under shared memory store', async () => {
    const mem = new MemoryGithubIssues();
    const a = new DryRunGithubIssues(mem);
    const b = new DryRunGithubIssues(mem);
    const fire: NormalizedSignal[] = [1, 2, 3].map((i) => ({
      kind: 'edge_http' as const,
      timestamp: new Date(NOW - i * 30_000).toISOString(),
      status: 500,
      functionName: 'billing-webhook',
      method: 'POST',
    }));
    fire.push({
      kind: 'edge_http',
      timestamp: new Date(NOW - 60_000).toISOString(),
      status: 200,
      functionName: 'reconcile-sync',
      method: 'POST',
    });
    // Sequential under shared store (workflow concurrency cancel-in-progress:false + group)
    await runWatchdogOnce({ nowMs: NOW, injectedSignals: fire, dataAvailable: true, issues: a });
    await runWatchdogOnce({ nowMs: NOW, injectedSignals: fire, dataAvailable: true, issues: b });
    const open = await mem.listBotIncidents('open');
    const fps = open.map((i) => i.fingerprint);
    expect(new Set(fps).size).toBe(fps.length);
  });
});
