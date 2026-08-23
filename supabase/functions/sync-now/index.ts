import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { requireEntitlement } from '../_shared/billing/entitlement.ts';
import { logSafe } from '../_shared/http.ts';
import { ensureEnabledWatches, syncConnectedCalendar } from '../_shared/sync/runtime.ts';

Deno.serve((req) =>
  handle(req, async () => {
    const { userId } = await userFromRequest(req);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const db = adminClient();

    if (body.ensureWatchesOnly !== true) {
      await requireEntitlement(db, userId);
    } else {
      try {
        await requireEntitlement(db, userId);
      } catch {
        return json({ ok: true, armed: 0, skipped: 'entitlement' });
      }
    }

    let query = db
      .from('connected_calendars')
      .select('id, connection_id')
      .eq('user_id', userId)
      .eq('enabled', true);

    if (typeof body.connectionId === 'string' && body.connectionId.length > 0) {
      const { data: conn } = await db
        .from('calendar_connections')
        .select('id')
        .eq('id', body.connectionId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!conn) {
        return json({ error: 'connection_not_found' }, 404);
      }
      query = query.eq('connection_id', body.connectionId);
    }

    if (typeof body.calendarId === 'string' && body.calendarId.length > 0) {
      query = query.eq('id', body.calendarId);
    }

    const { data: calendars, error } = await query;
    if (error) throw new Error(error.message);

    if (body.ensureWatchesOnly === true) {
      const armed = await ensureEnabledWatches(db, { userId });
      return json({ ok: true, armed });
    }

    const mode = body.mode === 'initial' ? 'initial' : 'auto';
    const results: Array<{ calendarId: string; imported?: number; error?: string }> = [];

    for (const cal of calendars ?? []) {
      try {
        const synced = await syncConnectedCalendar(db, cal.id, mode);
        results.push({ calendarId: cal.id, imported: synced.imported });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'sync_failed';
        logSafe('sync_now_calendar_failed', { calendarId: cal.id, message });
        results.push({ calendarId: cal.id, error: message });
      }
    }

    const failed = results.filter((row) => row.error).length;
    logSafe('sync_now_done', { userId, synced: results.length, failed });
    return json({
      ok: failed === 0,
      synced: results.length - failed,
      failed,
      results,
    });
  }),
);
