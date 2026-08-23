import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'grace_period'
  | 'canceled'
  | 'expired'
  | 'incomplete';

export interface SubscriptionRow {
  user_id: string;
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
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
}

export interface Entitlement {
  hasAccess: boolean;
  source: 'trial' | 'subscription' | 'none';
  plan: string | null;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}

const MS_DAY = 86_400_000;

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : null;
}

export function computeEntitlement(
  sub: SubscriptionRow | null | undefined,
  now = new Date(),
): Entitlement {
  const empty: Entitlement = {
    hasAccess: false,
    source: 'none',
    plan: null,
    status: 'expired',
    trialEndsAt: null,
    currentPeriodEnd: null,
  };
  if (!sub) return empty;

  const nowMs = now.getTime();
  const base = {
    plan: sub.plan_id,
    trialEndsAt: sub.trial_ends_at,
    currentPeriodEnd: sub.current_period_end,
  };

  if (sub.status === 'trialing') {
    const trialEnd = ms(sub.trial_ends_at);
    if (trialEnd !== null && trialEnd > nowMs) {
      return { ...base, hasAccess: true, source: 'trial', status: 'trialing' };
    }
    return { ...empty, ...base, status: 'expired' };
  }

  if (sub.status === 'active') {
    return { ...base, hasAccess: true, source: 'subscription', status: 'active' };
  }

  if (sub.status === 'past_due' || sub.status === 'grace_period') {
    const graceEnd = ms(sub.grace_period_ends_at);
    if (graceEnd !== null && graceEnd > nowMs) {
      return { ...base, hasAccess: true, source: 'subscription', status: sub.status };
    }
    return { ...empty, ...base, status: 'expired' };
  }

  if (sub.cancel_at_period_end && sub.current_period_end) {
    const periodEnd = ms(sub.current_period_end);
    if (periodEnd !== null && periodEnd > nowMs) {
      return { ...base, hasAccess: true, source: 'subscription', status: 'canceled' };
    }
  }

  return { ...empty, ...base, status: sub.status === 'canceled' ? 'expired' : sub.status };
}

export async function loadSubscription(
  db: SupabaseClient,
  userId: string,
): Promise<SubscriptionRow | null> {
  const { data } = await db
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
}

export async function getEntitlement(db: SupabaseClient, userId: string): Promise<Entitlement> {
  return computeEntitlement(await loadSubscription(db, userId));
}

export async function requireEntitlement(db: SupabaseClient, userId: string): Promise<Entitlement> {
  const entitlement = await getEntitlement(db, userId);
  if (!entitlement.hasAccess) throw new Error('ENTITLEMENT_REQUIRED');
  return entitlement;
}

export async function pauseIntegrationsForUser(db: SupabaseClient, userId: string): Promise<void> {
  await db
    .from('calendar_connections')
    .update({ paused_by_entitlement: true })
    .eq('user_id', userId)
    .eq('paused_by_entitlement', false);
}

export async function resumeIntegrationsForUser(db: SupabaseClient, userId: string): Promise<void> {
  await db
    .from('calendar_connections')
    .update({ paused_by_entitlement: false })
    .eq('user_id', userId)
    .eq('paused_by_entitlement', true);
}

export async function syncExpiredTrialStatus(db: SupabaseClient, userId: string): Promise<void> {
  const sub = await loadSubscription(db, userId);
  if (!sub || sub.status !== 'trialing') return;
  const trialEnd = ms(sub.trial_ends_at);
  if (trialEnd === null || trialEnd > Date.now()) return;
  await db
    .from('user_subscriptions')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'trialing');
  await pauseIntegrationsForUser(db, userId);
}

export async function onAccessGranted(db: SupabaseClient, userId: string): Promise<void> {
  await resumeIntegrationsForUser(db, userId);
}

export async function onAccessRevoked(db: SupabaseClient, userId: string): Promise<void> {
  await pauseIntegrationsForUser(db, userId);
}
