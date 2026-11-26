import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { logSafe } from '../http.ts';
import {
  onAccessGranted,
  onAccessRevoked,
  type SubscriptionStatus,
} from './entitlement.ts';
import { unixToIso } from './stripe.ts';

const GRACE_DAYS = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BillingEventStatus = 'received' | 'processing' | 'processed' | 'failed';

export type ClaimBillingEventResult =
  | { kind: 'claimed'; status: 'processing' }
  | { kind: 'duplicate' }
  | { kind: 'retry'; status: 'processing' };

export type ResolveStripeUserResult =
  | { ok: true; userId: string; source: 'metadata' | 'subscription' | 'customer' | 'consistent' }
  | { ok: false; reason: 'not_found' | 'ambiguous' | 'conflict' | 'invalid_metadata' };

/**
 * Claim an idempotency slot before applying entitlement transitions.
 * Inserts status=`processing`. On unique conflict:
 * - `processed` → duplicate (skip)
 * - `failed` | `received` → reclaim for retry
 * - `processing` → duplicate (another worker owns it; Stripe may retry later)
 */
export async function claimBillingEvent(
  db: SupabaseClient,
  input: { provider: string; eventId: string; eventType: string; userId?: string; payload: unknown },
): Promise<ClaimBillingEventResult> {
  const { error } = await db.from('billing_events').insert({
    provider: input.provider,
    provider_event_id: input.eventId,
    event_type: input.eventType,
    user_id: input.userId ?? null,
    payload: input.payload,
    status: 'processing',
    attempt_count: 1,
    last_error: null,
    processed_at: null,
  });

  if (!error) return { kind: 'claimed', status: 'processing' };
  if (error.code !== '23505') throw new Error(error.message);

  const { data: existing, error: selectError } = await db
    .from('billing_events')
    .select('status, attempt_count, updated_at, processed_at')
    .eq('provider', input.provider)
    .eq('provider_event_id', input.eventId)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);
  if (!existing) throw new Error('billing_event_missing_after_conflict');

  const status = String(existing.status ?? 'processed') as BillingEventStatus;
  if (status === 'processed') return { kind: 'duplicate' };

  const staleProcessing =
    status === 'processing' && isStaleBillingClaim(existing.updated_at ?? existing.processed_at);
  if (status === 'processing' && !staleProcessing) return { kind: 'duplicate' };

  const reclaimable = status === 'failed' || status === 'received' || staleProcessing;
  if (!reclaimable) return { kind: 'duplicate' };

  const attempts = Number(existing.attempt_count ?? 0) + 1;
  const { data: reclaimed, error: updateError } = await db
    .from('billing_events')
    .update({
      status: 'processing',
      attempt_count: attempts,
      last_error: null,
      event_type: input.eventType,
      user_id: input.userId ?? null,
      payload: input.payload,
      processed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', input.provider)
    .eq('provider_event_id', input.eventId)
    .in('status', staleProcessing ? ['processing', 'failed', 'received'] : ['failed', 'received'])
    .select('provider_event_id')
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);
  if (!reclaimed) return { kind: 'duplicate' };
  return { kind: 'retry', status: 'processing' };
}

/** Allow reclaim of abandoned `processing` rows (worker crash) after 5 minutes. */
const STALE_CLAIM_MS = 5 * 60_000;

function isStaleBillingClaim(updatedAt: unknown): boolean {
  if (typeof updatedAt !== 'string' || !updatedAt) return false;
  const ts = new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > STALE_CLAIM_MS;
}

export async function completeBillingEvent(
  db: SupabaseClient,
  input: {
    provider: string;
    eventId: string;
    userId?: string | null;
    /** Auditable non-fatal outcome (e.g. skipped_deleted_account). Keeps status=processed. */
    skipReason?: string | null;
  },
): Promise<void> {
  const { error } = await db
    .from('billing_events')
    .update({
      status: 'processed',
      processed_at: new Date().toISOString(),
      last_error: input.skipReason ? String(input.skipReason).slice(0, 500) : null,
      ...(input.userId ? { user_id: input.userId } : {}),
    })
    .eq('provider', input.provider)
    .eq('provider_event_id', input.eventId)
    .eq('status', 'processing');
  if (error) throw new Error(error.message);
}

export async function failBillingEvent(
  db: SupabaseClient,
  input: { provider: string; eventId: string; error: string },
): Promise<void> {
  const { error } = await db
    .from('billing_events')
    .update({
      status: 'failed',
      last_error: input.error.slice(0, 500),
      processed_at: null,
    })
    .eq('provider', input.provider)
    .eq('provider_event_id', input.eventId)
    .eq('status', 'processing');
  if (error) throw new Error(error.message);
}

