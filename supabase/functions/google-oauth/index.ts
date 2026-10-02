import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { encryptSecret } from '../_shared/crypto/tokens.ts';
import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { env, logSafe } from '../_shared/http.ts';
import {
  calendarSecrets,
  clientNonceFromBody,
  createOAuthState,
  finalizeOAuthConnection,
  handleOAuthCallback,
  oauthCallbackParams,
  oauthRedirectFromBody,
  readJsonBody,
  type CompletionContext,
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

/** Runs only after finalize verified user, client nonce, provider and ticket. */
async function connectGoogle(db: SupabaseClient, ctx: CompletionContext, redirectUri: string): Promise<void> {
  const tokens = await provider().exchangeAuthorizationCode({
    code: ctx.code,
    codeVerifier: ctx.verifier,
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
    .eq('user_id', ctx.userId)
    .eq('provider', 'GOOGLE')
    .maybeSingle();
  const connectionId = existing?.id
    ?? (await db.from('calendar_connections').insert({
      user_id: ctx.userId,
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
      user_id: ctx.userId,
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
      try {
        await syncConnectedCalendar(db, saved.id, 'initial');
      } catch (err) {
        logSafe('[google-sync] initial_failed', {
          calendar: saved.id,
          message: err instanceof Error ? err.message : 'unknown',
        });
      }
      try { await ensureWebhook(db, saved.id); } catch { /* local/dev without public webhook */ }
    }
  }
  await track(db, ctx.userId, 'calendar_connected');
  logSafe('google_oauth_connected', { userId: ctx.userId });
}

Deno.serve((req) =>
  handle(req, async () => {
    const url = new URL(req.url);
    const db = adminClient();
    const redirectUri = env('GOOGLE_REDIRECT_URI');
    const callback = oauthCallbackParams(url);

    if (callback) {
      return handleOAuthCallback(db, { callback, provider: 'GOOGLE', encryptionKey: encryptionKey() });
    }

    const { userId } = await userFromRequest(req);
    const body = await readJsonBody(req);

    if (body.action === 'finalize') {
      const result = await finalizeOAuthConnection(
        db,
        { userId, provider: 'GOOGLE', body, encryptionKey: encryptionKey() },
        (ctx) => connectGoogle(db, ctx, redirectUri),
      );
      return json(result.ok ? { ok: true, provider: 'google' } : { error: result.error }, result.status);
    }

    await requireEntitlement(db, userId);
    const clientNonce = clientNonceFromBody(body);
    const { verifier, challenge } = await createPkce();
    const redirect = oauthRedirectFromBody(body);
    const oauthState = await createOAuthState(db, {
      userId,
      provider: 'GOOGLE',
      verifier,
      redirect,
      clientNonce,
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
