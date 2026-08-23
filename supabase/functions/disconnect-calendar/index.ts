import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { getValidAccessToken, providerFor } from '../_shared/sync/runtime.ts';

Deno.serve((req) =>
  handle(req, async () => {
    const { userId } = await userFromRequest(req);
    const { connectionId } = await req.json();
    const db = adminClient();
    const { data: conn } = await db.from('calendar_connections').select('*').eq('id', connectionId).eq('user_id', userId).single();
    if (!conn) throw new Error('UNAUTHENTICATED');
    const { data: subs } = await db.from('webhook_subscriptions').select('*').eq('connection_id', connectionId);
    try {
      const { accessToken, provider } = await getValidAccessToken(db, connectionId);
      const impl = providerFor(provider);
      for (const sub of subs ?? []) {
        try {
          await impl.deleteWebhookSubscription(accessToken, {
            externalSubscriptionId: sub.external_subscription_id,
            externalResourceId: sub.external_resource_id ?? undefined,
            expiresAt: sub.expires_at,
          });
        } catch { /* already expired */ }
      }
    } catch { /* AUTH_REQUIRED: still delete local rows */ }
    await db.from('calendar_connections').delete().eq('id', connectionId);
    return json({ ok: true });
  }),
);