/**
 * @deprecated Prefer claimBillingEvent + completeBillingEvent. Kept for call-site migration;
 * inserts as `processing` and does NOT mark processed — callers must complete/fail.
 */
export async function recordBillingEvent(
  db: SupabaseClient,
  input: { provider: string; eventId: string; eventType: string; userId?: string; payload: unknown },
): Promise<boolean> {
  const claim = await claimBillingEvent(db, input);
  return claim.kind !== 'duplicate';
}

function asStripeId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
}

function metadataUserId(obj: Record<string, unknown>): string | undefined {
  const meta = obj.metadata as Record<string, unknown> | undefined;
  const raw = meta?.user_id;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/**
 * Resolve Both user from Stripe object without relying only on metadata.user_id.
 * Rejects ambiguous (multiple DB rows) or conflicting (metadata ≠ billing ids) mappings.
 */
export async function resolveStripeUserId(
  db: SupabaseClient,
  input: {
    metadataUserId?: string | null;
    customerId?: string | null;
    subscriptionId?: string | null;
  },
): Promise<ResolveStripeUserResult> {
  const candidates = new Map<string, 'metadata' | 'subscription' | 'customer' | 'consistent'>();

  const meta = input.metadataUserId?.trim() || null;
  if (meta) {
    if (!UUID_RE.test(meta)) return { ok: false, reason: 'invalid_metadata' };
    candidates.set(meta, 'metadata');
  }

  if (input.subscriptionId) {
    const { data, error } = await db
      .from('user_subscriptions')
      .select('user_id')
      .eq('billing_subscription_id', input.subscriptionId)
      .eq('billing_provider', 'stripe');
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length > 1) return { ok: false, reason: 'ambiguous' };
    if (rows.length === 1 && typeof rows[0]?.user_id === 'string') {
      addCandidate(candidates, rows[0].user_id, 'subscription');
    }
  }

  if (input.customerId) {
    const { data, error } = await db
      .from('user_subscriptions')
      .select('user_id')
      .eq('billing_customer_id', input.customerId)
      .eq('billing_provider', 'stripe');
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length > 1) return { ok: false, reason: 'ambiguous' };
    if (rows.length === 1 && typeof rows[0]?.user_id === 'string') {
      addCandidate(candidates, rows[0].user_id, 'customer');
    }
  }

  if (candidates.size === 0) return { ok: false, reason: 'not_found' };
  if (candidates.size > 1) return { ok: false, reason: 'conflict' };

  const [userId, source] = [...candidates.entries()][0]!;
  return { ok: true, userId, source };
}

function addCandidate(
  candidates: Map<string, 'metadata' | 'subscription' | 'customer' | 'consistent'>,
  userId: string,
  source: 'subscription' | 'customer',
): void {
  const prev = candidates.get(userId);
  if (!prev) {
    candidates.set(userId, source);
    return;
  }
  candidates.set(userId, 'consistent');
}

export function stripeIdsFromCheckout(obj: Record<string, unknown>): {
  metadataUserId?: string;
  customerId: string | null;
  subscriptionId: string | null;
} {
  return {
    metadataUserId: metadataUserId(obj),
    customerId: asStripeId(obj.customer),
    subscriptionId: asStripeId(obj.subscription),
  };
}

export function stripeIdsFromSubscription(obj: Record<string, unknown>): {
  metadataUserId?: string;
  customerId: string | null;
  subscriptionId: string | null;
} {
  return {
    metadataUserId: metadataUserId(obj),
    customerId: asStripeId(obj.customer),
    subscriptionId: asStripeId(obj.id),
  };
}

