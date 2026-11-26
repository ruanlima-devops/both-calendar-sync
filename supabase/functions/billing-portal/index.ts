import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { reconcileStripeSubscriptionForUser } from '../_shared/billing/reconcile-subscription.ts';
import { createPortalSession, stripeConfigured } from '../_shared/billing/stripe.ts';
import { logSafe } from '../_shared/http.ts';

Deno.serve((req) =>
  handle(req, async () => {
    if (!stripeConfigured()) return json({ error: 'STRIPE_NOT_CONFIGURED' }, 503);

    const { userId } = await userFromRequest(req);
    const db = adminClient();

    // Best-effort reconcile before portal so cancel_at_period_end drift is healed
    // when the user returns from Stripe (and when opening Gerenciar assinatura).
    try {
      await reconcileStripeSubscriptionForUser(db, userId);
    } catch (err) {
      logSafe('[billing-portal] reconcile_failed', {
        message: err instanceof Error ? err.message : 'unknown',
      });
    }

    const { data: sub } = await db
      .from('user_subscriptions')
      .select('billing_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    const customerId = sub?.billing_customer_id as string | undefined;
    if (!customerId) return json({ error: 'NO_BILLING_CUSTOMER' }, 400);

    const portal = await createPortalSession(customerId);
    return json({ url: portal.url });
  }),
);
