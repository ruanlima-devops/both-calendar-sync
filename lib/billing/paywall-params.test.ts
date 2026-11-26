import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_CANCELED_MESSAGE,
  checkoutCanceledNotice,
  isCheckoutCanceled,
} from './paywall-params.ts';

describe('paywall canceled query', () => {
  it('detects canceled=1 from Stripe cancel_url', () => {
    expect(isCheckoutCanceled('1')).toBe(true);
    expect(isCheckoutCanceled('true')).toBe(true);
    expect(checkoutCanceledNotice('1')).toBe(CHECKOUT_CANCELED_MESSAGE);
  });

  it('ignores missing or unrelated values', () => {
    expect(isCheckoutCanceled(undefined)).toBe(false);
    expect(isCheckoutCanceled(null)).toBe(false);
    expect(isCheckoutCanceled('0')).toBe(false);
    expect(isCheckoutCanceled('')).toBe(false);
    expect(checkoutCanceledNotice(undefined)).toBeNull();
  });

  it('accepts expo-router array form', () => {
    expect(isCheckoutCanceled(['1'])).toBe(true);
    expect(checkoutCanceledNotice(['1'])).toBe(CHECKOUT_CANCELED_MESSAGE);
  });

  it('rejects malformed / injection-looking params', () => {
    expect(isCheckoutCanceled('1;drop table')).toBe(false);
    expect(isCheckoutCanceled('../1')).toBe(false);
    expect(isCheckoutCanceled('yes ')).toBe(true); // trimmed
    expect(checkoutCanceledNotice(['0', '1'])).toBeNull(); // first element wins
    expect(CHECKOUT_CANCELED_MESSAGE).not.toMatch(/token|secret|sk_|Bearer/i);
  });
});
