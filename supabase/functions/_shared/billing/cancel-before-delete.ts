import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { AccountDeleteBlockedError } from '../account/oauth-revoke.ts';
import { logSafe } from '../http.ts';
import {
  assertStripeKeyMode,
  cancelSubscriptionImmediate,
  getSubscription,
  listCustomerSubscriptions,
  stripeConfigured,
  type StripeSubscriptionSnapshot,
} from './stripe.ts';

/** Stripe statuses that cannot generate future renewals / charges. */
const TERMINAL_STATUSES = new Set(['canceled', 'incomplete_expired']);

export type StripeBillingGateway = {
  configured: () => boolean;
  assertKeyMode: () => void;
  listByCustomer: (customerId: string) => Promise<StripeSubscriptionSnapshot[]>;
  get: (subscriptionId: string) => Promise<StripeSubscriptionSnapshot>;
  cancelNow: (
    subscriptionId: string,
    opts?: { idempotencyKey?: string },
  ) => Promise<StripeSubscriptionSnapshot>;
};

export type CancelBeforeDeleteResult =
  | { outcome: 'skipped_no_stripe'; reason: string }
  | { outcome: 'confirmed'; subscriptionIds: string[]; canceledNow: string[]; alreadyTerminal: string[] };

export type LocalBillingRow = {
  billing_provider: string | null;
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
  status: string | null;
  cancel_at_period_end: boolean | null;
};

function defaultGateway(): StripeBillingGateway {
  return {
    configured: stripeConfigured,
    assertKeyMode: assertStripeKeyMode,
    listByCustomer: listCustomerSubscriptions,
    get: getSubscription,
    cancelNow: cancelSubscriptionImmediate,
  };
}

/** True when the Stripe subscription can still renew or collect payment. */
export function stripeSubscriptionNeedsCancel(sub: {
  status: string;
  cancel_at_period_end?: boolean;
}): boolean {
  const status = String(sub.status ?? '').toLowerCase();
  if (!status) return true;
  if (TERMINAL_STATUSES.has(status)) return false;
  // cancel_at_period_end still renews until period end — must cancel immediately on delete.
  return true;
}

/**
 * BIL-05: confirm Stripe subscriptions cannot charge again before irreversible Both delete.
 * - Never trusts client-supplied subscription ids.
 * - Never deletes the Stripe Customer (retention / invoices stay with Stripe).
 * - Fail-closed on Stripe errors, timeouts, ambiguous responses, or DB read failures.
 */
export async function ensureStripeCanceledForAccountDelete(
  db: SupabaseClient,
  userId: string,
  deps: {
    stripe?: StripeBillingGateway;
    /** Defense-in-depth: any body-injected id is ignored. */
    clientSubscriptionId?: unknown;
  } = {},
): Promise<CancelBeforeDeleteResult> {
  if (deps.clientSubscriptionId != null && deps.clientSubscriptionId !== '') {
    logSafe('account_delete_billing_ignored_client_sub', { userId, ignored: true });
  }

  const stripe = deps.stripe ?? defaultGateway();

  let row: LocalBillingRow | null;
  try {
    row = await loadLocalBilling(db, userId);
  } catch (err) {
    logSafe('account_delete_billing_db_unavailable', {
      userId,
      reason: err instanceof Error ? err.message : 'unknown',
    });
    throw new AccountDeleteBlockedError('billing_db_unavailable');
  }

  if (!row) {
    return { outcome: 'skipped_no_stripe', reason: 'no_subscription_row' };
  }

  const provider = String(row.billing_provider ?? '').toLowerCase();
  const customerId = row.billing_customer_id?.trim() || null;
  const localSubId = row.billing_subscription_id?.trim() || null;

  if (provider && provider !== 'stripe' && provider !== 'internal') {
    // Apple/Google store billing — not Stripe. Deletion does not call Stripe.
    return { outcome: 'skipped_no_stripe', reason: `provider_${provider}` };
  }

  if (provider !== 'stripe' && !customerId && !localSubId) {
    return { outcome: 'skipped_no_stripe', reason: 'internal_or_unlinked' };
  }

  if (!customerId && !localSubId) {
    return { outcome: 'skipped_no_stripe', reason: 'no_stripe_ids' };
  }

  if (!stripe.configured()) {
    throw new AccountDeleteBlockedError('stripe_not_configured');
  }

  try {
    stripe.assertKeyMode();
  } catch {
    throw new AccountDeleteBlockedError('stripe_mode_mismatch');
  }

  let remote: StripeSubscriptionSnapshot[] = [];
  try {
    remote = await collectRemoteSubscriptions(stripe, { customerId, localSubId });
  } catch (err) {
    throw mapStripeFailure(err);
  }

  const needsCancel = remote.filter(stripeSubscriptionNeedsCancel);
  const alreadyTerminal = remote.filter((s) => !stripeSubscriptionNeedsCancel(s)).map((s) => s.id);

  if (needsCancel.length === 0) {
    logSafe('account_delete_billing_already_terminal', {
      userId,
      count: alreadyTerminal.length,
    });
    return {
      outcome: 'confirmed',
      subscriptionIds: remote.map((s) => s.id),
      canceledNow: [],
      alreadyTerminal,
    };
  }

  const canceledNow: string[] = [];
  for (const sub of needsCancel) {
    // Customer mismatch: local customer must match remote when both known.
    if (customerId && sub.customer && sub.customer !== customerId) {
      logSafe('account_delete_billing_customer_mismatch', { userId });
      throw new AccountDeleteBlockedError('stripe_customer_mismatch');
    }

    const idempotencyKey = `both-delete-${userId}-${sub.id}`;
    let canceled: StripeSubscriptionSnapshot;
    try {
      canceled = await stripe.cancelNow(sub.id, { idempotencyKey });
    } catch (err) {
      // Idempotent: already canceled race
      if (isAlreadyCanceledError(err)) {
        const verified = await safeGet(stripe, sub.id);
        if (verified && !stripeSubscriptionNeedsCancel(verified)) {
          canceledNow.push(sub.id);
          continue;
        }
      }
      throw mapStripeFailure(err);
    }

    if (stripeSubscriptionNeedsCancel(canceled)) {
      // Ambiguous: API returned non-terminal after cancel request
      const verified = await safeGet(stripe, sub.id);
      if (!verified || stripeSubscriptionNeedsCancel(verified)) {
        throw new AccountDeleteBlockedError('stripe_cancel_ambiguous');
      }
    }
    canceledNow.push(sub.id);
  }

  logSafe('account_delete_billing_canceled', {
    userId,
    canceledCount: canceledNow.length,
    alreadyTerminal: alreadyTerminal.length,
  });

  return {
    outcome: 'confirmed',
    subscriptionIds: [...new Set([...canceledNow, ...alreadyTerminal, ...remote.map((s) => s.id)])],
    canceledNow,
    alreadyTerminal,
  };
}

