import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { envOptional, logSafe } from '../_shared/http.ts';
import { getEntitlement, syncExpiredTrialStatus } from '../_shared/billing/entitlement.ts';
import {
  createCheckoutSession,
  createPortalSession,
  fetchPriceDisplay,
  stripeConfigured,
} from '../_shared/billing/stripe.ts';

Deno.serve((req) =>
  handle(req, async () => {
    const db = adminClient();

    if (req.method === 'GET') {
      const priceId = envOptional('STRIPE_PRICE_ID');
      const { data: plan } = await db.from('billing_plans').select('*').eq('id', 'unify_pro').single();
      let price = null;
      if (priceId && stripeConfigured()) {
        try {
          price = await fetchPriceDisplay(priceId);
        } catch (err) {
          logSafe('[billing-info] price_fetch_failed', {
            message: err instanceof Error ? err.message : 'unknown',
          });
        }
      }
      return json({
        plan: {
          id: plan?.id ?? 'unify_pro',
          name: plan?.name ?? 'Unify Pro',
          interval: plan?.billing_interval ?? 'month',
          currency: plan?.currency ?? 'brl',
        },
        price,
        stripeConfigured: stripeConfigured(),
      });
    }

    const { userId } = await userFromRequest(req);
    await syncExpiredTrialStatus(db, userId);
    const entitlement = await getEntitlement(db, userId);
    if (entitlement.hasAccess && entitlement.source === 'subscription') {
      return json({ error: 'ALREADY_SUBSCRIBED' }, 400);
    }

    if (!stripeConfigured()) {
      return json({ error: 'STRIPE_NOT_CONFIGURED' }, 503);
    }

    const priceId = envOptional('STRIPE_PRICE_ID');
    if (!priceId) return json({ error: 'STRIPE_PRICE_ID_MISSING' }, 503);

    const { data: authUser } = await db.auth.admin.getUserById(userId);
    const email = authUser.user?.email ?? '';
    const { data: sub } = await db
      .from('user_subscriptions')
      .select('billing_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    const session = await createCheckoutSession({
      userId,
      email,
      priceId,
      customerId: sub?.billing_customer_id as string | null,
    });

    await db.from('product_events').insert({ user_id: userId, name: 'checkout_started' });
    return json({ url: session.url });
  }),
);
