import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { requireEntitlement } from '../_shared/billing/entitlement.ts';
import {
  applyIncomingEvent,
  createMirrorsForOrigin,
  removeMirrorsForOrigin,
} from '../_shared/sync/engine.ts';
import {
  classifyRecurringKind,
  isUnsupportedRecurringMutation,
  UNSUPPORTED_RECURRING_OPERATION,
  logRecurringSkipped,
} from '../_shared/sync/recurring.ts';
import { PostgresStore } from '../_shared/sync/postgres-store.ts';
import { getValidAccessToken, loadSyncContext, providerFor, ProviderMirrorActor } from '../_shared/sync/runtime.ts';

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
    const eventKind = classifyRecurringKind({
      recurrenceRule: existing.recurrenceRule,
      recurringEventId: existing.recurringEventId,
    });
    if (isUnsupportedRecurringMutation(eventKind)) {
      logRecurringSkipped({
        provider: ctx.provider,
        operation: 'update_event',
        eventKind,
        reason: 'unsupported_recurring_mutation',
      });
      return json({ error: UNSUPPORTED_RECURRING_OPERATION, eventKind }, 422);
    }

    const accessRole = String(calendar.access_role ?? '').toLowerCase();
    if (accessRole !== 'owner' && accessRole !== 'writer' && accessRole !== 'editor') {
      throw new Error('CALENDAR_READ_ONLY');
    }

    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : existing.title;
    const descriptionValue =
      body.description !== undefined ? String(body.description ?? '') || undefined : undefined;
    const locationValue =
      body.location !== undefined ? String(body.location ?? '') || undefined : undefined;
    const startAt = typeof body.startAt === 'string' ? body.startAt : existing.startAt;
    const endAt = typeof body.endAt === 'string' ? body.endAt : existing.endAt;
    const timezone = typeof body.timezone === 'string' ? body.timezone : existing.timezone;
    const allDay = typeof body.allDay === 'boolean' ? body.allDay : existing.allDay;
    const blockOtherCalendars =
      typeof body.blockOtherCalendars === 'boolean' ? body.blockOtherCalendars : undefined;

    const { accessToken, provider } = await getValidAccessToken(db, existing.connectionId);
    await providerFor(provider).updateEvent(accessToken, existing.providerCalendarId, existing.providerEventId, {
      title,
      description: descriptionValue,
      location: locationValue,
      startAt,
      endAt,
      timezone,
      allDay,
      role: 'ORIGIN',
      syncGroupId: existing.syncGroupId ?? undefined,
    });

    const actor = new ProviderMirrorActor(db);
    const result = await applyIncomingEvent(
      ctx,
      {
        providerEventId: existing.providerEventId,
        title,
        description: descriptionValue,
        location: locationValue,
        startAt,
        endAt,
        timezone,
        allDay,
        status: 'confirmed',
        unifyEventRole: 'ORIGIN',
        unifySyncGroupId: existing.syncGroupId ?? undefined,
        recurrenceRule: existing.recurrenceRule ?? undefined,
        recurringEventId: existing.recurringEventId ?? undefined,
      },
      store,
      actor,
    );

    const stored = result.stored ?? { ...existing, title, startAt, endAt, timezone, allDay };
    const mirrors = stored.syncGroupId ? await store.listMirrors(stored.syncGroupId) : [];
    const hadActiveMirrors = mirrors.some((m) => m.status === 'confirmed' || m.status === 'tentative');

    if (blockOtherCalendars === false && hadActiveMirrors) {
      await removeMirrorsForOrigin(stored, store, actor, result);
    } else if (blockOtherCalendars === true && !hadActiveMirrors) {
      await createMirrorsForOrigin(
        { ...ctx, autoBlockOthers: true },
        stored,
        {
          providerEventId: existing.providerEventId,
          title,
          startAt,
          endAt,
          timezone,
          allDay,
          status: 'confirmed',
        },
        store,
        actor,
        result,
      );
    }

    return json({
      event: result.stored,
      updatedMirrors: result.updatedMirrors,
      createdMirrors: result.createdMirrors,
      deletedMirrors: result.deletedMirrors,
      errors: result.errors,
    });
  }),
);
