import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { logSafe } from '../_shared/http.ts';

Deno.serve((req) =>
  handle(req, async () => {
    const { userId } = await userFromRequest(req);
    const db = adminClient();

    // Calendar connections cascade to calendars/events via FK when present;
    // delete connections explicitly so encrypted secrets go away first.
    const { data: connections } = await db
      .from('calendar_connections')
      .select('id')
      .eq('user_id', userId);
    for (const conn of connections ?? []) {
      await db.from('calendar_secrets').delete().eq('connection_id', conn.id);
      await db.from('calendar_connections').delete().eq('id', conn.id);
    }

    await db.from('notifications').delete().eq('user_id', userId);
    // Keep billing_events anonymized for audit; clear PII link
    await db.from('billing_events').update({ user_id: null }).eq('user_id', userId);
    await db.from('user_subscriptions').delete().eq('user_id', userId);
    await db.from('profiles').delete().eq('id', userId);

    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);

    logSafe('account_deleted', { userId });
    return json({ ok: true });
  }),
);
