import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { revokeProviderAuthorization } from '../_shared/account/oauth-revoke.ts';
import { decryptSecret } from '../_shared/crypto/tokens.ts';
import { env } from '../_shared/http.ts';
import { getValidAccessToken, providerFor } from '../_shared/sync/runtime.ts';

Deno.serve((req) =>
  handle(req, async () => {
    const { userId } = await userFromRequest(req);
    const { connectionId } = await req.json();
    if (!connectionId || typeof connectionId !== 'string') throw new Error('connection_id_required');
    const db = adminClient();
    const { data: conn } = await db
      .from('calendar_connections')
      .select('*')
      .eq('id', connectionId)
      .eq('user_id', userId)
      .single();
    if (!conn) throw new Error('UNAUTHENTICATED');
    const { data: subs } = await db.from('webhook_subscriptions').select('*').eq('connection_id', connectionId);

    let accessToken = '';
    try {
      const tokens = await getValidAccessToken(db, connectionId);
      accessToken = tokens.accessToken;
      const impl = providerFor(tokens.provider);
      for (const sub of subs ?? []) {
        try {
          await impl.deleteWebhookSubscription(accessToken, {
            externalSubscriptionId: sub.external_subscription_id,
            externalResourceId: sub.external_resource_id ?? undefined,
            expiresAt: sub.expires_at,
          });
        } catch {
          /* already expired / gone */
        }
      }
    } catch {
      /* AUTH_REQUIRED: still delete local rows */
    }

    try {
      const { data: secret } = await db
        .from('calendar_secrets')
        .select('encrypted_refresh_token')
        .eq('connection_id', connectionId)
        .maybeSingle();
      const refresh = secret?.encrypted_refresh_token
        ? await decryptSecret(String(secret.encrypted_refresh_token), env('TOKEN_ENCRYPTION_KEY'))
        : '';
      await revokeProviderAuthorization({
        provider: conn.provider,
        token: refresh || accessToken,
      });
    } catch {
      /* best-effort revoke */
    }

    await db.from('calendar_connections').delete().eq('id', connectionId).eq('user_id', userId);
    return json({ ok: true });
  }),
);
