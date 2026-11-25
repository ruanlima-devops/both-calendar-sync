import { timingSafeEqual } from '../crypto/tokens.ts';
import { env, envOptional, logSafe } from '../http.ts';

const STRIPE_API = 'https://api.stripe.com/v1';

function secretKey(): string {
  const key = envOptional('STRIPE_SECRET_KEY');
  if (!key) throw new Error('STRIPE_NOT_CONFIGURED');
  return key;
}

export type StripeSubscriptionSnapshot = {
  id: string;
  customer: string | null;
  status: string;
  cancel_at_period_end: boolean;
};

function stripeError(body: unknown, status: number): Error {
  const message =
    (body as { error?: { message?: string } })?.error?.message ?? `stripe_${status}`;
  return Object.assign(new Error(message), { httpStatus: status });
}

async function stripeForm<T>(
  path: string,
  params: Record<string, string>,
  opts?: { idempotencyKey?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey()}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(params),
  });
  const body = await res.json();
  if (!res.ok) throw stripeError(body, res.status);
  return body as T;
}

async function stripeGet<T>(path: string): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
  });
  const body = await res.json();
  if (!res.ok) throw stripeError(body, res.status);
  return body as T;
}

async function stripeDelete<T>(
  path: string,
  opts?: { idempotencyKey?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey()}`,
  };
  if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const res = await fetch(`${STRIPE_API}${path}`, { method: 'DELETE', headers });
  const body = await res.json();
  if (!res.ok) throw stripeError(body, res.status);
  return body as T;
}

export function stripeConfigured(): boolean {
  return Boolean(envOptional('STRIPE_SECRET_KEY'));
}

/** Detect secret key mode without logging the key. */
export function stripeSecretMode(): 'test' | 'live' | 'unknown' {
  const key = envOptional('STRIPE_SECRET_KEY') ?? '';
  if (key.startsWith('sk_test_')) return 'test';
  if (key.startsWith('sk_live_')) return 'live';
  return 'unknown';
}

/**
 * Fail closed when STAGE/dev would use Live keys (or unknown prefix).
 * Production Live requires APP_ENV=production explicitly.
 */
export function assertStripeKeyMode(): void {
  const mode = stripeSecretMode();
  const appEnv = (envOptional('APP_ENV') ?? envOptional('BOTH_ENV') ?? 'stage').toLowerCase();
  if (mode === 'unknown') {
    throw Object.assign(new Error('stripe_key_mode_unknown'), { code: 'STRIPE_MODE_MISMATCH' });
  }
  if (mode === 'live' && appEnv !== 'production') {
    throw Object.assign(new Error('stripe_live_blocked_outside_production'), {
      code: 'STRIPE_MODE_MISMATCH',
    });
  }
  if (mode === 'test' && appEnv === 'production') {
    throw Object.assign(new Error('stripe_test_blocked_in_production'), {
      code: 'STRIPE_MODE_MISMATCH',
    });
  }
}

function asSubscriptionSnapshot(raw: Record<string, unknown>): StripeSubscriptionSnapshot {
  const customer =
    typeof raw.customer === 'string'
      ? raw.customer
      : raw.customer && typeof raw.customer === 'object' && typeof (raw.customer as { id?: unknown }).id === 'string'
        ? String((raw.customer as { id: string }).id)
        : null;
  return {
    id: String(raw.id ?? ''),
    customer,
    status: String(raw.status ?? ''),
    cancel_at_period_end: Boolean(raw.cancel_at_period_end),
  };
}

/** List subscriptions for a customer (all statuses; capped). */
export async function listCustomerSubscriptions(
  customerId: string,
): Promise<StripeSubscriptionSnapshot[]> {
  const qs = new URLSearchParams({
    customer: customerId,
    status: 'all',
    limit: '100',
  });
  const body = await stripeGet<{ data?: Array<Record<string, unknown>> }>(
    `/subscriptions?${qs.toString()}`,
  );
  return (body.data ?? []).map(asSubscriptionSnapshot).filter((s) => s.id);
}

export async function getSubscription(subscriptionId: string): Promise<StripeSubscriptionSnapshot> {
  const raw = await stripeGet<Record<string, unknown>>(`/subscriptions/${subscriptionId}`);
  return asSubscriptionSnapshot(raw);
}

/** Immediate cancel — prevents future renewals. Does not delete the Customer. */
export async function cancelSubscriptionImmediate(
  subscriptionId: string,
  opts?: { idempotencyKey?: string },
): Promise<StripeSubscriptionSnapshot> {
  const raw = await stripeDelete<Record<string, unknown>>(`/subscriptions/${subscriptionId}`, {
    idempotencyKey: opts?.idempotencyKey,
  });
  logSafe('[billing-cancel]', { subscriptionId, status: String(raw.status ?? '') });
  return asSubscriptionSnapshot(raw);
}

export function appUrl(): string {
  return (envOptional('APP_URL') ?? 'http://localhost:8081').replace(/\/$/, '');
}

export async function fetchPriceDisplay(priceId: string): Promise<{
  amountCents: number;
  currency: string;
  interval: string;
  formatted: string;
}> {
  const price = await stripeGet<{
    unit_amount: number;
    currency: string;
    recurring?: { interval?: string };
  }>(`/prices/${priceId}`);

  const amount = price.unit_amount ?? 0;
  const currency = (price.currency ?? 'brl').toUpperCase();
  const formatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: price.currency ?? 'brl',
  }).format(amount / 100);

  return {
    amountCents: amount,
    currency,
    interval: price.recurring?.interval ?? 'month',
    formatted: `${formatted}/${price.recurring?.interval === 'year' ? 'ano' : 'mês'}`,
  };
}

export async function createCheckoutSession(input: {
  userId: string;
  email: string;
  priceId: string;
  customerId?: string | null;
}): Promise<{ url: string; sessionId: string }> {
  const params: Record<string, string> = {
    mode: 'subscription',
    success_url: `${appUrl()}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/paywall?canceled=1`,
    'line_items[0][price]': input.priceId,
    'line_items[0][quantity]': '1',
    'metadata[user_id]': input.userId,
    'subscription_data[metadata][user_id]': input.userId,
  };

  if (input.customerId) {
    params.customer = input.customerId;
  } else if (input.email) {
    params.customer_email = input.email;
  }

  const session = await stripeForm<{ id: string; url: string }>('/checkout/sessions', params);
  logSafe('[billing-checkout]', { userId: input.userId, sessionId: session.id });
  return { url: session.url, sessionId: session.id };
}

export async function createPortalSession(customerId: string): Promise<{ url: string }> {
  const session = await stripeForm<{ url: string }>('/billing_portal/sessions', {
    customer: customerId,
    return_url: `${appUrl()}/settings`,
  });
  return { url: session.url };
}

/** Default Stripe signature age window (seconds). */
export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300;

export function parseStripeSignatureHeader(header: string): {
  timestamp: string | null;
  signatures: string[];
} {
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (!k || !v) continue;
    if (k === 't') timestamp = v;
    if (k === 'v1') signatures.push(v);
  }
  return { timestamp, signatures };
}

function hexFromBuffer(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify Stripe-Signature over the raw request body.
 * Uses timing-safe comparison; accepts any matching v1 signature in the header.
 * Secret is HMAC'd as UTF-8 bytes of the full `whsec_…` string (matches STAGE handler).
 */
export async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  options?: {
    secret?: string;
    nowMs?: number;
    toleranceSec?: number;
  },
): Promise<boolean> {
  const secret = options?.secret ?? env('STRIPE_WEBHOOK_SECRET');
  if (!signatureHeader || !payload) return false;

  const { timestamp, signatures } = parseStripeSignatureHeader(signatureHeader);
  if (!timestamp || signatures.length === 0) return false;
  if (!/^\d+$/.test(timestamp)) return false;

  const nowMs = options?.nowMs ?? Date.now();
  const tolerance = options?.toleranceSec ?? STRIPE_SIGNATURE_TOLERANCE_SEC;
  const age = Math.abs(nowMs / 1000 - Number(timestamp));
  if (age > tolerance) return false;

  const signed = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const expected = hexFromBuffer(mac);

  // Check every v1 candidate; avoid short-circuit so timing does not leak which slot matched.
  let matched = false;
  for (const signature of signatures) {
    if (timingSafeEqual(expected, signature)) matched = true;
  }
  return matched;
}

export function unixToIso(unix: number | null | undefined): string | null {
  if (!unix) return null;
  return new Date(unix * 1000).toISOString();
}
