import { env, envOptional, logSafe } from '../http.ts';

const STRIPE_API = 'https://api.stripe.com/v1';

function secretKey(): string {
  const key = envOptional('STRIPE_SECRET_KEY');
  if (!key) throw new Error('STRIPE_NOT_CONFIGURED');
  return key;
}

async function stripeForm<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error((body as { error?: { message?: string } }).error?.message ?? `stripe_${res.status}`);
  }
  return body as T;
}

async function stripeGet<T>(path: string): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error((body as { error?: { message?: string } }).error?.message ?? `stripe_${res.status}`);
  }
  return body as T;
}

export function stripeConfigured(): boolean {
  return Boolean(envOptional('STRIPE_SECRET_KEY'));
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

export async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
): Promise<boolean> {
  const secret = env('STRIPE_WEBHOOK_SECRET');
  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const signed = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return expected === signature;
}

export function unixToIso(unix: number | null | undefined): string | null {
  if (!unix) return null;
  return new Date(unix * 1000).toISOString();
}
