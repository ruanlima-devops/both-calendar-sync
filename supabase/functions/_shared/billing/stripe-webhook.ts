import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { logSafe } from '../http.ts';
import {
  resolveCancelAtPeriodEnd,
  resolveSubscriptionPeriodBounds,
} from './cancel-at-period-end.ts';
import { resolveBillingTargetAccount } from './cancel-before-delete.ts';
import { getSubscription } from './stripe.ts';
import {
  applyPaymentFailed,
  applyStripeSubscription,
  applySubscriptionDeleted,
  claimBillingEvent,
  completeBillingEvent,
  failBillingEvent,
  resolveStripeUserId,
  stripeIdsFromCheckout,
  stripeIdsFromInvoice,
  stripeIdsFromSubscription,
} from './webhook-handler.ts';

export type StripeWebhookEvent = {
  id: string;
  type: string;
  created?: number;
  data: { object: Record<string, unknown> };
};

export type ProcessStripeEventResult =
  | { ok: true; duplicate?: boolean; skipped?: string }
  | { ok: false; error: string; retryable: boolean };

type DispatchResult =
  | { kind: 'applied' | 'ignored'; userId?: string }
  | { kind: 'skipped'; userId: string; reason: 'deleted_account' };

function userIdPrefix(userId: string | undefined | null): string | null {
  if (!userId) return null;
  return `${userId.slice(0, 8)}…`;
}

/**
 * Apply a verified Stripe event. Caller must validate Stripe-Signature first.
 * Idempotency: claim → apply → complete; on failure mark `failed` so Stripe can retry.
 *
 * Late-event / post-delete: when profile is **confirmed missing**, skip entitlement
 * writes, mark event `processed` with auditable `skipped_deleted_account`, no Stripe retry loop.
 * Profile lookup errors throw → `failed` + retryable (never treated as deleted).
 */
