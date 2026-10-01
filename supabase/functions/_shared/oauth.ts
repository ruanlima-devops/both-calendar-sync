import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  decryptSecret,
  encryptSecret,
  randomHex,
  sha256Hex,
  timingSafeEqual,
  toBase64Url,
} from './crypto/tokens.ts';
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
export const TICKET_TTL_MS = 5 * 60_000;
/** base64url, at least 128 bits. */
const CLIENT_NONCE_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
/** base64url of 32 random bytes. */
const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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

/** The browser/app that starts OAuth keeps this nonce; only its hash reaches the database. */
export function clientNonceFromBody(body: Record<string, unknown>): string {
  const value = body.client_nonce;
  if (typeof value !== 'string' || !CLIENT_NONCE_PATTERN.test(value)) {
    throw new Error('invalid_client_nonce');
  }
  return value;
}

function randomTicket(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return toBase64Url(btoa(binary));
}

export async function createOAuthState(
  db: SupabaseClient,
  input: { userId: string; provider: OAuthProvider; verifier: string; redirect: string; clientNonce: string },
): Promise<string> {
  if (!CLIENT_NONCE_PATTERN.test(input.clientNonce)) throw new Error('invalid_client_nonce');
  const state = randomHex(32);
  await oauthStates(db).delete().eq('user_id', input.userId).lt('expires_at', new Date().toISOString());
  const { error } = await oauthStates(db).insert({
    user_id: input.userId,
    provider: input.provider,
    state,
    code_verifier: input.verifier,
    redirect_to: input.redirect,
    client_nonce_hash: await sha256Hex(input.clientNonce),
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

async function loadPendingState(
  db: SupabaseClient,
  state: string,
  provider: OAuthProvider,
): Promise<Record<string, unknown> | null> {
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
  return row as Record<string, unknown>;
}

/** Error/cancel callbacks: burn the state so it can never be exchanged. */
export async function consumeOAuthState(
  db: SupabaseClient,
  state: string,
  provider: OAuthProvider,
): Promise<ConsumedOAuthState | null> {
  const row = await loadPendingState(db, state, provider);
  if (!row) return null;

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

export type IssuedTicket = { ticket: string; redirect: string; userId: string };

/**
 * Successful provider callback: atomically turn the pending state into a single-use completion
 * ticket. The callback is unauthenticated, so it never exchanges the code or touches connections.
 */
export async function issueCompletionTicket(
  db: SupabaseClient,
  input: { state: string; provider: OAuthProvider; code: string; encryptionKey: string },
): Promise<IssuedTicket | null> {
  const row = await loadPendingState(db, input.state, input.provider);
  if (!row) return null;
  if (!row.client_nonce_hash) {
    logSafe('oauth_state_unbound', { provider: input.provider, statePrefix: statePrefix(input.state) });
    await oauthStates(db).delete().eq('id', row.id as string);
    return null;
  }

  const ticket = randomTicket();
  const now = Date.now();
  const ticketExpiresAt = new Date(now + TICKET_TTL_MS).toISOString();
  const { data: issued, error } = await oauthStates(db)
    .update({
      used_at: new Date(now).toISOString(),
      ticket_hash: await sha256Hex(ticket),
      encrypted_code: await encryptSecret(input.code, input.encryptionKey),
      ticket_expires_at: ticketExpiresAt,
      expires_at: ticketExpiresAt,
    })
    .eq('id', row.id as string)
    .is('used_at', null)
    .select('id')
    .maybeSingle();
  if (error || !issued) {
    logSafe('oauth_state_consume_failed', { provider: input.provider, statePrefix: statePrefix(input.state) });
    return null;
  }

  logSafe('oauth_ticket_issued', {
    provider: input.provider,
    userId: row.user_id,
    statePrefix: statePrefix(input.state),
  });
  return {
    ticket,
    redirect: (row.redirect_to as string | null) ?? defaultOAuthReturn(),
    userId: row.user_id as string,
  };
}

export type CompletionContext = { userId: string; provider: OAuthProvider; verifier: string; code: string };

export type FinalizeDenial =
  | 'invalid_ticket'
  | 'ticket_expired'
  | 'provider_mismatch'
  | 'user_mismatch'
  | 'nonce_mismatch';

/**
 * Redeem a completion ticket for the authenticated user. The ticket is deleted before any check,
 * so a denied attempt also invalidates it.
 */
export async function consumeCompletionTicket(
  db: SupabaseClient,
  input: {
    ticket: unknown;
    clientNonce: unknown;
    userId: string;
    provider: OAuthProvider;
    encryptionKey: string;
  },
): Promise<{ ok: true; context: CompletionContext } | { ok: false; reason: FinalizeDenial }> {
  const deny = (reason: FinalizeDenial) => {
    logSafe('oauth_finalize_denied', { reason, provider: input.provider, userId: input.userId });
    return { ok: false as const, reason };
  };

  if (typeof input.ticket !== 'string' || !TICKET_PATTERN.test(input.ticket)) return deny('invalid_ticket');
  const { data: row } = await oauthStates(db)
    .delete()
    .eq('ticket_hash', await sha256Hex(input.ticket))
    .select('*')
    .maybeSingle();
  if (!row) return deny('invalid_ticket');

  const expiresAt = row.ticket_expires_at ? new Date(row.ticket_expires_at as string).getTime() : 0;
  if (!(expiresAt > Date.now())) return deny('ticket_expired');
  if (row.provider !== input.provider) return deny('provider_mismatch');
  if (row.user_id !== input.userId) return deny('user_mismatch');

  const nonceOk =
    typeof input.clientNonce === 'string' &&
    CLIENT_NONCE_PATTERN.test(input.clientNonce) &&
    typeof row.client_nonce_hash === 'string' &&
    timingSafeEqual(row.client_nonce_hash, await sha256Hex(input.clientNonce));
  if (!nonceOk) return deny('nonce_mismatch');

  logSafe('oauth_ticket_redeemed', { provider: input.provider, userId: input.userId });
  return {
    ok: true,
    context: {
      userId: row.user_id as string,
      provider: row.provider as OAuthProvider,
      verifier: row.code_verifier as string,
      code: await decryptSecret(row.encrypted_code as string, input.encryptionKey),
    },
  };
}

export type FinalizeResult =
  | { ok: true; status: 200 }
  | { ok: false; status: 403 | 502; error: 'invalid_ticket' | 'token_exchange_failed' };

/** Authenticated finalize: binding checks first; only then exchange, persist, sync and watch. */
export async function finalizeOAuthConnection(
  db: SupabaseClient,
  input: {
    userId: string;
    provider: OAuthProvider;
    body: Record<string, unknown>;
    encryptionKey: string;
  },
  complete: (context: CompletionContext) => Promise<void>,
): Promise<FinalizeResult> {
  const redeemed = await consumeCompletionTicket(db, {
    ticket: input.body.ticket,
    clientNonce: input.body.client_nonce,
    userId: input.userId,
    provider: input.provider,
    encryptionKey: input.encryptionKey,
  });
  if (!redeemed.ok) return { ok: false, status: 403, error: 'invalid_ticket' };
  try {
    await complete(redeemed.context);
    return { ok: true, status: 200 };
  } catch (error) {
    logSafe('oauth_finalize_failed', {
      provider: input.provider,
      userId: input.userId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, status: 502, error: 'token_exchange_failed' };
  }
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
 * native auth session. Success carries only the opaque completion ticket.
 */
export function oauthCallbackRedirect(input: {
  provider: 'google' | 'microsoft';
  redirectTo: string;
  ticket?: string;
  error?: OAuthCallbackError;
}): Response {
  const location = withQuery(
    input.redirectTo,
    input.ticket
      ? `oauth_ticket=${input.ticket}&provider=${input.provider}`
      : `oauth_error=${input.error ?? 'provider_error'}&provider=${input.provider}`,
  );
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: location, 'Cache-Control': 'no-store' },
  });
}

/** Public provider callback: validate, then hand back a completion ticket or a safe error code. */
export async function handleOAuthCallback(
  db: SupabaseClient,
  input: { callback: OAuthCallbackParams; provider: OAuthProvider; encryptionKey: string },
): Promise<Response> {
  const { callback, provider } = input;
  const appProvider = provider === 'GOOGLE' ? 'google' : 'microsoft';
  const reject = (redirectTo: string, reason: OAuthCallbackError, hasSession: boolean) => {
    logSafe('oauth_callback_rejected', { provider, reason, providerError: callback.error, hasSession });
    return oauthCallbackRedirect({ provider: appProvider, redirectTo, error: reason });
  };

  if (callback.error || !callback.code) {
    const session = await consumeOAuthState(db, callback.state, provider);
    return reject(
      session?.redirect || defaultOAuthReturn(),
      oauthCallbackRejection(callback, session) ?? 'invalid_state',
      Boolean(session),
    );
  }

  const issued = await issueCompletionTicket(db, {
    state: callback.state,
    provider,
    code: callback.code,
    encryptionKey: input.encryptionKey,
  });
  if (!issued) return reject(defaultOAuthReturn(), 'invalid_state', false);
  return oauthCallbackRedirect({ provider: appProvider, redirectTo: issued.redirect, ticket: issued.ticket });
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
