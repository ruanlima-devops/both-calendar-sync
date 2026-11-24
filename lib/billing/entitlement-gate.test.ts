import { describe, expect, it } from 'vitest';
import { computeEntitlement } from '@/lib/billing/entitlement';
import type { SubscriptionRecord } from '@/lib/billing/entitlement';
import {
  entitlementAfterLogout,
  isEntitlementExemptPath,
  resolveEntitlementRedirect,
  shouldShowActiveSubscriptionNotice,
} from '@/lib/billing/entitlement-gate';

const expiredSub: SubscriptionRecord = {
  plan_id: 'unify_pro',
  status: 'expired',
  trial_started_at: '2026-07-01T00:00:00.000Z',
  trial_ends_at: '2026-07-15T00:00:00.000Z',
  current_period_start: null,
  current_period_end: null,
  cancel_at_period_end: false,
  canceled_at: '2026-07-15T00:00:00.000Z',
  grace_period_ends_at: null,
  billing_provider: 'stripe',
};

describe('entitlement gate routing', () => {
  it('marks paywall/settings/billing as exempt', () => {
    expect(isEntitlementExemptPath('(app)/paywall')).toBe(true);
    expect(isEntitlementExemptPath('(app)/(tabs)/settings')).toBe(true);
    expect(isEntitlementExemptPath('(app)/billing/success')).toBe(true);
    expect(isEntitlementExemptPath('(app)/(tabs)/calendars')).toBe(false);
  });

  it('redirects expired users from /calendars to /paywall', () => {
    const ent = computeEntitlement(expiredSub, new Date('2026-08-01T00:00:00.000Z'));
    expect(ent.hasAccess).toBe(false);
    expect(resolveEntitlementRedirect(ent, '(app)/(tabs)/calendars')).toBe('/(app)/paywall');
  });

  it('keeps expired users on paywall without bounce loop', () => {
    const ent = computeEntitlement(null);
    expect(resolveEntitlementRedirect(ent, '(app)/paywall')).toBeNull();
  });

  it('restores session with persisted expired subscription still blocked', () => {
    const first = computeEntitlement(expiredSub, new Date('2026-08-01T00:00:00.000Z'));
    const restored = computeEntitlement(expiredSub, new Date('2026-08-02T00:00:00.000Z'));
    expect(first.hasAccess).toBe(false);
    expect(restored.hasAccess).toBe(false);
    expect(resolveEntitlementRedirect(restored, '(app)/(tabs)')).toBe('/(app)/paywall');
  });

  it('canceled query alone does not grant access (no entitlement bypass)', () => {
    const ent = computeEntitlement(expiredSub, new Date('2026-07-20T00:00:00.000Z'));
    expect(ent.hasAccess).toBe(false);
    // UI may show checkoutCanceledNotice, but gate still redirects from calendars.
    expect(resolveEntitlementRedirect(ent, '(app)/(tabs)/calendars')).toBe('/(app)/paywall');
    expect(shouldShowActiveSubscriptionNotice(ent)).toBe(false);
  });

  it('leaves paywall after active subscription (post-checkout)', () => {
    const ent = computeEntitlement(
      {
        ...expiredSub,
        status: 'active',
        canceled_at: null,
        current_period_end: '2026-09-01T00:00:00.000Z',
      },
      new Date('2026-08-10T00:00:00.000Z'),
    );
    expect(ent.hasAccess).toBe(true);
    expect(ent.source).toBe('subscription');
    expect(shouldShowActiveSubscriptionNotice(ent)).toBe(true);
    expect(resolveEntitlementRedirect(ent, '(app)/paywall')).toBe('/(app)/(tabs)');
  });

  it('treats logout as no access', () => {
    const after = entitlementAfterLogout();
    expect(after.hasAccess).toBe(false);
    expect(resolveEntitlementRedirect(after, '(app)/(tabs)/calendars')).toBe('/(app)/paywall');
  });
});
