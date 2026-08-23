/** Central app identity — keep in sync with app.config.ts */

export const APP_SCHEME = 'unify';
export const BUNDLE_ID = 'app.unify.calendar';
export const OAUTH_PATH = 'oauth';
export const AUTH_CALLBACK_PATH = 'auth/callback';

/** RevenueCat entitlement identifier (must match dashboard). */
export const RC_ENTITLEMENT_ID = 'unify_pro';

/** Store product identifiers (create in ASC / Play / RevenueCat). */
export const RC_PRODUCT_MONTHLY = 'unify_pro_monthly';

export function appPublicUrl(): string {
  return (
    process.env.EXPO_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    process.env.APP_URL?.replace(/\/$/, '') ||
    ''
  );
}
