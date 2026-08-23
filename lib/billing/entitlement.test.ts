import { describe, expect, it } from 'vitest';
import { computeEntitlement, daysRemainingUntil, trialUrgency } from '@/lib/billing/entitlement';
import type { SubscriptionRecord } from '@/lib/billing/entitlement';

const base: SubscriptionRecord = {
  plan_id: 'unify_pro',
  status: 'trialing',
  trial_started_at: '2026-08-01T00:00:00.000Z',
  trial_ends_at: '2026-08-15T00:00:00.000Z',
  current_period_start: null,
  current_period_end: null,
  cancel_at_period_end: false,
  canceled_at: null,
  grace_period_ends_at: null,
  billing_provider: 'internal',
};

describe('computeEntitlement', () => {
  it('grants access during trial', () => {
    const ent = computeEntitlement(base, new Date('2026-08-10T12:00:00.000Z'));
    expect(ent.hasAccess).toBe(true);
    expect(ent.source).toBe('trial');
    expect(ent.status).toBe('trialing');
  });

  it('denies access after trial ends even if status still trialing', () => {
    const ent = computeEntitlement(base, new Date('2026-08-16T00:00:00.000Z'));
    expect(ent.hasAccess).toBe(false);
    expect(ent.trialUrgency).toBe('expired');
  });

  it('grants access for active subscription', () => {
    const ent = computeEntitlement(
      { ...base, status: 'active', trial_ends_at: null, current_period_end: '2026-09-01T00:00:00.000Z' },
      new Date('2026-08-20T00:00:00.000Z'),
    );
    expect(ent.hasAccess).toBe(true);
    expect(ent.source).toBe('subscription');
  });

  it('keeps access until period end when cancel_at_period_end', () => {
    const ent = computeEntitlement(
      {
        ...base,
        status: 'canceled',
        cancel_at_period_end: true,
        current_period_end: '2026-08-25T00:00:00.000Z',
      },
      new Date('2026-08-20T00:00:00.000Z'),
    );
    expect(ent.hasAccess).toBe(true);
  });

  it('blocks after canceled period ends', () => {
    const ent = computeEntitlement(
      {
        ...base,
        status: 'canceled',
        cancel_at_period_end: true,
        current_period_end: '2026-08-25T00:00:00.000Z',
      },
      new Date('2026-08-26T00:00:00.000Z'),
    );
    expect(ent.hasAccess).toBe(false);
  });

  it('grace period allows temporary access', () => {
    const ent = computeEntitlement(
      {
        ...base,
        status: 'grace_period',
        grace_period_ends_at: '2026-08-22T00:00:00.000Z',
      },
      new Date('2026-08-21T00:00:00.000Z'),
    );
    expect(ent.hasAccess).toBe(true);
  });
});

describe('trial does not restart on login', () => {
  it('uses persisted trial_ends_at', () => {
    const sub = { ...base, trial_ends_at: '2026-08-05T00:00:00.000Z' };
    const day1 = computeEntitlement(sub, new Date('2026-08-02T00:00:00.000Z'));
    const afterLogout = computeEntitlement(sub, new Date('2026-08-03T00:00:00.000Z'));
    expect(day1.trialEndsAt).toBe(afterLogout.trialEndsAt);
    expect(day1.hasAccess).toBe(true);
    expect(afterLogout.hasAccess).toBe(true);
  });
});

describe('trialUrgency', () => {
  it('escalates as days decrease', () => {
    expect(trialUrgency(12, true)).toBe('discrete');
    expect(trialUrgency(6, true)).toBe('visible');
    expect(trialUrgency(2, true)).toBe('urgent');
  });
});

describe('daysRemainingUntil', () => {
  it('rounds up partial days', () => {
    const days = daysRemainingUntil('2026-08-20T06:00:00.000Z', new Date('2026-08-19T12:00:00.000Z'));
    expect(days).toBe(1);
  });
});
