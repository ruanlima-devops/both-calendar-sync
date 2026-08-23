import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { logSafe } from '../http.ts';
import {
  onAccessGranted,
  onAccessRevoked,
  type SubscriptionStatus,
} from './entitlement.ts';
import { unixToIso } from './stripe.ts';

const GRACE_DAYS = 3;

export async function recordBillingEvent(
  db: SupabaseClient,
  input: { provider: string; eventId: string; eventType: string; userId?: string; payload: unknown },
): Promise<boolean> {
  const { error } = await db.from('billing_events').insert({
    provider: input.provider,
    provider_event_id: input.eventId,
    event_type: input.eventType,
    user_id: input.userId ?? null,
    payload: input.payload,
  });
  if (error?.code === '23505') return false;
  if (error) throw new Error(error.message);
  return true;
}

export async function applyStripeSubscription(
  db: SupabaseClient,
  input: {
    userId: string;
    customerId: string;
    subscriptionId: string;
    status: string;
    currentPeriodStart?: number | null;
    currentPeriodEnd?: number | null;
    cancelAtPeriodEnd?: boolean;
  },
): Promise<void> {
  const mapped = mapStripeStatus(input.status);
  const patch = {
    billing_provider: 'stripe',
    billing_customer_id: input.customerId,
    billing_subscription_id: input.subscriptionId,
    status: mapped,
    current_period_start: unixToIso(input.currentPeriodStart),
    current_period_end: unixToIso(input.currentPeriodEnd),
    cancel_at_period_end: Boolean(input.cancelAtPeriodEnd),
    updated_at: new Date().toISOString(),
  };

  const { error } = await db.from('user_subscriptions').update(patch).eq('user_id', input.userId);
  if (error) throw new Error(error.message);

  const entHasAccess = mapped === 'active' || mapped === 'grace_period';
  if (entHasAccess) await onAccessGranted(db, input.userId);
  else if (mapped === 'expired') await onAccessRevoked(db, input.userId);

  logSafe('[billing-webhook]', { userId: input.userId, status: mapped });
}

function mapStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'unpaid':
    case 'incomplete_expired':
      return 'expired';
    case 'incomplete':
      return 'incomplete';
    default:
      return 'expired';
  }
}

export async function applyPaymentFailed(
  db: SupabaseClient,
  userId: string,
): Promise<void> {
  const graceEnds = new Date(Date.now() + GRACE_DAYS * 86_400_000).toISOString();
  await db
    .from('user_subscriptions')
    .update({
      status: 'grace_period',
      grace_period_ends_at: graceEnds,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  logSafe('[billing-webhook]', { userId, status: 'grace_period' });
}

export async function applySubscriptionDeleted(db: SupabaseClient, userId: string): Promise<void> {
  await db
    .from('user_subscriptions')
    .update({
      status: 'expired',
      billing_subscription_id: null,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  await onAccessRevoked(db, userId);
  logSafe('[billing-webhook]', { userId, status: 'expired' });
}

/**
 * App Store / Play Billing via RevenueCat webhook.
 * Does not create a second trial — Unify trial remains internal until purchase.
 */
export async function applyStoreEntitlement(
  db: SupabaseClient,
  input: {
    userId: string;
    billingProvider: 'apple' | 'google';
    status: SubscriptionStatus;
    productId: string;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    billingSubscriptionId?: string;
  },
): Promise<void> {
  const patch = {
    plan_id: 'unify_pro',
    billing_provider: input.billingProvider,
    billing_subscription_id: input.billingSubscriptionId ?? null,
    status: input.status,
    current_period_end: input.periodEnd,
    cancel_at_period_end: input.cancelAtPeriodEnd,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db.from('user_subscriptions').update(patch).eq('user_id', input.userId);
  if (error) throw new Error(error.message);

  if (input.status === 'active' || (input.status === 'canceled' && input.periodEnd)) {
    await onAccessGranted(db, input.userId);
  } else if (input.status === 'expired') {
    await onAccessRevoked(db, input.userId);
  }

  logSafe('[billing-store]', {
    userId: input.userId,
    provider: input.billingProvider,
    status: input.status,
    productId: input.productId,
  });
}
