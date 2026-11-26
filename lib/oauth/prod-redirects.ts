/**
 * Non-secret PROD OAuth redirect inventory.
 * Calendar paths must match Edge Function names in source.
 * Scenario C: STAGE stays on Free org; PROD targets independent org (transfer pending).
 */

export const PROD_SUPABASE_REF = 'djxulqyuafhihmuyzvvk' as const;
export const PROD_SUPABASE_HOST = `https://${PROD_SUPABASE_REF}.supabase.co` as const;

/** Current Free org hosting STAGE+PROD until transfer. */
export const STAGE_SUPABASE_ORG = 'otaqdspnjsewiymnqbmr' as const;
/** Target Free org for Scenario C PROD (created; transfer not executed). */
export const PROD_TARGET_SUPABASE_ORG = 'ufxaefwnhwzxafvajsfg' as const;

/** Proposed branded Auth/API host — inactive until Custom Domain + DNS approved. */
export const PROD_AUTH_CUSTOM_HOST = 'https://auth.bothcalendar.com' as const;
export const PROD_FRONTEND_HOST = 'https://app.bothcalendar.com' as const;

export const PROD_CALENDAR_OAUTH_FUNCTIONS = ['google-oauth', 'microsoft-oauth'] as const;

export function supabaseAuthCallback(host: string): string {
  return `${host.replace(/\/$/, '')}/auth/v1/callback`;
}

export function supabaseFunctionCallback(host: string, functionName: string): string {
  return `${host.replace(/\/$/, '')}/functions/v1/${functionName}`;
}

export function prodTechnicalRedirectInventory() {
  return {
    signInCallback: supabaseAuthCallback(PROD_SUPABASE_HOST),
    googleCalendarCallback: supabaseFunctionCallback(PROD_SUPABASE_HOST, 'google-oauth'),
    microsoftCalendarCallback: supabaseFunctionCallback(PROD_SUPABASE_HOST, 'microsoft-oauth'),
  };
}

export function prodBrandedRedirectInventory() {
  return {
    signInCallback: supabaseAuthCallback(PROD_AUTH_CUSTOM_HOST),
    googleCalendarCallback: supabaseFunctionCallback(PROD_AUTH_CUSTOM_HOST, 'google-oauth'),
    microsoftCalendarCallback: supabaseFunctionCallback(PROD_AUTH_CUSTOM_HOST, 'microsoft-oauth'),
  };
}
