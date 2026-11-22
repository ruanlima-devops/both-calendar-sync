/**
 * OF-04 — Quota / Cost Policy (offline model + budget guard).
 *
 * Does not invent tariffs. Unknown prices → UNKNOWN_PRICE.
 * No external calls for metering.
 */

export const QUOTA_POLICY_SCHEMA = 'both-syn05-quota-cost-policy:v1' as const;

export type PriceTag = number | 'UNKNOWN_PRICE';

export type CadenceAssumptions = {
  watchdog_interval_minutes: number;
  observer_interval_minutes: number;
  mean_duration_minutes: number;
  p95_duration_minutes: number;
  timeout_minutes: number;
  api_requests_per_watchdog_cycle: number;
  api_requests_per_observer_cycle: number;
  artifact_retention_days: number;
  max_alerts_per_window: number;
  alert_window_hours: number;
  max_github_issues_new_per_day: number;
  max_reopen_close_per_day: number;
  max_network_attempts_per_cycle: number;
  backoff_base_ms: number;
  retry_reserve_factor: number;
};

export const DEFAULT_CADENCE: CadenceAssumptions = {
  watchdog_interval_minutes: 10,
  observer_interval_minutes: 10,
  mean_duration_minutes: 2,
  p95_duration_minutes: 5,
  timeout_minutes: 10,
  api_requests_per_watchdog_cycle: 6,
  api_requests_per_observer_cycle: 2,
  artifact_retention_days: 14,
  max_alerts_per_window: 5,
  alert_window_hours: 1,
  max_github_issues_new_per_day: 1,
  max_reopen_close_per_day: 4,
  max_network_attempts_per_cycle: 3,
  backoff_base_ms: 500,
  retry_reserve_factor: 1.25,
};

export type UnitPrices = {
  /** GitHub Actions linux minute — leave UNKNOWN unless proven */
  github_actions_minute_usd: PriceTag;
  supabase_logs_api_per_1k_usd: PriceTag;
  external_observer_monthly_usd: PriceTag;
  notification_provider_monthly_usd: PriceTag;
  evidence_retention_gb_month_usd: PriceTag;
};

export const DEFAULT_UNIT_PRICES: UnitPrices = {
  github_actions_minute_usd: 'UNKNOWN_PRICE',
  supabase_logs_api_per_1k_usd: 'UNKNOWN_PRICE',
  external_observer_monthly_usd: 'UNKNOWN_PRICE',
  notification_provider_monthly_usd: 'UNKNOWN_PRICE',
  evidence_retention_gb_month_usd: 'UNKNOWN_PRICE',
};

export type QuotaLimits = {
  max_runner_minutes_per_month: number;
  max_api_requests_per_day: number;
  max_alerts_per_window: number;
  warning_ratio: number;
};

export const DEFAULT_QUOTA_LIMITS: QuotaLimits = {
  max_runner_minutes_per_month: 3_000,
  max_api_requests_per_day: 5_000,
  max_alerts_per_window: 5,
  warning_ratio: 0.8,
};

export type CostModelResult = {
  schema_version: typeof QUOTA_POLICY_SCHEMA;
  runs_per_day_watchdog: number;
  runs_per_day_observer: number;
  runner_minutes_month_watchdog: number;
  runner_minutes_month_observer: number;
  runner_minutes_month_total_with_reserve: number;
  api_requests_per_day: number;
  monthly_cost_usd: PriceTag;
  cost_components: Record<string, PriceTag>;
  notes: string[];
};

export function runsPerDay(intervalMinutes: number): number {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    throw new Error('interval_invalid');
  }
  return 1440 / intervalMinutes;
}

export function computeCostModel(
  cadence: CadenceAssumptions = DEFAULT_CADENCE,
  prices: UnitPrices = DEFAULT_UNIT_PRICES,
): CostModelResult {
  const runs_per_day_watchdog = runsPerDay(cadence.watchdog_interval_minutes);
  const runs_per_day_observer = runsPerDay(cadence.observer_interval_minutes);

  const runner_minutes_month_watchdog =
    runs_per_day_watchdog * 30 * cadence.mean_duration_minutes;
  const runner_minutes_month_observer =
    runs_per_day_observer * 30 * cadence.mean_duration_minutes;
  const runner_minutes_month_total_with_reserve =
    (runner_minutes_month_watchdog + runner_minutes_month_observer) *
    cadence.retry_reserve_factor;

  const api_requests_per_day =
    runs_per_day_watchdog * cadence.api_requests_per_watchdog_cycle +
    runs_per_day_observer * cadence.api_requests_per_observer_cycle;

  const notes: string[] = [
    'Formulas only; prices not invented.',
    'External observer cost must not be treated as zero.',
  ];

  const cost_components: Record<string, PriceTag> = {
    github_actions:
      prices.github_actions_minute_usd === 'UNKNOWN_PRICE'
        ? 'UNKNOWN_PRICE'
        : prices.github_actions_minute_usd * runner_minutes_month_total_with_reserve,
    supabase_logs:
      prices.supabase_logs_api_per_1k_usd === 'UNKNOWN_PRICE'
        ? 'UNKNOWN_PRICE'
        : prices.supabase_logs_api_per_1k_usd * ((api_requests_per_day * 30) / 1000),
    external_observer: prices.external_observer_monthly_usd,
    notification: prices.notification_provider_monthly_usd,
    evidence_retention: prices.evidence_retention_gb_month_usd,
  };

  const numeric = Object.values(cost_components).filter((v): v is number => typeof v === 'number');
  const hasUnknown = Object.values(cost_components).some((v) => v === 'UNKNOWN_PRICE');
  const monthly_cost_usd: PriceTag = hasUnknown
    ? 'UNKNOWN_PRICE'
    : numeric.reduce((a, b) => a + b, 0);

  if (hasUnknown) notes.push('monthly_cost_usd=UNKNOWN_PRICE until unit prices proven');

  return {
    schema_version: QUOTA_POLICY_SCHEMA,
    runs_per_day_watchdog,
    runs_per_day_observer,
    runner_minutes_month_watchdog,
    runner_minutes_month_observer,
    runner_minutes_month_total_with_reserve,
    api_requests_per_day,
    monthly_cost_usd,
    cost_components,
    notes,
  };
}

