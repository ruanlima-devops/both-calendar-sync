import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../testing/fake-db.ts';
import { processStripeEvent } from './stripe-webhook.ts';
import {
  applyPaymentFailed,
  claimBillingEvent,
  completeBillingEvent,
  failBillingEvent,
  resolveStripeUserId,
} from './webhook-handler.ts';

const USER_A = '081dc921-1e54-4816-9f0d-2a6a3ff4fd02';
const USER_B = '70201d99-c04c-4179-b670-0c5fdb5ec12a';

function subRow(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    user_id: USER_A,
    plan_id: 'unify_pro',
    billing_provider: 'stripe',
    billing_customer_id: 'cus_A',
    billing_subscription_id: 'sub_A',
    status: 'active',
    trial_started_at: null,
    trial_ends_at: null,
    current_period_start: null,
    current_period_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    grace_period_ends_at: null,
    last_stripe_event_at: null,
    paused_by_entitlement: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('claimBillingEvent / complete / fail', () => {
  it('claims once and treats replay as duplicate after processed', async () => {
    const { db, tables } = createFakeDb({ billing_events: [] });
    const input = {
      provider: 'stripe' as const,
      eventId: 'evt_1',
      eventType: 'checkout.session.completed',
      userId: USER_A,
      payload: { id: 'evt_1' },
    };

    expect(await claimBillingEvent(db, input)).toEqual({ kind: 'claimed', status: 'processing' });
    expect(tables.billing_events[0]?.status).toBe('processing');

    await completeBillingEvent(db, { provider: 'stripe', eventId: 'evt_1', userId: USER_A });
    expect(tables.billing_events[0]?.status).toBe('processed');
    expect(tables.billing_events[0]?.processed_at).toBeTruthy();

    expect(await claimBillingEvent(db, input)).toEqual({ kind: 'duplicate' });
  });

  it('reclaims failed events for retry after partial apply failure', async () => {
    const { db, tables } = createFakeDb({ billing_events: [] });
    const input = {
      provider: 'stripe' as const,
      eventId: 'evt_fail',
      eventType: 'invoice.payment_failed',
      payload: {},
    };

    expect((await claimBillingEvent(db, input)).kind).toBe('claimed');
    await failBillingEvent(db, { provider: 'stripe', eventId: 'evt_fail', error: 'boom' });
    expect(tables.billing_events[0]?.status).toBe('failed');
    expect(tables.billing_events[0]?.last_error).toBe('boom');

    const retry = await claimBillingEvent(db, input);
    expect(retry).toEqual({ kind: 'retry', status: 'processing' });
    expect(tables.billing_events[0]?.status).toBe('processing');
    expect(tables.billing_events[0]?.attempt_count).toBe(2);
  });

  it('concurrent second claim while processing is duplicate', async () => {
    const { db } = createFakeDb({ billing_events: [] });
    const input = {
      provider: 'stripe' as const,
      eventId: 'evt_race',
      eventType: 'customer.subscription.updated',
      payload: {},
    };
    expect((await claimBillingEvent(db, input)).kind).toBe('claimed');
    expect(await claimBillingEvent(db, input)).toEqual({ kind: 'duplicate' });
  });
});

describe('resolveStripeUserId', () => {
  it('resolves from metadata when present and valid', async () => {
    const { db } = createFakeDb({ user_subscriptions: [subRow()] });
    const result = await resolveStripeUserId(db, {
      metadataUserId: USER_A,
      customerId: null,
      subscriptionId: null,
    });
    expect(result).toEqual({ ok: true, userId: USER_A, source: 'metadata' });
  });

  it('resolves invoice without metadata via subscription id', async () => {
    const { db } = createFakeDb({ user_subscriptions: [subRow()] });
    const result = await resolveStripeUserId(db, {
      metadataUserId: null,
      customerId: 'cus_A',
      subscriptionId: 'sub_A',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.userId).toBe(USER_A);
  });

  it('resolves via customer alone when unique', async () => {
    const { db } = createFakeDb({
      user_subscriptions: [subRow({ billing_subscription_id: null })],
    });
    const result = await resolveStripeUserId(db, {
      metadataUserId: null,
      customerId: 'cus_A',
      subscriptionId: null,
    });
    expect(result).toEqual({ ok: true, userId: USER_A, source: 'customer' });
  });

  it('rejects ambiguous customer mapping across users', async () => {
    const { db } = createFakeDb({
      user_subscriptions: [
        subRow({ user_id: USER_A, billing_subscription_id: 'sub_1' }),
        subRow({ user_id: USER_B, billing_customer_id: 'cus_A', billing_subscription_id: 'sub_2' }),
      ],
    });
    const result = await resolveStripeUserId(db, {
      metadataUserId: null,
      customerId: 'cus_A',
      subscriptionId: null,
    });
    expect(result).toEqual({ ok: false, reason: 'ambiguous' });
  });

  it('rejects conflict when metadata user differs from billing ids', async () => {
    const { db } = createFakeDb({
      user_subscriptions: [subRow({ user_id: USER_A })],
    });
    const result = await resolveStripeUserId(db, {
      metadataUserId: USER_B,
      customerId: 'cus_A',
      subscriptionId: 'sub_A',
    });
    expect(result).toEqual({ ok: false, reason: 'conflict' });
  });

  it('rejects invalid metadata uuid', async () => {
    const { db } = createFakeDb({ user_subscriptions: [] });
    const result = await resolveStripeUserId(db, {
      metadataUserId: 'not-a-uuid',
      customerId: null,
      subscriptionId: null,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_metadata' });
  });

  it('returns not_found when nothing maps', async () => {
    const { db } = createFakeDb({ user_subscriptions: [subRow()] });
    const result = await resolveStripeUserId(db, {
      metadataUserId: null,
      customerId: 'cus_other',
      subscriptionId: 'sub_other',
    });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('processStripeEvent', () => {
  const profileA = { id: USER_A };
  const profileB = { id: USER_B };

  it('activates on checkout.session.completed', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA],
      user_subscriptions: [subRow({ status: 'expired', billing_customer_id: null, billing_subscription_id: null })],
      billing_events: [],
      product_events: [],
      calendar_connections: [],
    });

    const result = await processStripeEvent(db, {
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      created: 1_700_000_000,
      data: {
        object: {
          customer: 'cus_new',
          subscription: 'sub_new',
          metadata: { user_id: USER_A },
        },
      },
    });

    expect(result).toEqual({ ok: true });
    expect(tables.user_subscriptions[0]?.status).toBe('active');
    expect(tables.user_subscriptions[0]?.billing_subscription_id).toBe('sub_new');
    expect(tables.billing_events[0]?.status).toBe('processed');
    expect(tables.product_events.some((e) => e.name === 'subscription_activated')).toBe(true);
  });

  it('replays of the same event are duplicate and do not double-apply', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA],
      user_subscriptions: [subRow({ status: 'expired', billing_customer_id: null, billing_subscription_id: null })],
      billing_events: [],
      product_events: [],
      calendar_connections: [],
    });
    const event = {
      id: 'evt_dup',
      type: 'checkout.session.completed' as const,
      created: 1_700_000_100,
      data: {
        object: {
          customer: 'cus_new',
          subscription: 'sub_new',
          metadata: { user_id: USER_A },
        },
      },
    };
    expect(await processStripeEvent(db, event)).toEqual({ ok: true });
    expect(await processStripeEvent(db, event)).toEqual({ ok: true, duplicate: true });
    expect(tables.product_events.filter((e) => e.name === 'subscription_activated')).toHaveLength(1);
  });

  it('marks failed then recovers on reprocess after partial failure', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA],
      user_subscriptions: [subRow({ status: 'active' })],
      billing_events: [],
      product_events: [],
      calendar_connections: [{ id: 'c1', user_id: USER_A, paused_by_entitlement: false }],
    });

    // First pass: force apply failure by making update throw via missing table path —
    // use failBillingEvent path by processing with a spy on apply through broken user row.
    // Simulate: claim + fail manually, then successful processStripeEvent retry.
    const claim = await claimBillingEvent(db, {
      provider: 'stripe',
      eventId: 'evt_partial',
      eventType: 'customer.subscription.deleted',
      userId: USER_A,
      payload: {},
    });
    expect(claim.kind).toBe('claimed');
    await failBillingEvent(db, { provider: 'stripe', eventId: 'evt_partial', error: 'simulated_mid_apply' });
    expect(tables.billing_events[0]?.status).toBe('failed');

    const result = await processStripeEvent(db, {
      id: 'evt_partial',
      type: 'customer.subscription.deleted',
      created: 1_700_000_200,
      data: {
        object: {
          id: 'sub_A',
          customer: 'cus_A',
          metadata: { user_id: USER_A },
        },
      },
    });
    expect(result).toEqual({ ok: true });
    expect(tables.billing_events[0]?.status).toBe('processed');
    expect(tables.user_subscriptions[0]?.status).toBe('expired');
    expect(tables.user_subscriptions[0]?.billing_subscription_id).toBeNull();
  });

  it('persists cancel_at_period_end from subscription.updated', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA],
      user_subscriptions: [subRow({ status: 'active', cancel_at_period_end: false })],
      billing_events: [],
      calendar_connections: [],
    });

    const result = await processStripeEvent(db, {
      id: 'evt_cancel_period',
      type: 'customer.subscription.updated',
      created: 1_700_002_000,
      data: {
        object: {
          id: 'sub_A',
          customer: 'cus_A',
          status: 'active',
          cancel_at_period_end: true,
          current_period_end: 1_766_707_200,
          metadata: { user_id: USER_A },
        },
      },
    });
    expect(result).toEqual({ ok: true });
    expect(tables.user_subscriptions[0]?.cancel_at_period_end).toBe(true);
    expect(tables.user_subscriptions[0]?.status).toBe('active');
  });

  it('infers cancel_at_period_end from cancel_at when boolean omitted', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA],
      user_subscriptions: [subRow({ status: 'active', cancel_at_period_end: false })],
      billing_events: [],
      calendar_connections: [],
    });

    const result = await processStripeEvent(db, {
      id: 'evt_cancel_at_only',
      type: 'customer.subscription.updated',
      created: 1_700_002_100,
      data: {
        object: {
          id: 'sub_A',
          customer: 'cus_A',
          status: 'active',
          cancel_at: 1_766_707_200,
          metadata: { user_id: USER_A },
        },
      },
    });
    expect(result).toEqual({ ok: true });
    expect(tables.user_subscriptions[0]?.cancel_at_period_end).toBe(true);
  });

  it('checkout.session.completed without Stripe expand preserves existing cancel_at_period_end', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA],
      user_subscriptions: [
        subRow({
          status: 'active',
          cancel_at_period_end: true,
          billing_customer_id: 'cus_A',
          billing_subscription_id: 'sub_A',
        }),
      ],
      billing_events: [],
      product_events: [],
      calendar_connections: [],
    });

    const result = await processStripeEvent(db, {
      id: 'evt_checkout_after',
      type: 'checkout.session.completed',
      created: 1_700_003_000,
      data: {
        object: {
          customer: 'cus_A',
          subscription: 'sub_A',
          metadata: { user_id: USER_A },
        },
      },
    });
    expect(result).toEqual({ ok: true });
    expect(tables.user_subscriptions[0]?.status).toBe('active');
    expect(tables.user_subscriptions[0]?.cancel_at_period_end).toBe(true);
  });

  it('thin subscription.updated without cancel fields preserves cancel_at_period_end', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA],
      user_subscriptions: [subRow({ status: 'active', cancel_at_period_end: true })],
      billing_events: [],
      calendar_connections: [],
    });

    const result = await processStripeEvent(db, {
      id: 'evt_thin_update',
      type: 'customer.subscription.updated',
      created: 1_700_003_100,
      data: {
        object: {
          id: 'sub_A',
          customer: 'cus_A',
          status: 'active',
          metadata: { user_id: USER_A },
        },
      },
    });
    expect(result).toEqual({ ok: true });
    expect(tables.user_subscriptions[0]?.cancel_at_period_end).toBe(true);
  });

  it('applies subscription.updated and ignores stale older event (out of order)', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA],
      user_subscriptions: [
        subRow({
          status: 'active',
          last_stripe_event_at: new Date(1_700_000_500 * 1000).toISOString(),
        }),
      ],
      billing_events: [],
      calendar_connections: [],
    });

    const stale = await processStripeEvent(db, {
      id: 'evt_stale',
      type: 'customer.subscription.updated',
      created: 1_700_000_100,
      data: {
        object: {
          id: 'sub_A',
          customer: 'cus_A',
          status: 'canceled',
          metadata: { user_id: USER_A },
        },
      },
    });
    expect(stale).toEqual({ ok: true });
    expect(tables.user_subscriptions[0]?.status).toBe('active');

    const newer = await processStripeEvent(db, {
      id: 'evt_newer',
      type: 'customer.subscription.updated',
      created: 1_700_000_800,
      data: {
        object: {
          id: 'sub_A',
          customer: 'cus_A',
          status: 'past_due',
          metadata: { user_id: USER_A },
        },
      },
    });
    expect(newer).toEqual({ ok: true });
    expect(tables.user_subscriptions[0]?.status).toBe('past_due');
  });

  it('invoice.payment_failed without metadata maps via customer/subscription to grace_period', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA],
      user_subscriptions: [subRow({ status: 'active' })],
      billing_events: [],
      calendar_connections: [],
    });

    const result = await processStripeEvent(db, {
      id: 'evt_inv_fail',
      type: 'invoice.payment_failed',
      created: 1_700_001_000,
      data: {
        object: {
          id: 'in_1',
          customer: 'cus_A',
          subscription: 'sub_A',
          metadata: {},
        },
      },
    });

    expect(result).toEqual({ ok: true });
    expect(tables.user_subscriptions[0]?.status).toBe('grace_period');
    expect(tables.user_subscriptions[0]?.grace_period_ends_at).toBeTruthy();
  });

  it('invoice.payment_failed does not affect another user', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA, profileB],
      user_subscriptions: [
        subRow({ user_id: USER_A, billing_customer_id: 'cus_A', billing_subscription_id: 'sub_A', status: 'active' }),
        subRow({
          user_id: USER_B,
          billing_customer_id: 'cus_B',
          billing_subscription_id: 'sub_B',
          status: 'active',
        }),
      ],
      billing_events: [],
      calendar_connections: [],
    });

    await processStripeEvent(db, {
      id: 'evt_iso',
      type: 'invoice.payment_failed',
      created: 1_700_001_100,
      data: {
        object: {
          customer: 'cus_A',
          subscription: 'sub_A',
          metadata: {},
        },
      },
    });

    const a = tables.user_subscriptions.find((r) => r.user_id === USER_A);
    const b = tables.user_subscriptions.find((r) => r.user_id === USER_B);
    expect(a?.status).toBe('grace_period');
    expect(b?.status).toBe('active');
  });

  it('subscription.created then deleted ends expired', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA],
      user_subscriptions: [
        subRow({ status: 'expired', billing_customer_id: null, billing_subscription_id: null }),
      ],
      billing_events: [],
      product_events: [],
      calendar_connections: [{ id: 'c1', user_id: USER_A, paused_by_entitlement: true }],
    });

    await processStripeEvent(db, {
      id: 'evt_sub_created',
      type: 'customer.subscription.created',
      created: 1_700_002_000,
      data: {
        object: {
          id: 'sub_Z',
          customer: 'cus_Z',
          status: 'active',
          metadata: { user_id: USER_A },
        },
      },
    });
    expect(tables.user_subscriptions[0]?.status).toBe('active');

    await processStripeEvent(db, {
      id: 'evt_sub_deleted',
      type: 'customer.subscription.deleted',
      created: 1_700_002_100,
      data: {
        object: {
          id: 'sub_Z',
          customer: 'cus_Z',
          metadata: { user_id: USER_A },
        },
      },
    });
    expect(tables.user_subscriptions[0]?.status).toBe('expired');
    expect(tables.product_events.some((e) => e.name === 'subscription_canceled')).toBe(true);
  });

  it('BIL-05: late webhook after profile delete does not reactivate entitlement', async () => {
    const { db, tables } = createFakeDb({
      profiles: [],
      user_subscriptions: [],
      billing_events: [],
      product_events: [],
      calendar_connections: [],
    });

    const result = await processStripeEvent(db, {
      id: 'evt_late',
      type: 'customer.subscription.updated',
      created: 1_700_009_000,
      data: {
        object: {
          id: 'sub_orphan',
          customer: 'cus_orphan',
          status: 'active',
          metadata: { user_id: USER_A },
        },
      },
    });

    expect(result).toEqual({ ok: true, skipped: 'deleted_account' });
    expect(tables.user_subscriptions).toHaveLength(0);
    expect(tables.product_events).toHaveLength(0);
    expect(tables.billing_events[0]?.status).toBe('processed');
    expect(tables.billing_events[0]?.last_error).toBe('skipped_deleted_account');
  });

  it('BIL-05: profile lookup error is retryable and does not mark processed', async () => {
    const { db, tables } = createFakeDb(
      {
        profiles: [{ id: USER_A }],
        user_subscriptions: [subRow({ status: 'expired' })],
        billing_events: [],
        product_events: [],
        calendar_connections: [],
      },
      { selectErrors: { profiles: { message: 'timeout talking to db' } } },
    );

    const result = await processStripeEvent(db, {
      id: 'evt_lookup_fail',
      type: 'customer.subscription.updated',
      created: 1_700_009_100,
      data: {
        object: {
          id: 'sub_A',
          customer: 'cus_A',
          status: 'active',
          metadata: { user_id: USER_A },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.error).toMatch(/billing_target_lookup_failed/);
    }
    expect(tables.billing_events[0]?.status).toBe('failed');
    expect(tables.user_subscriptions[0]?.status).toBe('expired');
    expect(tables.product_events).toHaveLength(0);
  });

  it('BIL-05: checkout.session.completed after delete does not recreate entitlement', async () => {
    const { db, tables } = createFakeDb({
      profiles: [],
      user_subscriptions: [],
      billing_events: [],
      product_events: [],
      calendar_connections: [],
    });

    const result = await processStripeEvent(db, {
      id: 'evt_late_checkout',
      type: 'checkout.session.completed',
      created: 1_700_009_200,
      data: {
        object: {
          customer: 'cus_late',
          subscription: 'sub_late',
          metadata: { user_id: USER_A },
        },
      },
    });

    expect(result).toEqual({ ok: true, skipped: 'deleted_account' });
    expect(tables.user_subscriptions).toHaveLength(0);
    expect(tables.product_events).toHaveLength(0);
    expect(tables.billing_events[0]?.last_error).toBe('skipped_deleted_account');
  });

  it('BIL-05: subscription.deleted after delete is skipped without product_events', async () => {
    const { db, tables } = createFakeDb({
      profiles: [],
      user_subscriptions: [],
      billing_events: [],
      product_events: [],
    });
    const result = await processStripeEvent(db, {
      id: 'evt_late_deleted',
      type: 'customer.subscription.deleted',
      created: 1_700_009_300,
      data: {
        object: {
          id: 'sub_gone',
          customer: 'cus_gone',
          metadata: { user_id: USER_A },
        },
      },
    });
    expect(result).toEqual({ ok: true, skipped: 'deleted_account' });
    expect(tables.product_events).toHaveLength(0);
  });

  it('BIL-05: invoice.payment_failed after delete is skipped', async () => {
    const { db, tables } = createFakeDb({
      profiles: [],
      user_subscriptions: [],
      billing_events: [],
    });
    const result = await processStripeEvent(db, {
      id: 'evt_late_inv',
      type: 'invoice.payment_failed',
      created: 1_700_009_400,
      data: {
        object: {
          customer: 'cus_gone',
          subscription: 'sub_gone',
          metadata: { user_id: USER_A },
        },
      },
    });
    expect(result).toEqual({ ok: true, skipped: 'deleted_account' });
    expect(tables.user_subscriptions).toHaveLength(0);
  });

  it('BIL-05: invoice.paid is ignored (no entitlement write path)', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA],
      user_subscriptions: [subRow({ status: 'active' })],
      billing_events: [],
    });
    const result = await processStripeEvent(db, {
      id: 'evt_inv_paid',
      type: 'invoice.paid',
      created: 1_700_009_500,
      data: { object: { customer: 'cus_A', subscription: 'sub_A', metadata: { user_id: USER_A } } },
    });
    expect(result).toEqual({ ok: true });
    expect(tables.user_subscriptions[0]?.status).toBe('active');
    expect(tables.billing_events[0]?.status).toBe('processed');
  });

  it('BIL-05: metadata UID with no DB link and missing profile skips without recreate', async () => {
    const { db, tables } = createFakeDb({
      profiles: [],
      user_subscriptions: [],
      billing_events: [],
      product_events: [],
    });
    const result = await processStripeEvent(db, {
      id: 'evt_meta_only',
      type: 'customer.subscription.created',
      created: 1_700_009_600,
      data: {
        object: {
          id: 'sub_meta',
          customer: 'cus_meta',
          status: 'active',
          metadata: { user_id: USER_A },
        },
      },
    });
    expect(result).toEqual({ ok: true, skipped: 'deleted_account' });
    expect(tables.user_subscriptions).toHaveLength(0);
  });

  it('BIL-05: absent customer + unknown subscription does not mutate other users', async () => {
    const { db, tables } = createFakeDb({
      profiles: [profileA, profileB],
      user_subscriptions: [
        subRow({ user_id: USER_A, status: 'active' }),
        subRow({
          user_id: USER_B,
          billing_customer_id: 'cus_B',
          billing_subscription_id: 'sub_B',
          status: 'active',
        }),
      ],
      billing_events: [],
    });
    const result = await processStripeEvent(db, {
      id: 'evt_no_customer',
      type: 'customer.subscription.updated',
      created: 1_700_009_700,
      data: {
        object: {
          id: 'sub_unknown',
          customer: null,
          status: 'canceled',
          metadata: {},
        },
      },
    });
    expect(result).toEqual({ ok: true });
    expect(tables.user_subscriptions.find((r) => r.user_id === USER_A)?.status).toBe('active');
    expect(tables.user_subscriptions.find((r) => r.user_id === USER_B)?.status).toBe('active');
  });

  it('BIL-05: late skipped event replay is duplicate (no infinite retry)', async () => {
    const { db, tables } = createFakeDb({
      profiles: [],
      user_subscriptions: [],
      billing_events: [],
      product_events: [],
    });
    const event = {
      id: 'evt_late_dup',
      type: 'customer.subscription.updated' as const,
      created: 1_700_009_800,
      data: {
        object: {
          id: 'sub_orphan',
          customer: 'cus_orphan',
          status: 'active',
          metadata: { user_id: USER_A },
        },
      },
    };
    expect(await processStripeEvent(db, event)).toEqual({
      ok: true,
      skipped: 'deleted_account',
    });
    expect(await processStripeEvent(db, event)).toEqual({ ok: true, duplicate: true });
    expect(tables.billing_events).toHaveLength(1);
    expect(tables.billing_events[0]?.status).toBe('processed');
  });

  it('BIL-05: logs for skipped deleted account do not include full UID', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const { db } = createFakeDb({
      profiles: [],
      user_subscriptions: [],
      billing_events: [],
      product_events: [],
    });
    await processStripeEvent(db, {
      id: 'evt_log_safe',
      type: 'checkout.session.completed',
      created: 1_700_009_900,
      data: {
        object: {
          customer: 'cus_x',
          subscription: 'sub_x',
          metadata: { user_id: USER_A },
        },
      },
    });
    const joined = lines.join('\n');
    expect(joined).toContain('skipped_deleted_account');
    expect(joined).not.toContain(USER_A);
    expect(joined).toContain(`${USER_A.slice(0, 8)}…`);
  });
});

describe('applyPaymentFailed policy', () => {
  it('sets grace_period', async () => {
    const { db, tables } = createFakeDb({
      user_subscriptions: [subRow({ status: 'active' })],
    });
    await applyPaymentFailed(db, USER_A, 1_700_003_000);
    expect(tables.user_subscriptions[0]?.status).toBe('grace_period');
  });
});
