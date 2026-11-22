import { describe, expect, it } from 'vitest';
import {
  COLLECTOR_SECRET_OPTIONS,
  CURRENT_COLLECTOR_GATE,
  assertNoLiveCollectorMutation,
  evaluateCollectorGoNoGo,
} from './collector-secret-policy.ts';

describe('SYN-05 collector secret policy', () => {
  it('current gate is NO-GO while storage blocked and PAT absent', () => {
    const result = evaluateCollectorGoNoGo(CURRENT_COLLECTOR_GATE);
    expect(result.decision).toBe('NO-GO');
    expect(result.blockers.some((b) => b.includes('COLLECTOR_SECRET_STORAGE'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('PAT not issued'))).toBe(true);
  });

  it('keeps mutation intents refuse-closed', () => {
    const refused = assertNoLiveCollectorMutation({
      emitPat: true,
      createEnvironment: true,
      unpauseBetterStack: true,
      enableCron: true,
      callLogsApi: true,
    });
    expect(refused.allowed).toBe(false);
    expect(refused.refused).toEqual([
      'emit_pat',
      'create_environment',
      'unpause_better_stack',
      'enable_cron',
      'call_logs_api',
    ]);
  });

  it('documents comparative options including keep-blocked default', () => {
    expect(COLLECTOR_SECRET_OPTIONS.map((o) => o.id)).toContain('D_keep_blocked');
    expect(COLLECTOR_SECRET_OPTIONS.map((o) => o.id)).toContain('A_github_environment_job_isolation');
  });

  it('would still residual-risk even if storage unblocked without remote toggles', () => {
    const result = evaluateCollectorGoNoGo({
      ...CURRENT_COLLECTOR_GATE,
      collectorSecretStorage: 'GITHUB_ENVIRONMENT_CANDIDATE',
      supabasePatIssued: true,
    });
    expect(result.decision).toBe('CONDITIONAL');
    expect(result.residualRisks.length).toBeGreaterThan(0);
  });
});