export type BudgetVerdict =
  | 'OK'
  | 'WARNING'
  | 'QUOTA_EXCEEDED'
  | 'HARD_STOP'
  | 'COST_UNKNOWN'
  | 'CONFIG_INVALID';

export type BudgetUsage = {
  runner_minutes_month: number;
  api_requests_day: number;
  alerts_in_window: number;
};

export type BudgetGuardResult = {
  verdict: BudgetVerdict;
  reason_code: string;
  model: CostModelResult;
  fail_closed: boolean;
};

export function evaluateBudgetGuard(input: {
  cadence?: CadenceAssumptions;
  prices?: UnitPrices;
  limits?: QuotaLimits;
  usage: BudgetUsage;
}): BudgetGuardResult {
  try {
    const model = computeCostModel(input.cadence ?? DEFAULT_CADENCE, input.prices ?? DEFAULT_UNIT_PRICES);
    const limits = input.limits ?? DEFAULT_QUOTA_LIMITS;
    const { usage } = input;

    if (
      usage.runner_minutes_month < 0 ||
      usage.api_requests_day < 0 ||
      usage.alerts_in_window < 0
    ) {
      return {
        verdict: 'CONFIG_INVALID',
        reason_code: 'usage_negative',
        model,
        fail_closed: true,
      };
    }

    if (model.monthly_cost_usd === 'UNKNOWN_PRICE') {
      // Cost unknown is informational; still enforce hard quotas
      if (usage.runner_minutes_month > limits.max_runner_minutes_per_month) {
        return {
          verdict: 'HARD_STOP',
          reason_code: 'runner_minutes_hard_stop',
          model,
          fail_closed: true,
        };
      }
      if (usage.api_requests_day > limits.max_api_requests_per_day) {
        return {
          verdict: 'QUOTA_EXCEEDED',
          reason_code: 'api_requests_quota_exceeded',
          model,
          fail_closed: true,
        };
      }
      if (usage.alerts_in_window > limits.max_alerts_per_window) {
        return {
          verdict: 'QUOTA_EXCEEDED',
          reason_code: 'alerts_quota_exceeded',
          model,
          fail_closed: true,
        };
      }
      return {
        verdict: 'COST_UNKNOWN',
        reason_code: 'unit_prices_unknown',
        model,
        fail_closed: false,
      };
    }

    if (usage.runner_minutes_month > limits.max_runner_minutes_per_month) {
      return {
        verdict: 'HARD_STOP',
        reason_code: 'runner_minutes_hard_stop',
        model,
        fail_closed: true,
      };
    }
    if (usage.api_requests_day > limits.max_api_requests_per_day) {
      return {
        verdict: 'QUOTA_EXCEEDED',
        reason_code: 'api_requests_quota_exceeded',
        model,
        fail_closed: true,
      };
    }
    if (usage.alerts_in_window > limits.max_alerts_per_window) {
      return {
        verdict: 'QUOTA_EXCEEDED',
        reason_code: 'alerts_quota_exceeded',
        model,
        fail_closed: true,
      };
    }

    const warnMin = limits.max_runner_minutes_per_month * limits.warning_ratio;
    const warnApi = limits.max_api_requests_per_day * limits.warning_ratio;
    if (usage.runner_minutes_month >= warnMin || usage.api_requests_day >= warnApi) {
      return {
        verdict: 'WARNING',
        reason_code: 'warning_threshold',
        model,
        fail_closed: false,
      };
    }

    return {
      verdict: 'OK',
      reason_code: 'within_budget',
      model,
      fail_closed: false,
    };
  } catch (err) {
    return {
      verdict: 'CONFIG_INVALID',
      reason_code: err instanceof Error ? err.message : 'budget_eval_error',
      model: computeCostModel(),
      fail_closed: true,
    };
  }
}

export const CANARY_PLAN = {
  CANARY_0: {
    name: 'offline_validation',
    executed_now: true,
    note: 'Unit/integration offline tests of OF foundations',
  },
  CANARY_1: {
    name: 'external_observer_read_only',
    executed_now: false,
    prerequisites: ['PO auth', 'runtime provisioned', 'StatusSource adapter', 'alert sink optional'],
  },
  CANARY_2: {
    name: 'watchdog_stage_read_only_limited',
    executed_now: false,
    prerequisites: ['logs read credential', 'quota limits', 'NETWORK read-only gate'],
  },
  CANARY_3: {
    name: 'delivery_controlled',
    executed_now: false,
    prerequisites: ['explicit write auth', 'issue quota', 'separate from alert channel'],
  },
  CANARY_4: {
    name: 'schedule_windowed',
    executed_now: false,
    prerequisites: ['C3-D schedule auth', 'disable switch', 'owner on-call'],
  },
  CANARY_5: {
    name: 'recurring_operation',
    executed_now: false,
    prerequisites: ['formal GO', 'all prior canaries PASS'],
  },
} as const;
