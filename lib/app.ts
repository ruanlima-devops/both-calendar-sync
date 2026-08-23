import Constants from 'expo-constants';

type Extra = {
  appScheme?: string;
  bundleIdentifier?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** Primary URL scheme for the current app variant. */
export const APP_SCHEME = extra.appScheme ?? 'both-dev';

/**
 * TODO(rebrand): remove legacy `unify` scheme after STAGE/PROD OAuth migration.
 * Native OAuth callbacks still use this scheme so existing remote allowlists keep working.
 */
export const LEGACY_APP_SCHEME = 'unify';

export const BUNDLE_ID = extra.bundleIdentifier ?? 'com.bothcalendarsync.app.dev';
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
