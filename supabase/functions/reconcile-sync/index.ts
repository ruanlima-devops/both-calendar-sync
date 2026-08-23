import { adminClient, cronAuthorized, handle, json } from '../_shared/function.ts';
import { getEntitlement, syncExpiredTrialStatus } from '../_shared/billing/entitlement.ts';
import { enqueueSync, processSyncJob } from '../_shared/sync/runtime.ts';

Deno.serve((req) =>
  handle(req, async () => {
    if (!cronAuthorized(req)) return json({ error: 'UNAUTHENTICATED' }, 401);
    const db = adminClient();

    const { data: trialing } = await db
      .from('user_subscriptions')
      .select('user_id')
      .eq('status', 'trialing');
    for (const row of trialing ?? []) {
      await syncExpiredTrialStatus(db, row.user_id as string);
    }

    const { data: stuck } = await db
      .from('sync_jobs')
      .select('id')
      .eq('status', 'pending')
      .limit(20);
    for (const job of stuck ?? []) void processSyncJob(db, job.id);
    const { data: calendars } = await db
      .from('connected_calendars')
      .select('id, connection_id, user_id, calendar_connections!inner(provider)')
      .eq('enabled', true);
    for (const cal of calendars ?? []) {
      const provider = (cal.calendar_connections as { provider?: string } | null)?.provider;
      // iCloud uses adaptive icloud-poll; keep hourly reconcile for push providers only.
      if (provider === 'ICLOUD') continue;
      const entitlement = await getEntitlement(db, cal.user_id as string);
      if (!entitlement.hasAccess) continue;
      const jobId = await enqueueSync(db, {
        userId: cal.user_id,
        connectionId: cal.connection_id,
        calendarId: cal.id,
        reason: 'reconcile',
        dedupeKey: `reconcile:${cal.id}:${new Date().toISOString().slice(0, 13)}`,
      });
      void processSyncJob(db, jobId);
    }
    return json({ ok: true });
  }),
);
