import { authorizationBearerMatches } from '../_shared/auth-guards.ts';
import { adminClient, handle, json } from '../_shared/function.ts';
import { applyStoreEntitlement, recordBillingEvent } from '../_shared/billing/webhook-handler.ts';
import { env, logSafe } from '../_shared/http.ts';

/**
 * RevenueCat → Both Pro entitlement.
 * Configure webhook in RevenueCat dashboard to this function URL.
 * Auth: Authorization Bearer REVENUECAT_WEBHOOK_SECRET
 */
Deno.serve((req) =>
  handle(req, async () => {
    const secret = env('REVENUECAT_WEBHOOK_SECRET');
    if (!authorizationBearerMatches(req.headers.get('Authorization'), secret)) {
      throw new Error('UNAUTHENTICATED');
    }

    const body = (await req.json()) as Record<string, unknown>;
    const event = (body.event ?? body) as Record<string, unknown>;
    const eventId = String(event.id ?? body.id ?? crypto.randomUUID());
    const type = String(event.type ?? body.type ?? 'UNKNOWN');
    const appUserId = String(event.app_user_id ?? event.appUserId ?? '');
    const store = String(event.store ?? '').toUpperCase();
    const entitlementIds = (event.entitlement_ids ?? event.entitlementIds ?? []) as string[];
    const expirationMs = event.expiration_at_ms ?? event.expiration_at;
    const periodEnd =
      typeof expirationMs === 'number'
        ? new Date(expirationMs).toISOString()
        : typeof expirationMs === 'string'
          ? new Date(Number(expirationMs) || expirationMs).toISOString()
          : null;

    const db = adminClient();
    const first = await recordBillingEvent(db, {
      provider: 'revenuecat',
      eventId,
      eventType: type,
      userId: appUserId || undefined,
      payload: body,
    });
    if (!first) return json({ ok: true, duplicate: true });

    if (!appUserId || !/^[0-9a-f-]{36}$/i.test(appUserId)) {
      logSafe('revenuecat-webhook-skip', { reason: 'invalid_app_user_id', type });
      return json({ ok: true, skipped: 'invalid_user' });
    }

    const hasPro =
      entitlementIds.includes('unify_pro') ||
      type === 'INITIAL_PURCHASE' ||
      type === 'RENEWAL' ||
      type === 'UNCANCELLATION' ||
      type === 'PRODUCT_CHANGE';

    const lost =
      type === 'EXPIRATION' ||
      type === 'REFUND' ||
      (type === 'TRANSFER' && !hasPro);

    const billingProvider = store.includes('PLAY') || store === 'PLAY_STORE' ? 'google' : 'apple';

    if (lost || type === 'EXPIRATION') {
      await applyStoreEntitlement(db, {
        userId: appUserId,
        billingProvider,
        status: 'expired',
        productId: String(event.product_id ?? 'unify_pro_monthly'),
        periodEnd: null,
        cancelAtPeriodEnd: false,
      });
    } else if (
      hasPro ||
      type === 'INITIAL_PURCHASE' ||
      type === 'RENEWAL' ||
      type === 'UNCANCELLATION' ||
      type === 'NON_RENEWING_PURCHASE'
    ) {
      await applyStoreEntitlement(db, {
        userId: appUserId,
        billingProvider,
        status: type === 'CANCELLATION' ? 'canceled' : 'active',
        productId: String(event.product_id ?? 'unify_pro_monthly'),
        periodEnd,
        cancelAtPeriodEnd: type === 'CANCELLATION',
        billingSubscriptionId: String(event.transaction_id ?? event.original_transaction_id ?? eventId),
      });
    }

    logSafe('revenuecat-webhook', { type, userId: appUserId, store: billingProvider });
    return json({ ok: true });
  }),
);
