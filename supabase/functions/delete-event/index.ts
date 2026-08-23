import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { requireEntitlement } from '../_shared/billing/entitlement.ts';
import { applyIncomingEvent } from '../_shared/sync/engine.ts';
import { PostgresStore } from '../_shared/sync/postgres-store.ts';
import { getValidAccessToken, loadSyncContext, providerFor, ProviderMirrorActor } from '../_shared/sync/runtime.ts';
import { logSafe } from '../_shared/http.ts';

Deno.serve((req) =>
  handle(req, async () => {
    const { userId } = await userFromRequest(req);
    const body = await req.json();
    const db = adminClient();
    await requireEntitlement(db, userId);
    const store = new PostgresStore(db);
    const existing = await store.findById(body.eventId);
    if (!existing || existing.userId !== userId) throw new Error('UNAUTHENTICATED');
    if (existing.eventRole === 'MIRROR') throw new Error('MIRROR_MANAGED');
    if (!existing.connectionId || !existing.providerCalendarId) {
      throw new Error('EVENT_CONNECTION_MISSING');
    }

    const { ctx, calendar } = await loadSyncContext(db, existing.connectedCalendarId);
    const accessRole = String(calendar.access_role ?? '').toLowerCase();
    if (accessRole !== 'owner' && accessRole !== 'writer' && accessRole !== 'editor') {
      throw new Error('CALENDAR_READ_ONLY');
    }

    const { accessToken, provider } = await getValidAccessToken(db, existing.connectionId);
    try {
      await providerFor(provider).deleteEvent(
        accessToken,
        existing.providerCalendarId,
        existing.providerEventId,
      );
    } catch (err) {
      const status = (err as { httpStatus?: number }).httpStatus;
      if (status !== 404 && status !== 410) {
        logSafe('delete-event-provider-failed', {
          provider,
          status,
          eventId: existing.id,
          message: String(err).slice(0, 200),
        });
        throw new Error('PROVIDER_DELETE_FAILED');
      }
    }

    const result = await applyIncomingEvent(
      ctx,
      {
        providerEventId: existing.providerEventId,
        title: existing.title,
        startAt: existing.startAt,
        endAt: existing.endAt,
        timezone: existing.timezone,
        allDay: existing.allDay,
        status: 'cancelled',
        isDeleted: true,
        unifyEventRole: existing.eventRole === 'MIRROR' ? 'ORIGIN' : existing.eventRole,
        unifySyncGroupId: existing.syncGroupId ?? undefined,
      },
      store,
      new ProviderMirrorActor(db),
    );

    return json({
      event: result.stored,
      deletedMirrors: result.deletedMirrors,
      errors: result.errors,
    });
  }),
);
