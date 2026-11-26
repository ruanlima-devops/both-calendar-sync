import { describe, expect, it } from 'vitest';
import {
  resolveCancelAtPeriodEnd,
  resolveSubscriptionPeriodBounds,
} from './cancel-at-period-end.ts';

describe('resolveCancelAtPeriodEnd', () => {
  it('honors explicit true', () => {
    expect(resolveCancelAtPeriodEnd({ cancel_at_period_end: true, status: 'active' })).toBe(true);
  });

  it('honors explicit false when no cancel_at schedule', () => {
    expect(resolveCancelAtPeriodEnd({ cancel_at_period_end: false, status: 'active' })).toBe(false);
  });

  it('treats cancel_at + active as scheduled cancel when boolean omitted', () => {
    expect(
      resolveCancelAtPeriodEnd({
        status: 'active',
        cancel_at: 1_766_707_200,
      }),
    ).toBe(true);
  });

  it('overrides explicit false when cancel_at schedules end (Stripe flexible billing)', () => {
    expect(
      resolveCancelAtPeriodEnd({
        status: 'active',
        cancel_at_period_end: false,
        cancel_at: 1_798_250_645,
      }),
    ).toBe(true);
  });

  it('returns undefined when neither boolean nor cancel_at schedule is present', () => {
    expect(resolveCancelAtPeriodEnd({ status: 'active' })).toBeUndefined();
    expect(resolveCancelAtPeriodEnd({ status: 'canceled' })).toBeUndefined();
  });

  it('does not infer cancel from cancel_at on already-canceled status without boolean', () => {
    // Prefer undefined so a thin deleted payload does not invent period-end semantics.
    expect(
      resolveCancelAtPeriodEnd({
        status: 'canceled',
        cancel_at: 1_766_707_200,
      }),
    ).toBeUndefined();
  });
});

describe('resolveSubscriptionPeriodBounds', () => {
  it('reads classic root period fields', () => {
    expect(
      resolveSubscriptionPeriodBounds({
        current_period_start: 100,
        current_period_end: 200,
      }),
    ).toEqual({ currentPeriodStart: 100, currentPeriodEnd: 200 });
  });

  it('falls back to first subscription item (flexible billing)', () => {
    expect(
      resolveSubscriptionPeriodBounds({
        items: {
          data: [{ current_period_start: 10, current_period_end: 1_798_250_645 }],
        },
      }),
    ).toEqual({ currentPeriodStart: 10, currentPeriodEnd: 1_798_250_645 });
  });
});
