/**
 * OF-04 quota/cost policy — offline formulas and budget guard.
 */

import { describe, expect, it } from 'vitest';
import {
  CANARY_PLAN,
  DEFAULT_CADENCE,
  DEFAULT_UNIT_PRICES,
  computeCostModel,
  evaluateBudgetGuard,
  runsPerDay,
} from './quota-cost-policy.ts';

describe('OF-04 formulas', () => {
  it('runs/day = 1440 / interval', () => {
    expect(runsPerDay(10)).toBe(144);
    expect(runsPerDay(60)).toBe(24);
  });

  it('rejects invalid interval', () => {
    expect(() => runsPerDay(0)).toThrow(/interval_invalid/);
  });

  it('cost model marks UNKNOWN_PRICE by default', () => {
    const m = computeCostModel();
    expect(m.runs_per_day_watchdog).toBe(144);
    expect(m.runs_per_day_observer).toBe(144);
    expect(m.monthly_cost_usd).toBe('UNKNOWN_PRICE');
    expect(m.cost_components.external_observer).toBe('UNKNOWN_PRICE');
    expect(DEFAULT_UNIT_PRICES.external_observer_monthly_usd).toBe('UNKNOWN_PRICE');
  });

  it('computes numeric cost when prices proven', () => {
    const m = computeCostModel(DEFAULT_CADENCE, {
      github_actions_minute_usd: 0.008,
      supabase_logs_api_per_1k_usd: 0.01,
      external_observer_monthly_usd: 5,
      notification_provider_monthly_usd: 0,
      evidence_retention_gb_month_usd: 0,
    });
    expect(typeof m.monthly_cost_usd).toBe('number');
    expect(m.monthly_cost_usd).toBeGreaterThan(0);
  });

  it('observer cost not implicitly zero in defaults', () => {
    expect(DEFAULT_UNIT_PRICES.external_observer_monthly_usd).not.toBe(0);
  });
});

describe('OF-04 budget guard', () => {
  it('COST_UNKNOWN when prices unknown and usage ok', () => {
    const r = evaluateBudgetGuard({
      usage: { runner_minutes_month: 100, api_requests_day: 100, alerts_in_window: 0 },
    });
    expect(r.verdict).toBe('COST_UNKNOWN');
  });

  it('HARD_STOP on runner minutes', () => {
    const r = evaluateBudgetGuard({
      usage: { runner_minutes_month: 99999, api_requests_day: 1, alerts_in_window: 0 },
    });
    expect(r.verdict).toBe('HARD_STOP');
    expect(r.fail_closed).toBe(true);
  });

  it('QUOTA_EXCEEDED on api requests', () => {
    const r = evaluateBudgetGuard({
      usage: { runner_minutes_month: 1, api_requests_day: 99999, alerts_in_window: 0 },
    });
    expect(r.verdict).toBe('QUOTA_EXCEEDED');
  });

  it('QUOTA_EXCEEDED on alerts', () => {
    const r = evaluateBudgetGuard({
      usage: { runner_minutes_month: 1, api_requests_day: 1, alerts_in_window: 99 },
    });
    expect(r.verdict).toBe('QUOTA_EXCEEDED');
    expect(r.reason_code).toBe('alerts_quota_exceeded');
  });

  it('WARNING near threshold with known prices', () => {
    const r = evaluateBudgetGuard({
      prices: {
        github_actions_minute_usd: 0.008,
        supabase_logs_api_per_1k_usd: 0.01,
        external_observer_monthly_usd: 5,
        notification_provider_monthly_usd: 1,
        evidence_retention_gb_month_usd: 1,
      },
      limits: {
        max_runner_minutes_per_month: 1000,
        max_api_requests_per_day: 1000,
        max_alerts_per_window: 5,
        warning_ratio: 0.8,
      },
      usage: { runner_minutes_month: 850, api_requests_day: 10, alerts_in_window: 0 },
    });
    expect(r.verdict).toBe('WARNING');
  });

  it('OK within budget with known prices', () => {
    const r = evaluateBudgetGuard({
      prices: {
        github_actions_minute_usd: 0.008,
        supabase_logs_api_per_1k_usd: 0.01,
        external_observer_monthly_usd: 5,
        notification_provider_monthly_usd: 1,
        evidence_retention_gb_month_usd: 1,
      },
      usage: { runner_minutes_month: 10, api_requests_day: 10, alerts_in_window: 0 },
    });
    expect(r.verdict).toBe('OK');
  });
});

describe('OF-04 canary plan', () => {
  it('only CANARY_0 executed now', () => {
    expect(CANARY_PLAN.CANARY_0.executed_now).toBe(true);
    expect(CANARY_PLAN.CANARY_1.executed_now).toBe(false);
    expect(CANARY_PLAN.CANARY_2.executed_now).toBe(false);
    expect(CANARY_PLAN.CANARY_3.executed_now).toBe(false);
    expect(CANARY_PLAN.CANARY_4.executed_now).toBe(false);
    expect(CANARY_PLAN.CANARY_5.executed_now).toBe(false);
  });
});
