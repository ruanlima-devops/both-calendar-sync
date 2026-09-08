import { encryptSecret } from '../_shared/crypto/tokens.ts';
import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { env, envOptional, functionPublicUrl, logSafe } from '../_shared/http.ts';
import {
  assertMicrosoftClientId,
  calendarSecrets,
  consumeOAuthState,
  createOAuthState,
  defaultAppRedirect,
  oauthRedirectFromBody,
  oauthResultPage,
  readJsonBody,
} from '../_shared/oauth.ts';
import { inspectMicrosoftClientId, MicrosoftCalendarProvider } from '../_shared/providers/microsoft.ts';
import { requireEntitlement } from '../_shared/billing/entitlement.ts';
import {
  createPkce,
  encryptionKey,
  ensureWebhook,
  syncConnectedCalendar,
  track,
} from '../_shared/sync/runtime.ts';

function provider() {
  const clientId = env('MICROSOFT_CLIENT_ID');
  assertMicrosoftClientId(clientId);
  return new MicrosoftCalendarProvider(
    clientId,
    env('MICROSOFT_CLIENT_SECRET'),
    envOptional('MICROSOFT_TENANT') ?? 'common',
  );
}

function page(ok: boolean, redirectTo: string, error?: string): Response {
  return oauthResultPage({
    ok,
    provider: 'microsoft',
    title: ok ? 'Microsoft Calendar conectado' : 'Não foi possível conectar',
    message: ok
      ? 'Esta janela pode ser fechada.'
      : 'Não foi possível conectar sua conta Microsoft. Volte ao Both e tente novamente.',
    redirectTo,
    error,
  });
}

Deno.serve((req) =>
  handle(req, async () => {
    const url = new URL(req.url);
    const db = adminClient();
    const redirectUri = functionPublicUrl('microsoft-oauth', envOptional('MICROSOFT_REDIRECT_URI'));
    const providerError = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') ?? '';

    if (providerError || code) {
      const session = await consumeOAuthState(db, state, 'MICROSOFT');
      const fallback = session?.redirect || defaultAppRedirect();

      if (providerError === 'access_denied') {
        logSafe('[microsoft-oauth] denied', { hasSession: Boolean(session) });
        return page(false, fallback, 'access_denied');
      }
      if (providerError) {
        logSafe('[microsoft-oauth] provider_error', { error: providerError, hasSession: Boolean(session) });
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
          .eq('provider', 'MICROSOFT')
          .maybeSingle();
        const connectionId = existing?.id
          ?? (await db.from('calendar_connections').insert({
            user_id: session.userId,
            provider: 'MICROSOFT',
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

        try {
          const calendars = await provider().listCalendars(tokens.accessToken);
          logSafe('[microsoft-oauth] calendars_listed', { count: calendars.length });
          for (const cal of calendars) {
            const { data: saved } = await db.from('connected_calendars').upsert({
              user_id: session.userId,
              connection_id: connectionId,
              provider_calendar_id: cal.providerCalendarId,
              name: cal.name,
              color: cal.color ?? '#0f6cbd',
              timezone: cal.timezone ?? 'UTC',
              is_primary: cal.isPrimary,
              enabled: cal.isPrimary,
              access_role: cal.accessRole === 'reader' ? 'reader' : 'writer',
            }, { onConflict: 'connection_id,provider_calendar_id' }).select('id, enabled').single();
            if (saved?.enabled) {
              logSafe('[microsoft-sync]', { mode: 'full', calendar: saved.id });
              try {
                await syncConnectedCalendar(db, saved.id, 'initial');
              } catch (err) {
                logSafe('[microsoft-sync] initial_failed', {
                  calendar: saved.id,
                  message: err instanceof Error ? err.message : 'unknown',
                });
              }
              try { await ensureWebhook(db, saved.id); } catch (err) {
                logSafe('[microsoft-subscription] create_failed', {
                  message: err instanceof Error ? err.message : 'unknown',
                });
              }
            }
          }
        } catch (err) {
          logSafe('[microsoft-oauth] post_connect_failed', {
            message: err instanceof Error ? err.message : 'unknown',
          });
        }

        await track(db, session.userId, 'calendar_connected');
        logSafe('[microsoft-oauth] connected', { userId: session.userId });
        return page(true, session.redirect);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown';
        logSafe('[microsoft-oauth] exchange_failed', {
          message,
          redirect_path: new URL(redirectUri).pathname,
        });
        return page(false, fallback, 'token_exchange_failed');
      }
    }

    const { userId } = await userFromRequest(req);
    await requireEntitlement(db, userId);
    const clientId = env('MICROSOFT_CLIENT_ID');
    const inspect = inspectMicrosoftClientId(clientId);
    logSafe('[microsoft-oauth]', {
      client_id_valid_uuid: inspect.isUuid,
      client_secret_present: Boolean(envOptional('MICROSOFT_CLIENT_SECRET')),
      tenant: envOptional('MICROSOFT_TENANT') ?? 'common',
    });
    assertMicrosoftClientId(clientId);
    const body = await readJsonBody(req);
    const { verifier, challenge } = await createPkce();
    const redirect = oauthRedirectFromBody(body);
    const oauthState = await createOAuthState(db, {
      userId,
      provider: 'MICROSOFT',
      verifier,
      redirect,
    });
    const authorizationUrl = provider().getAuthorizationUrl({
      state: oauthState,
      codeChallenge: challenge,
      redirectUri,
    });
    logSafe('[microsoft-oauth] authorize', {
      tenant: envOptional('MICROSOFT_TENANT') ?? 'common',
      redirect_path: new URL(redirectUri).pathname,
      challenge_length: challenge.length,
      has_prompt: authorizationUrl.includes('prompt='),
    });
    return json({ authorizationUrl });
  }),
);
