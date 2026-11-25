import { adminClient, handle, json } from '../_shared/function.ts';
import { logSafe } from '../_shared/http.ts';
import { processStripeEvent, type StripeWebhookEvent } from '../_shared/billing/stripe-webhook.ts';
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

    let event: StripeWebhookEvent;
    try {
      event = JSON.parse(payload) as StripeWebhookEvent;
    } catch {
      return json({ error: 'INVALID_JSON' }, 400);
    }
    if (!event?.id || !event?.type || !event?.data?.object) {
      return json({ error: 'INVALID_EVENT' }, 400);
    }

    const result = await processStripeEvent(adminClient(), event);
    if (!result.ok) {
      return json({ error: 'APPLY_FAILED', retryable: result.retryable }, 500);
    }
    if (result.duplicate) return json({ ok: true, duplicate: true });
    return json({ ok: true });
  }),
);
