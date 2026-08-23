import { adminClient, cronAuthorized, handle, json } from '../_shared/function.ts';
import { logSafe } from '../_shared/http.ts';
import { ensureEnabledWatches, ensureWebhook } from '../_shared/sync/runtime.ts';

Deno.serve((req) =>
  handle(req, async () => {
    if (!cronAuthorized(req)) return json({ error: 'UNAUTHENTICATED' }, 401);
    const db = adminClient();
    const soon = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const { data: expiring } = await db
      .from('webhook_subscriptions')
      .select('id, connected_calendar_id')
      .eq('status', 'active')
      .lt('expires_at', soon);

    let renewed = 0;
    for (const sub of expiring ?? []) {
      if (!sub.connected_calendar_id) continue;
      try {
        await ensureWebhook(db, sub.connected_calendar_id);
        renewed += 1;
      } catch (err) {
        logSafe('[google-watch] renew_failed', {
          calendarId: sub.connected_calendar_id,
          message: err instanceof Error ? err.message : 'unknown',
        });
      }
    }

    const armed = await ensureEnabledWatches(db, {});
    logSafe('[google-watch] cron', { renewed, armed });
    return json({ renewed, armed });
  }),
);
