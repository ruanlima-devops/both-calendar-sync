import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { randomHex } from './crypto/tokens.ts';
import { corsHeaders, envOptional, logSafe } from './http.ts';

export type OAuthProvider = 'GOOGLE' | 'MICROSOFT';

export type ConsumedOAuthState = {
  id: string;
  userId: string;
  verifier: string;
  redirect: string;
  provider: OAuthProvider;
};

const STATE_TTL_MS = 10 * 60_000;

export function oauthStates(db: SupabaseClient) {
  return db.from('oauth_states');
}

export function calendarSecrets(db: SupabaseClient) {
  return db.from('calendar_secrets');
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Current variant schemes plus legacy Unify until STAGE/PROD OAuth migration. */
const NATIVE_OAUTH_SCHEMES = ['both', 'both-dev', 'both-stg', 'unify'] as const;
// TODO(rebrand): remove legacy `unify` scheme after STAGE/PROD OAuth migration.

function isNativeOAuthRedirect(value: string): boolean {
  return NATIVE_OAUTH_SCHEMES.some(
    (scheme) =>
      value === `${scheme}://oauth` ||
      value.startsWith(`${scheme}://oauth?`) ||
      value.startsWith(`${scheme}://oauth/`),
  );
}

export function defaultAppRedirect(): string {
  const appUrl = envOptional('APP_URL');
  if (appUrl) return appUrl;
  throw new Error('invalid_oauth_redirect');
}

/** Callback return when the state (and its redirect) is unknown: the app `/oauth` route can still close a popup. */
export function defaultOAuthReturn(): string {
  return new URL('/oauth', defaultAppRedirect()).toString();
}

/** Prevent open redirects after calendar OAuth. */
export function assertSafeAppRedirect(redirect: string): string {
  const value = redirect.trim();
  if (!value) return defaultAppRedirect();

  if (isNativeOAuthRedirect(value)) {
    return value.split('#')[0]!;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('invalid_oauth_redirect');
  }

  const pathOk =
    url.pathname === '/oauth' ||
    url.pathname.endsWith('/oauth') ||
    url.pathname.includes('/oauth');

  // Expo Go / Expo Router deep links
  if (url.protocol === 'exp:' || url.protocol === 'exps:') {
    if (!pathOk) throw new Error('invalid_oauth_redirect');
    return value.split('#')[0]!;
  }

  // Local web development
  if (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  ) {
    if (!pathOk) throw new Error('invalid_oauth_redirect');
    return value.split('#')[0]!;
  }

  // Production / preview web origins from APP_URL + optional allowlist
  const allowedOrigins = new Set<string>();
  const appUrl = envOptional('APP_URL');
  if (appUrl) {
    try {
      allowedOrigins.add(new URL(appUrl).origin);
    } catch {
      /* ignore */
    }
  }
  const extra = envOptional('APP_REDIRECT_ALLOWLIST') ?? '';
  for (const part of extra.split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      allowedOrigins.add(new URL(part).origin);
    } catch {
      /* ignore invalid entries */
    }
  }

  if (url.protocol === 'https:' && allowedOrigins.has(url.origin) && pathOk) {
    return value.split('#')[0]!;
  }

  throw new Error('invalid_oauth_redirect');
}

export function oauthRedirectFromBody(body: Record<string, unknown>): string {
  const raw =
    typeof body.redirect === 'string' && body.redirect.length > 0
      ? body.redirect
      : typeof body.redirectTo === 'string' && body.redirectTo.length > 0
        ? body.redirectTo
        : defaultAppRedirect();
  return assertSafeAppRedirect(raw);
}

export function statePrefix(state: string): string {
  return state.slice(0, 8);
}

