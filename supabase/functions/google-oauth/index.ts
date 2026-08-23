import { encryptSecret } from '../_shared/crypto/tokens.ts';
import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { env, logSafe } from '../_shared/http.ts';
import {
  calendarSecrets,
  consumeOAuthState,
  createOAuthState,
  defaultAppRedirect,
  oauthRedirectFromBody,
  oauthResultPage,
  readJsonBody,
} from '../_shared/oauth.ts';
import { GoogleCalendarProvider } from '../_shared/providers/google.ts';
import { requireEntitlement } from '../_shared/billing/entitlement.ts';
import {
  createPkce,
  encryptionKey,
  ensureWebhook,
  syncConnectedCalendar,
  track,
} from '../_shared/sync/runtime.ts';

function provider() {
  return new GoogleCalendarProvider(env('GOOGLE_CLIENT_ID'), env('GOOGLE_CLIENT_SECRET'));
}

function page(ok: boolean, redirectTo: string, error?: string): Response {
  return oauthResultPage({
    ok,
    provider: 'google',
    title: ok ? 'Google Calendar conectado' : 'Não foi possível conectar',
    message: ok
      ? 'Esta janela pode ser fechada.'
      : 'Não foi possível conectar sua conta Google. Volte ao Unify e tente novamente.',
    redirectTo,
    error,
  });
}

Deno.serve((req) =>
  handle(req, async () => {
    const url = new URL(req.url);
    const db = adminClient();
    const redirectUri = env('GOOGLE_REDIRECT_URI');
    const googleError = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') ?? '';

    if (googleError || code) {
      const session = await consumeOAuthState(db, state, 'GOOGLE');
      const fallback = session?.redirect || defaultAppRedirect();

      if (googleError === 'access_denied') {
        logSafe('google_oauth_denied', { hasSession: Boolean(session) });
        return page(false, fallback, 'access_denied');
      }
      if (googleError) {
        logSafe('google_oauth_provider_error', { error: googleError, hasSession: Boolean(session) });
        return page(false, fallback, 'provider_error');
      }
      if (!session) return page(false, fallback, 'invalid_state');
      if (!code) return page(false, fallback, 'missing_code');

      try {
        const tokens = await provider().exchangeAuthorizationCode({
          code,
          codeVerifier: session.verifier,
          redirectUri,
        });
        const key = encryptionKey();
        const payload = {
          provider_account_id: tokens.accountId,
          account_email: tokens.accountEmail,
          status: 'CONNECTED',
          last_sync_error: null,
        };
        const { data: existing } = await db
          .from('calendar_connections')
          .select('id')
          .eq('user_id', session.userId)
          .eq('provider', 'GOOGLE')
          .maybeSingle();
        const connectionId = existing?.id
          ?? (await db.from('calendar_connections').insert({
            user_id: session.userId,
            provider: 'GOOGLE',
            ...payload,
          }).select('id').single()).data?.id;
        if (!connectionId) throw new Error('connection_save_failed');
        if (existing) await db.from('calendar_connections').update(payload).eq('id', connectionId);

        const { data: currentSecret } = await calendarSecrets(db)
          .select('encrypted_refresh_token')
          .eq('connection_id', connectionId)
          .maybeSingle();
        const encryptedRefresh = tokens.refreshToken
          ? await encryptSecret(tokens.refreshToken, key)
          : (currentSecret?.encrypted_refresh_token as string | undefined);
        if (!encryptedRefresh) throw new Error('missing_refresh_token');

        const { error: secretError } = await calendarSecrets(db).upsert({
          connection_id: connectionId,
          encrypted_refresh_token: encryptedRefresh,
          encrypted_access_token: await encryptSecret(tokens.accessToken, key),
          token_expires_at: tokens.expiresAt,
        });
        if (secretError) throw new Error(secretError.message);

        const calendars = await provider().listCalendars(tokens.accessToken);
        for (const cal of calendars) {
          const { data: saved } = await db.from('connected_calendars').upsert({
            user_id: session.userId,
            connection_id: connectionId,
            provider_calendar_id: cal.providerCalendarId,
            name: cal.name,
            color: cal.color ?? '#2563eb',
            timezone: cal.timezone ?? 'UTC',
            is_primary: cal.isPrimary,
            enabled: cal.isPrimary,
            access_role: ['owner', 'writer'].includes(String(cal.accessRole)) ? 'writer' : 'reader',
          }, { onConflict: 'connection_id,provider_calendar_id' }).select('id, enabled').single();
          if (saved?.enabled) {
            await syncConnectedCalendar(db, saved.id, 'initial');
            try { await ensureWebhook(db, saved.id); } catch { /* local/dev without public webhook */ }
          }
        }
        await track(db, session.userId, 'calendar_connected');
        logSafe('google_oauth_connected', { userId: session.userId });
        return page(true, session.redirect);
      } catch (error) {
        logSafe('google_oauth_exchange_failed', {
          message: error instanceof Error ? error.message : 'unknown',
        });
        return page(false, fallback, 'token_exchange_failed');
      }
    }

    const { userId } = await userFromRequest(req);
    await requireEntitlement(db, userId);
    const body = await readJsonBody(req);
    const { verifier, challenge } = await createPkce();
    const redirect = oauthRedirectFromBody(body);
    const oauthState = await createOAuthState(db, {
      userId,
      provider: 'GOOGLE',
      verifier,
      redirect,
    });
    return json({
      authorizationUrl: provider().getAuthorizationUrl({
        state: oauthState,
        codeChallenge: challenge,
        redirectUri,
      }),
    });
  }),
);
