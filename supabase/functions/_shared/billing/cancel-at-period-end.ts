/**
 * Stripe cancel semantics for webhook/reconcile patches.
 *
 * - `cancel_at_period_end: true` → renewals stop; access until period end
 * - `cancel_at` set while status is still active/trialing → scheduled cancel
 *   (some payloads omit the boolean)
 * - `undefined` → leave the local column unchanged (do not clobber)
 */

export function resolveCancelAtPeriodEnd(
  obj: Record<string, unknown>,
): boolean | undefined {
  if (typeof obj.cancel_at_period_end === 'boolean') {
    return obj.cancel_at_period_end;
  }
  const status = String(obj.status ?? '');
  if (obj.cancel_at != null && (status === 'active' || status === 'trialing')) {
    return true;
  }
  return undefined;
}