export async function createOAuthState(
  db: SupabaseClient,
  input: { userId: string; provider: OAuthProvider; verifier: string; redirect: string },
): Promise<string> {
  const state = randomHex(32);
  await oauthStates(db).delete().eq('user_id', input.userId).lt('expires_at', new Date().toISOString());
  const { error } = await oauthStates(db).insert({
    user_id: input.userId,
    provider: input.provider,
    state,
    code_verifier: input.verifier,
    redirect_to: input.redirect,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  if (error) {
    logSafe('oauth_state_insert_failed', { provider: input.provider, message: error.message });
    throw new Error('oauth_state_persist_failed');
  }
  logSafe('oauth_start', {
    provider: input.provider,
    userId: input.userId,
    statePrefix: statePrefix(state),
  });
  return state;
}

export async function consumeOAuthState(
  db: SupabaseClient,
  state: string,
  provider: OAuthProvider,
): Promise<ConsumedOAuthState | null> {
  if (!state) {
    logSafe('oauth_callback_missing_state', { provider });
    return null;
  }

  const { data: row } = await oauthStates(db).select('*').eq('state', state).maybeSingle();
  if (!row) {
    logSafe('oauth_state_lookup_miss', { provider, statePrefix: statePrefix(state) });
    return null;
  }
  if (row.provider !== provider) {
    logSafe('oauth_state_provider_mismatch', { provider, statePrefix: statePrefix(state) });
    return null;
  }
  if (row.used_at) {
    logSafe('oauth_state_replay', { provider, statePrefix: statePrefix(state) });
    return null;
  }
  if (new Date(row.expires_at as string) < new Date()) {
    logSafe('oauth_state_expired', { provider, statePrefix: statePrefix(state) });
    return null;
  }

  const { data: consumed, error } = await oauthStates(db)
    .delete()
    .eq('id', row.id)
    .eq('state', state)
    .select('id')
    .maybeSingle();
  if (error || !consumed) {
    logSafe('oauth_state_consume_failed', { provider, statePrefix: statePrefix(state) });
    return null;
  }

  logSafe('oauth_state_consumed', { provider, userId: row.user_id, statePrefix: statePrefix(state) });
  return {
    id: row.id as string,
    userId: row.user_id as string,
    verifier: row.code_verifier as string,
    redirect: (row.redirect_to as string | null) ?? defaultAppRedirect(),
    provider: row.provider as OAuthProvider,
  };
}

export type OAuthCallbackParams = { error: string | null; code: string | null; state: string };

export type OAuthCallbackError =
  | 'access_denied'
  | 'provider_error'
  | 'invalid_state'
  | 'missing_code'
  | 'token_exchange_failed';

/** Provider redirects always carry `state`, `code` or `error`; the start request carries none. */
export function oauthCallbackParams(url: URL): OAuthCallbackParams | null {
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  if (!error && !code && !url.searchParams.has('state')) return null;
  return { error, code, state: url.searchParams.get('state') ?? '' };
}

export function oauthCallbackRejection(
  params: OAuthCallbackParams,
  session: ConsumedOAuthState | null,
): OAuthCallbackError | null {
  if (params.error === 'access_denied') return 'access_denied';
  if (params.error) return 'provider_error';
  if (!session) return 'invalid_state';
  if (!params.code) return 'missing_code';
  return null;
}

/**
 * Hosted Edge Functions serve text/html as text/plain, so the callback never renders a page:
 * it always redirects to the app's /oauth route, which closes the web popup or finishes the
 * native auth session.
 */
export function oauthCallbackRedirect(input: {
  ok: boolean;
  provider: 'google' | 'microsoft';
  redirectTo: string;
  error?: OAuthCallbackError;
}): Response {
  const location = withQuery(
    input.redirectTo,
    input.ok
      ? `connected=${input.provider}`
      : `oauth_error=${input.error ?? 'provider_error'}&provider=${input.provider}`,
  );
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: location, 'Cache-Control': 'no-store' },
  });
}

export function assertMicrosoftClientId(clientId: string): void {
  const looksLikeSecret = clientId.includes('~');
  const looksLikeAppId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId);
  if (looksLikeSecret || !looksLikeAppId) {
    throw new Error(
      'MICROSOFT_CLIENT_ID deve ser o Application (client) ID, um UUID. O valor atual parece um Client Secret. Troque MICROSOFT_CLIENT_ID e MICROSOFT_CLIENT_SECRET nos secrets do Supabase.',
    );
  }
}

function withQuery(url: string, query: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}
