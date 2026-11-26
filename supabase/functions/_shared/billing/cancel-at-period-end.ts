/**
 * Stripe cancel semantics for webhook/reconcile patches.
 *
 * - Classic API: `cancel_at_period_end: true` → renewals stop; access until period end
 * - Flexible billing (API 2024+/2026): portal "cancel at period end" may set
 *   `cancel_at` to the period boundary while leaving `cancel_at_period_end=false`.
 *   Treat that as scheduled cancel for our boolean column.
 * - `undefined` → leave the local column unchanged (do not clobber)
 */

export function resolveCancelAtPeriodEnd(
  obj: Record<string, unknown>,
): boolean | undefined {
  const status = String(obj.status ?? '');
  const scheduledViaCancelAt =
    obj.cancel_at != null && (status === 'active' || status === 'trialing');

  if (typeof obj.cancel_at_period_end === 'boolean') {
    if (obj.cancel_at_period_end === true) return true;
    // Explicit false still yields true when Stripe scheduled via cancel_at.
    if (scheduledViaCancelAt) return true;
    return false;
  }

  if (scheduledViaCancelAt) return true;
  return undefined;
}

/** Period bounds: root fields (classic) or first subscription item (flexible billing). */
export function resolveSubscriptionPeriodBounds(obj: Record<string, unknown>): {
  currentPeriodStart: number | undefined;
  currentPeriodEnd: number | undefined;
} {
  const rootStart = typeof obj.current_period_start === 'number' ? obj.current_period_start : undefined;
  const rootEnd = typeof obj.current_period_end === 'number' ? obj.current_period_end : undefined;
  if (rootStart != null || rootEnd != null) {
    return { currentPeriodStart: rootStart, currentPeriodEnd: rootEnd };
  }

  const items = obj.items;
  const data =
    items && typeof items === 'object' && Array.isArray((items as { data?: unknown }).data)
      ? ((items as { data: Array<Record<string, unknown>> }).data)
      : [];
  const first = data[0];
  if (!first) return { currentPeriodStart: undefined, currentPeriodEnd: undefined };
  return {
    currentPeriodStart:
      typeof first.current_period_start === 'number' ? first.current_period_start : undefined,
    currentPeriodEnd:
      typeof first.current_period_end === 'number' ? first.current_period_end : undefined,
  };
}
