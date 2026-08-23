import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { createPortalSession, stripeConfigured } from '../_shared/billing/stripe.ts';

Deno.serve((req) =>
  handle(req, async () => {
    if (!stripeConfigured()) return json({ error: 'STRIPE_NOT_CONFIGURED' }, 503);

    const { userId } = await userFromRequest(req);
    const db = adminClient();
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
