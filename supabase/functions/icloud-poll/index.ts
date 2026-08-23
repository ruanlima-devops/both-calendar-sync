/**
 * Adaptive iCloud CalDAV poll worker.
 * Google/Microsoft continue to use webhooks; this only schedules due ICLOUD calendars.
 */
import { adminClient, cronAuthorized, handle, json } from '../_shared/function.ts';
import { getEntitlement } from '../_shared/billing/entitlement.ts';
import { logSafe } from '../_shared/http.ts';
import { ICLOUD_CALDAV } from '../_shared/providers/icloud/config.ts';
import { enqueueSync, processSyncJob } from '../_shared/sync/runtime.ts';

const BATCH = 25;

Deno.serve((req) =>
  handle(req, async () => {
    if (!cronAuthorized(req)) return json({ error: 'UNAUTHENTICATED' }, 401);
    const db = adminClient();
    const nowIso = new Date().toISOString();

    const { data: due } = await db
      .from('calendar_connections')
      .select('id, user_id, next_sync_at, poll_interval_seconds, consecutive_sync_failures')
      .eq('provider', 'ICLOUD')
      .in('status', ['CONNECTED', 'DEGRADED', 'SYNCING'])
      .or(`next_sync_at.is.null,next_sync_at.lte.${nowIso}`)
      .order('next_sync_at', { ascending: true, nullsFirst: true })
      .limit(BATCH);

    let enqueued = 0;
    for (const conn of due ?? []) {
      const entitlement = await getEntitlement(db, conn.user_id as string);
      if (!entitlement.hasAccess) continue;

      const { data: cals } = await db
        .from('connected_calendars')
        .select('id')
        .eq('connection_id', conn.id)
        .eq('enabled', true);

      // Lease: push next_sync_at forward so another worker won't double-pick.
      const leaseSeconds = Math.max(
        ICLOUD_CALDAV.pollMinSeconds,
        Number(conn.poll_interval_seconds ?? ICLOUD_CALDAV.pollActiveSeconds),
      );
      const jitter = Math.floor(Math.random() * 12_000);
      await db
        .from('calendar_connections')
        .update({
          next_sync_at: new Date(Date.now() + leaseSeconds * 1000 + jitter).toISOString(),
        })
        .eq('id', conn.id);

      for (const cal of cals ?? []) {
        const jobId = await enqueueSync(db, {
          userId: conn.user_id as string,
          connectionId: conn.id as string,
          calendarId: cal.id as string,
          reason: 'icloud_poll',
          dedupeKey: `icloud-poll:${cal.id}:${new Date().toISOString().slice(0, 16)}`,
        });
        void processSyncJob(db, jobId);
        enqueued += 1;
      }

      logSafe('[icloud-poll]', {
        connection: String(conn.id).slice(0, 8),
        calendars: cals?.length ?? 0,
        next_poll_at: new Date(Date.now() + leaseSeconds * 1000 + jitter).toISOString(),
      });
    }

    return json({ ok: true, enqueued, scanned: due?.length ?? 0 });
  }),
);
