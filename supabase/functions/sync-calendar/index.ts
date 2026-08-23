import { adminClient, cronAuthorized, handle, json, userFromRequest } from '../_shared/function.ts';
import { processSyncJob, enqueueSync, syncConnectedCalendar } from '../_shared/sync/runtime.ts';

Deno.serve((req) =>
  handle(req, async () => {
    const db = adminClient();
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    if (body.jobId) {
      await processSyncJob(db, body.jobId);
      return json({ ok: true });
    }
    if (cronAuthorized(req) && body.reconcile) {
      const { data: calendars } = await db.from('connected_calendars').select('id, connection_id, user_id').eq('enabled', true);
      for (const cal of calendars ?? []) {
        const jobId = await enqueueSync(db, {
          userId: cal.user_id,
          connectionId: cal.connection_id,
          calendarId: cal.id,
          reason: 'reconcile',
          dedupeKey: `reconcile:${cal.id}:${new Date().toISOString().slice(0, 16)}`,
        });
        void processSyncJob(db, jobId);
      }
      return json({ ok: true, queued: calendars?.length ?? 0 });
    }
    const { userId } = await userFromRequest(req);
    const calendarId = body.calendarId as string | undefined;
    if (calendarId) {
      const result = await syncConnectedCalendar(db, calendarId, body.mode === 'initial' ? 'initial' : 'auto');
      return json(result);
    }
    const { data: calendars } = await db.from('connected_calendars').select('id').eq('user_id', userId).eq('enabled', true);
    const results = [];
    for (const cal of calendars ?? []) {
      results.push(await syncConnectedCalendar(db, cal.id, 'auto'));
    }
    return json({ results });
  }),
);
