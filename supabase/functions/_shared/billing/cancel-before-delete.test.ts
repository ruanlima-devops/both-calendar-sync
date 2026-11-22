import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDeleteBlockedError } from '../account/oauth-revoke.ts';
import { createFakeDb } from '../testing/fake-db.ts';
import { stubDenoEnv } from '../testing/fake-db.ts';
import {
  ensureStripeCanceledForAccountDelete,
  resolveBillingTargetAccount,
  stripeSubscriptionNeedsCancel,
  type StripeBillingGateway,
} from './cancel-before-delete.ts';
import { assertStripeKeyMode, stripeSecretMode } from './stripe.ts';

const USER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function billingRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: USER,
    billing_provider: 'stripe',
    billing_customer_id: 'cus_1',
    billing_subscription_id: 'sub_1',
    status: 'active',
    cancel_at_period_end: false,
    ...overrides,
  };
}

function mockStripe(overrides: Partial<StripeBillingGateway> = {}): StripeBillingGateway & {
  cancelNow: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  listByCustomer: ReturnType<typeof vi.fn>;
} {
  const cancelNow =
    (overrides.cancelNow as ReturnType<typeof vi.fn> | undefined) ??
    vi.fn(async (id: string) => ({
      id,
      customer: 'cus_1',
      status: 'canceled',
      cancel_at_period_end: false,
    }));
  const get =
    (overrides.get as ReturnType<typeof vi.fn> | undefined) ??
    vi.fn(async (id: string) => ({
      id,
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
    }));
  const listByCustomer =
    (overrides.listByCustomer as ReturnType<typeof vi.fn> | undefined) ??
    vi.fn(async () => [
      { id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false },
    ]);
  return {
    configured: overrides.configured ?? (() => true),
    assertKeyMode: overrides.assertKeyMode ?? (() => undefined),
    listByCustomer,
    get,
    cancelNow,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('stripeSubscriptionNeedsCancel', () => {
  it('treats canceled / incomplete_expired as terminal', () => {
    expect(stripeSubscriptionNeedsCancel({ status: 'canceled' })).toBe(false);
    expect(stripeSubscriptionNeedsCancel({ status: 'incomplete_expired' })).toBe(false);
  });

  it('requires cancel for active, trialing, past_due, unpaid and cancel_at_period_end', () => {
    expect(stripeSubscriptionNeedsCancel({ status: 'active' })).toBe(true);
    expect(stripeSubscriptionNeedsCancel({ status: 'trialing' })).toBe(true);
    expect(stripeSubscriptionNeedsCancel({ status: 'past_due' })).toBe(true);
    expect(stripeSubscriptionNeedsCancel({ status: 'unpaid' })).toBe(true);
    expect(stripeSubscriptionNeedsCancel({ status: 'active', cancel_at_period_end: true })).toBe(true);
  });
});

describe('assertStripeKeyMode / stripeSecretMode', () => {
  it('detects test vs live prefixes', () => {
    stubDenoEnv({ STRIPE_SECRET_KEY: 'sk_test_abc' });
    expect(stripeSecretMode()).toBe('test');
    stubDenoEnv({ STRIPE_SECRET_KEY: 'sk_live_abc', APP_ENV: 'stage' });
    expect(stripeSecretMode()).toBe('live');
    expect(() => assertStripeKeyMode()).toThrow(/live_blocked/);
    stubDenoEnv({ STRIPE_SECRET_KEY: 'sk_test_abc', APP_ENV: 'production' });
    expect(() => assertStripeKeyMode()).toThrow(/test_blocked/);
    stubDenoEnv({ STRIPE_SECRET_KEY: 'sk_test_abc', APP_ENV: 'stage' });
    expect(() => assertStripeKeyMode()).not.toThrow();
  });
});

describe('ensureStripeCanceledForAccountDelete', () => {
  it('skips when no subscription row (STG-06F path)', async () => {
    const { db } = createFakeDb({ user_subscriptions: [] });
    const stripe = mockStripe();
    const result = await ensureStripeCanceledForAccountDelete(db, USER, { stripe });
    expect(result).toEqual({ outcome: 'skipped_no_stripe', reason: 'no_subscription_row' });
    expect(stripe.cancelNow).not.toHaveBeenCalled();
  });

  it('skips internal trial without Stripe ids', async () => {
    const { db } = createFakeDb({
      user_subscriptions: [
        billingRow({
          billing_provider: 'internal',
          billing_customer_id: null,
          billing_subscription_id: null,
          status: 'trialing',
        }),
      ],
    });
    const stripe = mockStripe();
    const result = await ensureStripeCanceledForAccountDelete(db, USER, { stripe });
    expect(result.outcome).toBe('skipped_no_stripe');
    expect(stripe.cancelNow).not.toHaveBeenCalled();
  });

  it('skips customer without chargeable remote subscription', async () => {
    const { db } = createFakeDb({
      user_subscriptions: [billingRow({ billing_subscription_id: null, status: 'expired' })],
    });
    const stripe = mockStripe({
      listByCustomer: vi.fn(async () => []),
    });
    const result = await ensureStripeCanceledForAccountDelete(db, USER, { stripe });
    expect(result).toMatchObject({ outcome: 'confirmed', canceledNow: [] });
    expect(stripe.cancelNow).not.toHaveBeenCalled();
  });

  it('cancels active Stripe subscription before delete', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow({ status: 'active' })] });
    const stripe = mockStripe();
    const result = await ensureStripeCanceledForAccountDelete(db, USER, { stripe });
    expect(result.outcome).toBe('confirmed');
    if (result.outcome === 'confirmed') {
      expect(result.canceledNow).toEqual(['sub_1']);
    }
    expect(stripe.cancelNow).toHaveBeenCalledWith('sub_1', {
      idempotencyKey: `both-delete-${USER}-sub_1`,
    });
  });

  it('cancels trialing Stripe subscription', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow({ status: 'trialing' })] });
    const stripe = mockStripe({
      listByCustomer: vi.fn(async () => [
        { id: 'sub_1', customer: 'cus_1', status: 'trialing', cancel_at_period_end: false },
      ]),
    });
    await ensureStripeCanceledForAccountDelete(db, USER, { stripe });
    expect(stripe.cancelNow).toHaveBeenCalledOnce();
  });

  it('cancels past_due subscription', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow({ status: 'past_due' })] });
    const stripe = mockStripe({
      listByCustomer: vi.fn(async () => [
        { id: 'sub_1', customer: 'cus_1', status: 'past_due', cancel_at_period_end: false },
      ]),
    });
    await ensureStripeCanceledForAccountDelete(db, USER, { stripe });
    expect(stripe.cancelNow).toHaveBeenCalledOnce();
  });

  it('cancel_at_period_end still requires immediate cancel', async () => {
    const { db } = createFakeDb({
      user_subscriptions: [billingRow({ status: 'active', cancel_at_period_end: true })],
    });
    const stripe = mockStripe({
      listByCustomer: vi.fn(async () => [
        { id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: true },
      ]),
    });
    await ensureStripeCanceledForAccountDelete(db, USER, { stripe });
    expect(stripe.cancelNow).toHaveBeenCalledOnce();
  });

  it('does not cancel again when Stripe already canceled', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow({ status: 'canceled' })] });
    const stripe = mockStripe({
      listByCustomer: vi.fn(async () => [
        { id: 'sub_1', customer: 'cus_1', status: 'canceled', cancel_at_period_end: false },
      ]),
    });
    const result = await ensureStripeCanceledForAccountDelete(db, USER, { stripe });
    expect(result).toMatchObject({
      outcome: 'confirmed',
      canceledNow: [],
      alreadyTerminal: ['sub_1'],
    });
    expect(stripe.cancelNow).not.toHaveBeenCalled();
  });

  it('blocks delete when Stripe cancel fails', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow()] });
    const stripe = mockStripe({
      cancelNow: vi.fn(async () => {
        throw new Error('stripe_500');
      }),
    });
    await expect(ensureStripeCanceledForAccountDelete(db, USER, { stripe })).rejects.toMatchObject({
      message: 'stripe_cancel_failed',
    });
  });

  it('blocks delete on Stripe timeout', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow()] });
    const stripe = mockStripe({
      cancelNow: vi.fn(async () => {
        throw Object.assign(new Error('aborted'), { code: 'TIMEOUT' });
      }),
    });
    await expect(ensureStripeCanceledForAccountDelete(db, USER, { stripe })).rejects.toMatchObject({
      message: 'stripe_timeout',
    });
  });

  it('blocks on ambiguous non-terminal cancel response', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow()] });
    const stripe = mockStripe({
      cancelNow: vi.fn(async (id: string) => ({
        id,
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
      })),
      get: vi.fn(async (id: string) => ({
        id,
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
      })),
    });
    await expect(ensureStripeCanceledForAccountDelete(db, USER, { stripe })).rejects.toMatchObject({
      message: 'stripe_cancel_ambiguous',
    });
  });

  it('retry is idempotent via Idempotency-Key and terminal verify', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow()] });
    const stripe = mockStripe();
    await ensureStripeCanceledForAccountDelete(db, USER, { stripe });
    stripe.listByCustomer = vi.fn(async () => [
      { id: 'sub_1', customer: 'cus_1', status: 'canceled', cancel_at_period_end: false },
    ]);
    const second = await ensureStripeCanceledForAccountDelete(db, USER, { stripe });
    expect(second).toMatchObject({ outcome: 'confirmed', canceledNow: [] });
  });

  it('cancels multiple chargeable subscriptions for one customer', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow()] });
    const stripe = mockStripe({
      listByCustomer: vi.fn(async () => [
        { id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false },
        { id: 'sub_2', customer: 'cus_1', status: 'trialing', cancel_at_period_end: false },
      ]),
    });
    const result = await ensureStripeCanceledForAccountDelete(db, USER, { stripe });
    expect(result.outcome).toBe('confirmed');
    expect(stripe.cancelNow).toHaveBeenCalledTimes(2);
  });

  it('ignores client-injected subscription_id', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow()] });
    const stripe = mockStripe();
    await ensureStripeCanceledForAccountDelete(db, USER, {
      stripe,
      clientSubscriptionId: 'sub_attacker',
    });
    expect(stripe.cancelNow).toHaveBeenCalledWith('sub_1', expect.any(Object));
    expect(stripe.cancelNow).not.toHaveBeenCalledWith('sub_attacker', expect.anything());
  });

  it('blocks on customer mismatch', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow()] });
    const stripe = mockStripe({
      listByCustomer: vi.fn(async () => [
        { id: 'sub_1', customer: 'cus_OTHER', status: 'active', cancel_at_period_end: false },
      ]),
    });
    await expect(ensureStripeCanceledForAccountDelete(db, USER, { stripe })).rejects.toMatchObject({
      message: 'stripe_customer_mismatch',
    });
  });

  it('blocks when Stripe linked but not configured', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow()] });
    const stripe = mockStripe({ configured: () => false });
    await expect(ensureStripeCanceledForAccountDelete(db, USER, { stripe })).rejects.toMatchObject({
      message: 'stripe_not_configured',
    });
  });

  it('blocks on Stripe mode mismatch', async () => {
    const { db } = createFakeDb({ user_subscriptions: [billingRow()] });
    const stripe = mockStripe({
      assertKeyMode: () => {
        throw new Error('stripe_live_blocked_outside_production');
      },
    });
    await expect(ensureStripeCanceledForAccountDelete(db, USER, { stripe })).rejects.toMatchObject({
      message: 'stripe_mode_mismatch',
    });
  });

  it('blocks when billing DB read fails', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'db down' } }),
          }),
        }),
      }),
    } as never;
    await expect(ensureStripeCanceledForAccountDelete(db, USER, { stripe: mockStripe() })).rejects
      .toBeInstanceOf(AccountDeleteBlockedError);
  });

  it('does not log secrets', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      logs.push(String(line));
    });
    stubDenoEnv({ STRIPE_SECRET_KEY: 'sk_test_SUPERSECRET', APP_ENV: 'stage' });
    const { db } = createFakeDb({ user_subscriptions: [billingRow()] });
    await ensureStripeCanceledForAccountDelete(db, USER, { stripe: mockStripe() });
    const joined = logs.join('\n');
    expect(joined).not.toContain('SUPERSECRET');
    expect(joined).not.toContain('sk_test_');
  });
});

describe('resolveBillingTargetAccount', () => {
  it('returns exists when profile row is present', async () => {
    const { db } = createFakeDb({ profiles: [{ id: USER }] });
    await expect(resolveBillingTargetAccount(db, USER)).resolves.toEqual({
      kind: 'exists',
      userId: USER,
    });
  });

  it('returns missing when SELECT succeeds with zero rows (confirmed deleted)', async () => {
    const { db } = createFakeDb({ profiles: [] });
    await expect(resolveBillingTargetAccount(db, USER)).resolves.toEqual({
      kind: 'missing',
      userId: USER,
    });
  });

  it('throws on profile lookup error — never classifies as missing', async () => {
    const { db } = createFakeDb(
      { profiles: [{ id: USER }] },
      { selectErrors: { profiles: { message: 'connection reset', code: '57014' } } },
    );
    await expect(resolveBillingTargetAccount(db, USER)).rejects.toThrow(
      /billing_target_lookup_failed/,
    );
  });
});
