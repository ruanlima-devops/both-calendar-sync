import { describe, expect, it } from 'vitest';
import {
  BOTH_PRO_NAME,
  BOTH_PRO_PRICE_LABEL,
  evaluateActiveLeavesPaywall,
  evaluateBillingCopy,
  evaluateExpiredRedirect,
  evaluatePriceBranding,
  fixtureExpiredSubscription,
} from '@/lib/billing/paywall-scenarios';

describe('paywall F–H local scenarios', () => {
  it('F. expired fixture redirects calendars → paywall', () => {
    const { entitlement, redirect } = evaluateExpiredRedirect();
    expect(entitlement.hasAccess).toBe(false);
    expect(entitlement.trialUrgency).toBe('expired');
    expect(redirect).toBe('/(app)/paywall');
  });

  it('G. Both Pro price branding matches certified label', () => {
    const result = evaluatePriceBranding({
      planName: BOTH_PRO_NAME,
      priceLabel: BOTH_PRO_PRICE_LABEL,
    });
    expect(result.ok).toBe(true);
  });

  it('H. billing copy is Portuguese and secret-free', () => {
    const result = evaluateBillingCopy({
      trialExpiredTitle: 'Seu período gratuito terminou',
      canceledParam: '1',
      bodySample: 'Continuar com Both · Checkout cancelado. Nenhuma cobrança foi feita.',
    });
    expect(result.ok).toBe(true);
  });

  it('H. billing copy rejects secret-shaped body samples', () => {
    const result = evaluateBillingCopy({
      trialExpiredTitle: 'Seu período gratuito terminou',
      bodySample: 'leak ' + ['sk', 'live_'].join('_'),
    });
    expect(result.ok).toBe(false);
  });

  it('active subscription leaves paywall', () => {
    expect(
      evaluateActiveLeavesPaywall({
        ...fixtureExpiredSubscription(),
        status: 'active',
        canceled_at: null,
        current_period_end: '2026-03-01T00:00:00.000Z',
      }),
    ).toBe(true);
  });
});