/** For invoice objects, subscription may be under subscription / parent.subscription_details. */
export function stripeIdsFromInvoice(obj: Record<string, unknown>): {
  metadataUserId?: string;
  customerId: string | null;
  subscriptionId: string | null;
} {
  const parent = obj.parent as Record<string, unknown> | undefined;
  const subDetails = parent?.subscription_details as Record<string, unknown> | undefined;
  return {
    metadataUserId: metadataUserId(obj) ?? metadataUserId(subDetails ?? {}),
    customerId: asStripeId(obj.customer),
    subscriptionId: asStripeId(obj.subscription) ?? asStripeId(subDetails?.subscription),
  };
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
    /** When undefined, the existing DB column is preserved (never clobbered to false). */
    cancelAtPeriodEnd?: boolean;
    canceledAt?: number | null;
    eventCreated?: number | null;
  },
): Promise<'applied' | 'ignored_stale'> {
  if (!(await shouldApplyStripeEvent(db, input.userId, input.eventCreated))) {
    logSafe('[billing-webhook] stale_event_ignored', {
      userId: input.userId,
      subscriptionId: input.subscriptionId,
      eventCreated: input.eventCreated ?? null,
    });
    return 'ignored_stale';
  }

  const mapped = mapStripeStatus(input.status);
  const patch: Record<string, unknown> = {
    billing_provider: 'stripe',
    billing_customer_id: input.customerId || null,
    billing_subscription_id: input.subscriptionId,
    status: mapped,
    updated_at: new Date().toISOString(),
  };
  // Only write period/cancel fields when the caller provided them. Thin events
  // (e.g. checkout.session.completed without subscription expand) must not wipe
  // cancel_at_period_end or period bounds established by subscription.updated.
  if (input.currentPeriodStart !== undefined) {
    patch.current_period_start = unixToIso(input.currentPeriodStart);
  }
  if (input.currentPeriodEnd !== undefined) {
    patch.current_period_end = unixToIso(input.currentPeriodEnd);
  }
  if (input.cancelAtPeriodEnd !== undefined) {
    patch.cancel_at_period_end = input.cancelAtPeriodEnd;
  }
  if (input.canceledAt !== undefined) {
    patch.canceled_at = unixToIso(input.canceledAt);
  }
  if (input.eventCreated != null) {
    patch.last_stripe_event_at = new Date(input.eventCreated * 1000).toISOString();
  }

  const { error } = await db.from('user_subscriptions').update(patch).eq('user_id', input.userId);
  if (error) throw new Error(error.message);

  const entHasAccess = mapped === 'active' || mapped === 'grace_period';
  if (entHasAccess) await onAccessGranted(db, input.userId);
  else if (mapped === 'expired') await onAccessRevoked(db, input.userId);

  logSafe('[billing-webhook]', {
    userIdPrefix: `${input.userId.slice(0, 8)}…`,
    status: mapped,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? null,
  });
  return 'applied';
}

async function shouldApplyStripeEvent(
  db: SupabaseClient,
  userId: string,
  eventCreated?: number | null,
): Promise<boolean> {
  if (eventCreated == null) return true;
  const { data, error } = await db
    .from('user_subscriptions')
    .select('last_stripe_event_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const prev = data?.last_stripe_event_at ? new Date(String(data.last_stripe_event_at)).getTime() : null;
  if (prev == null || !Number.isFinite(prev)) return true;
  return eventCreated * 1000 >= prev;
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
  eventCreated?: number | null,
): Promise<'applied' | 'ignored_stale'> {
  if (!(await shouldApplyStripeEvent(db, userId, eventCreated))) {
    return 'ignored_stale';
  }
  const graceEnds = new Date(Date.now() + GRACE_DAYS * 86_400_000).toISOString();
  const patch: Record<string, unknown> = {
    status: 'grace_period',
    grace_period_ends_at: graceEnds,
    updated_at: new Date().toISOString(),
  };
  if (eventCreated != null) {
    patch.last_stripe_event_at = new Date(eventCreated * 1000).toISOString();
  }
  await db.from('user_subscriptions').update(patch).eq('user_id', userId);
  logSafe('[billing-webhook]', {
    userIdPrefix: `${userId.slice(0, 8)}…`,
    status: 'grace_period',
  });
  return 'applied';
}

export async function applySubscriptionDeleted(
  db: SupabaseClient,
  userId: string,
  eventCreated?: number | null,
): Promise<'applied' | 'ignored_stale'> {
  if (!(await shouldApplyStripeEvent(db, userId, eventCreated))) {
    return 'ignored_stale';
  }
  const patch: Record<string, unknown> = {
    status: 'expired',
    billing_subscription_id: null,
    cancel_at_period_end: false,
    updated_at: new Date().toISOString(),
  };
  if (eventCreated != null) {
    patch.last_stripe_event_at = new Date(eventCreated * 1000).toISOString();
  }
  await db.from('user_subscriptions').update(patch).eq('user_id', userId);
  await onAccessRevoked(db, userId);
  logSafe('[billing-webhook]', {
    userIdPrefix: `${userId.slice(0, 8)}…`,
    status: 'expired',
  });
  return 'applied';
}

/**
 * App Store / Play Billing via RevenueCat webhook.
 * Does not create a second trial — Both trial remains internal until purchase.
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
