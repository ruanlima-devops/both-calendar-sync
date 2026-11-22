/**
 * Paywall query helpers — keep UI messaging deterministic and unit-testable.
 */

export const CHECKOUT_CANCELED_MESSAGE =
  'Checkout cancelado. Nenhuma cobrança foi feita. Você pode assinar quando quiser.';

/** True when Stripe (or equivalent) returned the user with canceled=1. */
export function isCheckoutCanceled(
  canceled: string | string[] | undefined | null,
): boolean {
  const raw = Array.isArray(canceled) ? canceled[0] : canceled;
  if (raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function checkoutCanceledNotice(
  canceled: string | string[] | undefined | null,
): string | null {
  return isCheckoutCanceled(canceled) ? CHECKOUT_CANCELED_MESSAGE : null;
}
