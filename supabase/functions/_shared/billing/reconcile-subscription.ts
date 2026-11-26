import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { logSafe } from '../http.ts';
import { getSubscription } from './stripe.ts';
import { applyStripeSubscription } from './webhook-handler.ts';

/**
 * Pull Stripe Test/Live subscription source-of-truth into user_subscriptions.
 * Used after portal return and for cancel_at_period_end drift repair.
 */
export async function reconcileStripeSubscriptionForUser(
  db: SupabaseClient,
  userId: string,
): Promise<{ ok: true; cancelAtPeriodEnd: boolean; status: string } | { ok: false; reason: string }> {
  const { data: sub, error } = await db
    .from('user_subscriptions')
    .select('billing_customer_id, billing_subscription_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const subscriptionId = sub?.billing_subscription_id as string | null | undefined;
  if (!subscriptionId) return { ok: false, reason: 'NO_BILLING_SUBSCRIPTION' };

  const snap = await getSubscription(subscriptionId);
  await applyStripeSubscription(db, {
    userId,
    customerId: snap.customer ?? (sub?.billing_customer_id as string) ?? '',
    subscriptionId: snap.id,
    status: snap.status,
    currentPeriodStart: snap.current_period_start,
    currentPeriodEnd: snap.current_period_end,
    cancelAtPeriodEnd: snap.cancel_at_period_end,
    canceledAt: snap.canceled_at,
    eventCreated: Math.floor(Date.now() / 1000),
  });
  logSafe('[billing-reconcile]', {
    userIdPrefix: `${userId.slice(0, 8)}…`,
    status: snap.status,
    cancelAtPeriodEnd: snap.cancel_at_period_end,
  });
  return { ok: true, cancelAtPeriodEnd: snap.cancel_at_period_end, status: snap.status };
}