export async function processStripeEvent(
  db: SupabaseClient,
  event: StripeWebhookEvent,
): Promise<ProcessStripeEventResult> {
  const obj = event.data?.object ?? {};
  const eventCreated = typeof event.created === 'number' ? event.created : null;

  const preliminaryUserId = await peekUserId(db, event.type, obj);

  const claim = await claimBillingEvent(db, {
    provider: 'stripe',
    eventId: event.id,
    eventType: event.type,
    userId: preliminaryUserId,
    payload: event,
  });
  if (claim.kind === 'duplicate') {
    return { ok: true, duplicate: true };
  }

  try {
    const dispatched = await dispatchStripeEvent(db, event.type, obj, eventCreated);
    if (dispatched.kind === 'skipped') {
      await completeBillingEvent(db, {
        provider: 'stripe',
        eventId: event.id,
        userId: dispatched.userId,
        skipReason: 'skipped_deleted_account',
      });
      return { ok: true, skipped: dispatched.reason };
    }
    await completeBillingEvent(db, {
      provider: 'stripe',
      eventId: event.id,
      userId: dispatched.userId ?? preliminaryUserId ?? null,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    await failBillingEvent(db, {
      provider: 'stripe',
      eventId: event.id,
      error: message,
    });
    logSafe('[billing-webhook] apply_failed', {
      eventType: event.type,
      error: message.slice(0, 200),
      retryable: true,
    });
    return { ok: false, error: message, retryable: true };
  }
}

async function peekUserId(
  db: SupabaseClient,
  type: string,
  obj: Record<string, unknown>,
): Promise<string | undefined> {
  const ids =
    type === 'invoice.payment_failed'
      ? stripeIdsFromInvoice(obj)
      : type.startsWith('customer.subscription.')
        ? stripeIdsFromSubscription(obj)
        : stripeIdsFromCheckout(obj);
  // For peek, prefer metadata only — full resolve happens in dispatch (may need DB links).
  if (ids.metadataUserId) return ids.metadataUserId;
  const resolved = await resolveStripeUserId(db, ids);
  return resolved.ok ? resolved.userId : undefined;
}

/**
 * Ensure target account still exists before any entitlement / product_events write.
 * Lookup failures propagate (retryable). Confirmed missing → skip without write.
 */
async function requireExistingAccount(
  db: SupabaseClient,
  type: string,
  userId: string,
): Promise<'ok' | 'missing'> {
  const presence = await resolveBillingTargetAccount(db, userId);
  if (presence.kind === 'missing') {
    logSafe('[billing-webhook] skipped_deleted_account', {
      type,
      userIdPrefix: userIdPrefix(userId),
    });
    return 'missing';
  }
  return 'ok';
}

async function dispatchStripeEvent(
  db: SupabaseClient,
  type: string,
  obj: Record<string, unknown>,
  eventCreated: number | null,
): Promise<DispatchResult> {
  switch (type) {
    case 'checkout.session.completed': {
      const ids = stripeIdsFromCheckout(obj);
      const resolved = await resolveStripeUserId(db, ids);
      if (!resolved.ok) {
        logSafe('[billing-webhook] checkout_user_unresolved', { reason: resolved.reason });
        return { kind: 'ignored' };
      }
      if ((await requireExistingAccount(db, type, resolved.userId)) === 'missing') {
        return { kind: 'skipped', userId: resolved.userId, reason: 'deleted_account' };
      }
      const subscriptionId = ids.subscriptionId;
      if (!subscriptionId) {
        logSafe('[billing-webhook] checkout_missing_subscription', {
          userIdPrefix: userIdPrefix(resolved.userId),
        });
        return { kind: 'ignored', userId: resolved.userId };
      }
      // Prefer Stripe source-of-truth for periods/cancel; fall back to activate-only patch
      // that does not wipe cancel_at_period_end / period bounds.
      let snap: Awaited<ReturnType<typeof getSubscription>> | null = null;
      try {
        snap = await getSubscription(subscriptionId);
      } catch (err) {
        logSafe('[billing-webhook] checkout_subscription_fetch_failed', {
          message: err instanceof Error ? err.message : 'unknown',
        });
      }
      await applyStripeSubscription(db, {
        userId: resolved.userId,
        customerId: snap?.customer ?? ids.customerId ?? '',
        subscriptionId,
        status: snap?.status ?? 'active',
        currentPeriodStart: snap?.current_period_start,
        currentPeriodEnd: snap?.current_period_end,
        // When Stripe fetch fails, omit cancel so we never clobber a scheduled cancel
        // with Boolean(undefined)→false (root cause of STAGE cancel drift).
        cancelAtPeriodEnd: snap ? snap.cancel_at_period_end : undefined,
        canceledAt: snap ? snap.canceled_at : undefined,
        eventCreated,
      });
      await db.from('product_events').insert({
        user_id: resolved.userId,
        name: 'subscription_activated',
      });
      return { kind: 'applied', userId: resolved.userId };
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const ids = stripeIdsFromSubscription(obj);
      const resolved = await resolveStripeUserId(db, ids);
      if (!resolved.ok) {
        logSafe('[billing-webhook] subscription_user_unresolved', {
          type,
          reason: resolved.reason,
        });
        return { kind: 'ignored' };
      }
      if ((await requireExistingAccount(db, type, resolved.userId)) === 'missing') {
        return { kind: 'skipped', userId: resolved.userId, reason: 'deleted_account' };
      }
      const cancelAtPeriodEnd = resolveCancelAtPeriodEnd(obj);
      const period = resolveSubscriptionPeriodBounds(obj);
      await applyStripeSubscription(db, {
        userId: resolved.userId,
        customerId: ids.customerId ?? '',
        subscriptionId: ids.subscriptionId ?? '',
        status: String(obj.status ?? 'active'),
        currentPeriodStart: period.currentPeriodStart,
        currentPeriodEnd: period.currentPeriodEnd,
        cancelAtPeriodEnd,
        canceledAt: typeof obj.canceled_at === 'number' ? obj.canceled_at : undefined,
        eventCreated,
      });
      return { kind: 'applied', userId: resolved.userId };
    }
    case 'customer.subscription.deleted': {
      const ids = stripeIdsFromSubscription(obj);
      const resolved = await resolveStripeUserId(db, ids);
      if (!resolved.ok) {
        logSafe('[billing-webhook] subscription_deleted_unresolved', { reason: resolved.reason });
        return { kind: 'ignored' };
      }
      if ((await requireExistingAccount(db, type, resolved.userId)) === 'missing') {
        return { kind: 'skipped', userId: resolved.userId, reason: 'deleted_account' };
      }
      await applySubscriptionDeleted(db, resolved.userId, eventCreated);
      await db.from('product_events').insert({
        user_id: resolved.userId,
        name: 'subscription_canceled',
      });
      return { kind: 'applied', userId: resolved.userId };
    }
    case 'invoice.payment_failed': {
      const ids = stripeIdsFromInvoice(obj);
      const resolved = await resolveStripeUserId(db, ids);
      if (!resolved.ok) {
        logSafe('[billing-webhook] payment_failed_unresolved', { reason: resolved.reason });
        // Mapping gap — complete without transition (not a deleted-account skip).
        return { kind: 'ignored' };
      }
      if ((await requireExistingAccount(db, type, resolved.userId)) === 'missing') {
        return { kind: 'skipped', userId: resolved.userId, reason: 'deleted_account' };
      }
      await applyPaymentFailed(db, resolved.userId, eventCreated);
      return { kind: 'applied', userId: resolved.userId };
    }
    default:
      // invoice.paid / payment_intent.* etc. are informational for Both; entitlement
      // comes from checkout + subscription.* + payment_failed.
      logSafe('[billing-webhook] ignored', { type });
      return { kind: 'ignored' };
  }
}
