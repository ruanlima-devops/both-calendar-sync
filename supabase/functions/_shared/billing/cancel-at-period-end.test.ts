import { describe, expect, it } from 'vitest';
import { resolveCancelAtPeriodEnd } from './cancel-at-period-end.ts';

describe('resolveCancelAtPeriodEnd', () => {
  it('honors explicit true/false', () => {
    expect(resolveCancelAtPeriodEnd({ cancel_at_period_end: true, status: 'active' })).toBe(true);
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
