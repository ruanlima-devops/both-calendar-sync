import { adminClient, handle, json } from '../_shared/function.ts';
import { env, logSafe } from '../_shared/http.ts';
import {
  applyPaymentFailed,
  applyStripeSubscription,
  applySubscriptionDeleted,
  recordBillingEvent,
} from '../_shared/billing/webhook-handler.ts';
import { verifyWebhookSignature } from '../_shared/billing/stripe.ts';

Deno.serve((req) =>
  handle(req, async () => {
    const signature = req.headers.get('stripe-signature') ?? '';
    const payload = await req.text();

    const valid = await verifyWebhookSignature(payload, signature);
    if (!valid) {
      logSafe('[billing-webhook] invalid_signature', {});
      return json({ error: 'INVALID_SIGNATURE' }, 401);
    }

    const event = JSON.parse(payload) as {
      id: string;
      type: string;
      data: { object: Record<string, unknown> };
    };

    const db = adminClient();
    const userIdFromMeta = (obj: Record<string, unknown>): string | undefined => {
      const meta = obj.metadata as Record<string, string> | undefined;
      return meta?.user_id;
    };

    const shouldProcess = await recordBillingEvent(db, {
      provider: 'stripe',
      eventId: event.id,
      eventType: event.type,
      userId: userIdFromMeta(event.data.object),
      payload: event,
    });
    if (!shouldProcess) {
      return json({ ok: true, duplicate: true });
    }

    const obj = event.data.object;

    switch (event.type) {
      case 'checkout.session.completed': {
        const userId = userIdFromMeta(obj);
        const customerId = String(obj.customer ?? '');
        const subscriptionId = String(obj.subscription ?? '');
        if (!userId || !subscriptionId) break;
        await applyStripeSubscription(db, {
          userId,
          customerId,
          subscriptionId,
          status: 'active',
          currentPeriodStart: null,
          currentPeriodEnd: null,
        });
        await db.from('product_events').insert({ user_id: userId, name: 'subscription_activated' });
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const userId = userIdFromMeta(obj);
        if (!userId) break;
        await applyStripeSubscription(db, {
          userId,
          customerId: String(obj.customer ?? ''),
          subscriptionId: String(obj.id ?? ''),
          status: String(obj.status ?? 'active'),
          currentPeriodStart: obj.current_period_start as number | null,
          currentPeriodEnd: obj.current_period_end as number | null,
          cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
        });
        break;
      }
      case 'customer.subscription.deleted': {
        const userId = userIdFromMeta(obj);
        if (!userId) break;
        await applySubscriptionDeleted(db, userId);
        await db.from('product_events').insert({ user_id: userId, name: 'subscription_canceled' });
        break;
      }
      case 'invoice.payment_failed': {
        const userId = userIdFromMeta(obj);
        if (!userId) break;
        await applyPaymentFailed(db, userId);
        break;
      }
      default:
        logSafe('[billing-webhook] ignored', { type: event.type });
    }

    return json({ ok: true });
  }),
);
