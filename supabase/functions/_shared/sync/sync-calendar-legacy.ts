import { json } from '../http.ts';

/**
 * SEC-07 remediation — legacy `sync-calendar` is retired.
 *
 * Historical defects (pre-remediation):
 * - `verify_jwt=false` at the gateway
 * - `body.jobId` → `processSyncJob` with no authentication
 * - `body.calendarId` → `syncConnectedCalendar` after JWT without ownership check
 *
 * Replacements (in-repo callers already use these):
 * - User-initiated sync: `sync-now` (JWT + ownership + entitlement)
 * - Internal reconcile / stuck jobs: `reconcile-sync` (CRON_SECRET)
 * - Webhooks / OAuth: in-process `processSyncJob` / `syncConnectedCalendar`
 *
 * This handler is fail-closed: it never processes jobId, calendarId, reconcile,
 * or any client-supplied user_id. Auth material in the request is ignored.
 */
export const SYNC_CALENDAR_GONE = {
  error: 'GONE',
  code: 'SYNC_CALENDAR_DEPRECATED',
  use: {
    userSync: 'sync-now',
    internalReconcile: 'reconcile-sync',
  },
} as const;

export async function handleLegacySyncCalendar(req: Request): Promise<Response> {
  // Drain body so proxies/clients are not left hanging; never act on contents.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    await req.json().catch(() => undefined);
  }
  return json(SYNC_CALENDAR_GONE, 410);
}
