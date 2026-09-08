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

export function oauthResultPage(input: {
  ok: boolean;
  provider: 'google' | 'microsoft';
  title: string;
  message: string;
  redirectTo: string;
  error?: string;
}): Response {
  const redirect = withQuery(
    input.redirectTo,
    input.ok
      ? `connected=${input.provider}`
      : `oauth_error=${input.error ?? 'oauth_failed'}&provider=${input.provider}`,
  );

  if (isWebPopupReturn(input.redirectTo)) {
    let targetOrigin = '*';
    try {
      targetOrigin = new URL(input.redirectTo).origin;
    } catch {
      /* keep wildcard fallback */
    }
    const payload = {
      type: 'unify-calendar-oauth',
      ok: input.ok,
      provider: input.provider,
      error: input.ok ? null : (input.error ?? 'oauth_failed'),
    };
    const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title>
<meta http-equiv="refresh" content="0;url=${escapeHtml(redirect)}"></head>
<body><p>${escapeHtml(input.message)}</p>
<p><a href="${escapeHtml(redirect)}">Continuar para o Both</a></p>
<script>
(function () {
  var payload = ${JSON.stringify(payload)};
  var fallback = ${JSON.stringify(redirect)};
  var targetOrigin = ${JSON.stringify(targetOrigin)};
  function notifyOpener() {
    if (!window.opener || window.opener.closed) return false;
    try {
      window.opener.postMessage(payload, targetOrigin === '*' ? '*' : targetOrigin);
      window.close();
      return true;
    } catch (e) {}
    try {
      window.opener.postMessage(payload, '*');
      window.close();
      return true;
    } catch (e2) {}
    return false;
  }
  if (!notifyOpener()) {
    window.location.replace(fallback);
  }
})();
</script></body></html>`;
    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  try {
    return Response.redirect(redirect, 302);
  } catch {
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: redirect, 'Cache-Control': 'no-store' },
    });
  }
}

function isWebPopupReturn(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === 'exp:' || parsed.protocol === 'exps:') return true;
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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