async function loadLocalBilling(db: SupabaseClient, userId: string): Promise<LocalBillingRow | null> {
  const { data, error } = await db
    .from('user_subscriptions')
    .select(
      'billing_provider, billing_customer_id, billing_subscription_id, status, cancel_at_period_end',
    )
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LocalBillingRow | null) ?? null;
}

async function collectRemoteSubscriptions(
  stripe: StripeBillingGateway,
  input: { customerId: string | null; localSubId: string | null },
): Promise<StripeSubscriptionSnapshot[]> {
  const byId = new Map<string, StripeSubscriptionSnapshot>();

  if (input.customerId) {
    const listed = await stripe.listByCustomer(input.customerId);
    for (const sub of listed) byId.set(sub.id, sub);
  }

  if (input.localSubId && !byId.has(input.localSubId)) {
    try {
      const one = await stripe.get(input.localSubId);
      byId.set(one.id, one);
    } catch (err) {
      if (isAlreadyCanceledError(err) || isNotFoundError(err)) {
        // Treat missing as terminal for that id; still keep customer list.
        return [...byId.values()];
      }
      throw err;
    }
  }

  if (byId.size === 0 && input.localSubId) {
    // Customer list empty and get failed as not found → nothing chargeable.
    return [];
  }

  if (byId.size === 0 && input.customerId) {
    // Customer exists in DB but Stripe reports no subscriptions — safe.
    return [];
  }

  return [...byId.values()];
}

async function safeGet(
  stripe: StripeBillingGateway,
  subscriptionId: string,
): Promise<StripeSubscriptionSnapshot | null> {
  try {
    return await stripe.get(subscriptionId);
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

function mapStripeFailure(err: unknown): AccountDeleteBlockedError {
  if (err instanceof AccountDeleteBlockedError) return err;
  const code = (err as { code?: string }).code;
  if (code === 'TIMEOUT' || isTimeoutMessage(err)) {
    return new AccountDeleteBlockedError('stripe_timeout');
  }
  if (code === 'AMBIGUOUS') {
    return new AccountDeleteBlockedError('stripe_cancel_ambiguous');
  }
  return new AccountDeleteBlockedError('stripe_cancel_failed');
}

function isTimeoutMessage(err: unknown): boolean {
  const message = String(err instanceof Error ? err.message : err).toLowerCase();
  return message.includes('timeout') || message.includes('abort') || message.includes('network');
}

function isNotFoundError(err: unknown): boolean {
  const status = (err as { httpStatus?: number }).httpStatus;
  if (status === 404) return true;
  const message = String(err instanceof Error ? err.message : err).toLowerCase();
  return message.includes('no such subscription') || message.includes('resource_missing');
}

function isAlreadyCanceledError(err: unknown): boolean {
  const message = String(err instanceof Error ? err.message : err).toLowerCase();
  return message.includes('already been canceled') || message.includes('subscription is canceled');
}

/**
 * Webhook / delete guard: confirm whether the Both account profile still exists.
 *
 * Distinguishes:
 * - `exists` — profile row present
 * - `missing` — SELECT succeeded with zero rows (account deleted / never existed)
 *
 * SELECT / transport errors **throw** — callers must treat that as transient and
 * retry (never as a confirmed deleted account).
 */
export type BillingTargetAccountPresence =
  | { kind: 'exists'; userId: string }
  | { kind: 'missing'; userId: string };

export async function resolveBillingTargetAccount(
  db: SupabaseClient,
  userId: string,
): Promise<BillingTargetAccountPresence> {
  const { data, error } = await db.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (error) {
    throw new Error(`billing_target_lookup_failed:${error.message}`);
  }
  if (data?.id) return { kind: 'exists', userId };
  return { kind: 'missing', userId };
}

/**
 * @deprecated Prefer `resolveBillingTargetAccount` so callers cannot confuse
 * lookup failure with a deleted account. Throws on DB errors.
 */
export async function billingTargetAccountExists(
  db: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const presence = await resolveBillingTargetAccount(db, userId);
  return presence.kind === 'exists';
}
