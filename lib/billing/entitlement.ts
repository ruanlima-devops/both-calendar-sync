export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'grace_period'
  | 'canceled'
  | 'expired'
  | 'incomplete';

export type EntitlementSource = 'trial' | 'subscription' | 'none';

export type TrialUrgency = 'discrete' | 'visible' | 'urgent' | 'expired';

export interface SubscriptionRecord {
  plan_id: string;
  status: SubscriptionStatus;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  grace_period_ends_at: string | null;
  billing_provider: string;
  billing_customer_id?: string | null;
}

export interface Entitlement {
  hasAccess: boolean;
  source: EntitlementSource;
  plan: string | null;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  daysRemaining: number | null;
  cancelAtPeriodEnd: boolean;
  trialUrgency: TrialUrgency;
}

export interface PlanPrice {
  planId: string;
  name: string;
  amountCents: number | null;
  currency: string;
  interval: 'month' | 'year';
  formatted: string | null;
}

const MS_DAY = 86_400_000;

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : null;
}

export function daysRemainingUntil(iso: string | null | undefined, now = new Date()): number | null {
  const end = ms(iso);
  if (end === null) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / MS_DAY));
}

export function trialUrgency(days: number | null, hasAccess: boolean): TrialUrgency {
  if (!hasAccess) return 'expired';
  if (days === null) return 'discrete';
  if (days >= 8) return 'discrete';
  if (days >= 4) return 'visible';
  return 'urgent';
}

export function computeEntitlement(
  sub: SubscriptionRecord | null | undefined,
  now = new Date(),
): Entitlement {
  const empty: Entitlement = {
    hasAccess: false,
    source: 'none',
    plan: null,
    status: 'expired',
    trialEndsAt: null,
    currentPeriodEnd: null,
    daysRemaining: null,
    cancelAtPeriodEnd: false,
    trialUrgency: 'expired',
  };

  if (!sub) return empty;

  const nowMs = now.getTime();
  const base = {
    plan: sub.plan_id,
    trialEndsAt: sub.trial_ends_at,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };

  if (sub.status === 'trialing') {
    const trialEnd = ms(sub.trial_ends_at);
    if (trialEnd !== null && trialEnd > nowMs) {
      const days = daysRemainingUntil(sub.trial_ends_at, now);
      return {
        ...base,
        hasAccess: true,
        source: 'trial',
        status: 'trialing',
        daysRemaining: days,
        trialUrgency: trialUrgency(days, true),
      };
    }
    return { ...empty, ...base, status: 'expired', trialUrgency: 'expired' };
  }

  if (sub.status === 'active') {
    return {
      ...base,
      hasAccess: true,
      source: 'subscription',
      status: 'active',
      daysRemaining: null,
      trialUrgency: 'discrete',
    };
  }

  if (sub.status === 'past_due' || sub.status === 'grace_period') {
    const graceEnd = ms(sub.grace_period_ends_at);
    if (graceEnd !== null && graceEnd > nowMs) {
      return {
        ...base,
        hasAccess: true,
        source: 'subscription',
        status: sub.status,
        daysRemaining: daysRemainingUntil(sub.grace_period_ends_at, now),
        trialUrgency: 'discrete',
      };
    }
    return { ...empty, ...base, status: 'expired', trialUrgency: 'expired' };
  }

  if (sub.cancel_at_period_end && sub.current_period_end) {
    const periodEnd = ms(sub.current_period_end);
    if (periodEnd !== null && periodEnd > nowMs) {
      return {
        ...base,
        hasAccess: true,
        source: 'subscription',
        status: 'canceled',
        daysRemaining: daysRemainingUntil(sub.current_period_end, now),
        trialUrgency: 'discrete',
      };
    }
  }

  return {
    ...empty,
    ...base,
    status: sub.status === 'canceled' ? 'expired' : sub.status,
    trialUrgency: 'expired',
  };
}

export function statusLabel(status: SubscriptionStatus, entitlement: Entitlement): string {
  if (entitlement.source === 'trial') return 'Teste gratuito';
  if (status === 'active') return 'Ativo';
  if (status === 'canceled' && entitlement.hasAccess) return 'Cancelado (ativo até o fim do período)';
  if (status === 'past_due') return 'Pagamento pendente';
  if (status === 'grace_period') return 'Período de tolerância';
  if (status === 'expired') return 'Expirado';
  if (status === 'incomplete') return 'Incompleto';
  return status;
}
