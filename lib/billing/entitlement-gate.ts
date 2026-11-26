/**
 * Pure entitlement routing for the app group gate.
 * Keeps paywall redirect decisions deterministic and unit-testable.
 */

export type EntitlementAccess = {
  hasAccess: boolean;
  source?: 'trial' | 'subscription' | 'none';
};

/** Routes reachable without an active entitlement. */
export function isEntitlementExemptPath(path: string): boolean {
  const p = path.toLowerCase();
  return p.includes('paywall') || p.includes('settings') || p.includes('billing');
}

/**
 * Returns an in-app redirect when entitlement and path disagree.
 * - expired/no access on calendars/home → paywall
 * - active *subscription* on paywall → tabs home
 * - active *trial* may stay on paywall (upgrade / Ver planos)
 */
export function resolveEntitlementRedirect(
  entitlement: EntitlementAccess,
  path: string,
): '/(app)/paywall' | '/(app)/(tabs)' | null {
  if (!entitlement.hasAccess && !isEntitlementExemptPath(path)) {
    return '/(app)/paywall';
  }
  // Only paid subscribers leave the paywall automatically. Trial users must
  // reach /(app)/paywall from TrialBanner / "Ver planos" to start checkout.
  if (
    entitlement.hasAccess &&
    entitlement.source === 'subscription' &&
    path.toLowerCase().includes('paywall')
  ) {
    return '/(app)/(tabs)';
  }
  return null;
}

/** After checkout / restore: subscription source with access leaves paywall. */
export function shouldShowActiveSubscriptionNotice(entitlement: EntitlementAccess): boolean {
  return entitlement.hasAccess && entitlement.source === 'subscription';
}

/** Signed-out / cleared session behaves as expired for gate purposes. */
export function entitlementAfterLogout(): EntitlementAccess {
  return { hasAccess: false, source: 'none' };
}
