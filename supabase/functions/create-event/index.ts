import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { requireEntitlement } from '../_shared/billing/entitlement.ts';
import { createOriginWithOptionalMirrors, loadSyncContext, ProviderMirrorActor, track } from '../_shared/sync/runtime.ts';
import { PostgresStore } from '../_shared/sync/postgres-store.ts';
import { logSafe } from '../_shared/http.ts';

function isWritableRole(role: unknown): boolean {
  const value = String(role ?? '').toLowerCase();
  return value === 'owner' || value === 'writer' || value === 'editor';
}

function sanitizeClientEventId(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length < 8) return undefined;
  // Google event ids: lowercase a-v and digits only.
  const cleaned = raw.toLowerCase().replace(/[^a-v0-9]/g, '').slice(0, 64);
  return cleaned.length >= 8 ? cleaned : undefined;
}

function validateBody(body: Record<string, unknown>): {
  connectedCalendarId: string;
  title: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  blockOtherCalendars: boolean;
  clientEventId?: string;
} {
  const connectedCalendarId = typeof body.connectedCalendarId === 'string' ? body.connectedCalendarId : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const timezone = typeof body.timezone === 'string' && body.timezone ? body.timezone : 'UTC';
  const allDay = Boolean(body.allDay);
  const startAt = typeof body.startAt === 'string' ? body.startAt : '';
  const endAt = typeof body.endAt === 'string' ? body.endAt : '';

  if (!connectedCalendarId) throw new Error('calendar_required');
  if (!title) throw new Error('title_required');
  if (!startAt || !endAt) throw new Error('time_required');
  if (!allDay && new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    throw new Error('end_before_start');
  }
  if (allDay) {
    const startDay = startAt.slice(0, 10);
    const endDay = endAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay)) throw new Error('time_required');
    if (endDay < startDay) throw new Error('end_before_start');
  }

  return {
    connectedCalendarId,
    title,
    description: typeof body.description === 'string' ? body.description : undefined,
    location: typeof body.location === 'string' ? body.location : undefined,
    startAt,
    endAt: allDay && endAt.slice(0, 10) === startAt.slice(0, 10)
      ? (() => {
          const next = new Date(`${startAt.slice(0, 10)}T12:00:00Z`);
          next.setUTCDate(next.getUTCDate() + 1);
          return `${next.toISOString().slice(0, 10)}T00:00:00.000Z`;
        })()
      : endAt,
    timezone,
    allDay,
    blockOtherCalendars: Boolean(body.blockOtherCalendars),
    clientEventId: sanitizeClientEventId(body.clientEventId ?? body.clientRequestId),
  };
}

Deno.serve((req) =>
  handle(req, async () => {
    const { userId } = await userFromRequest(req);
    const raw = await req.json().catch(() => ({}));
    const rawBody = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const body = validateBody(rawBody);
    const db = adminClient();
    await requireEntitlement(db, userId);

    const { ctx, calendar } = await loadSyncContext(db, body.connectedCalendarId);
    if (ctx.userId !== userId) throw new Error('UNAUTHENTICATED');
    if (!isWritableRole(calendar.access_role)) throw new Error('calendar_read_only');

    const providerCalendarId = String(calendar.provider_calendar_id ?? '');
    if (!providerCalendarId) throw new Error('calendar_not_found');

    // Idempotent retry: if Google id already exists locally, return it.
    if (body.clientEventId) {
      const { data: existing } = await db
        .from('calendar_events')
        .select('id, provider_event_id, title, start_at, end_at')
        .eq('connected_calendar_id', body.connectedCalendarId)
        .eq('provider_event_id', body.clientEventId)
        .maybeSingle();
      if (existing) {
        logSafe('[create-event] idempotent_hit', { userId, calendarId: body.connectedCalendarId });
        return json({ event: existing, createdMirrors: 0, errors: [], partial: false, idempotent: true });
      }
    }

    const store = new PostgresStore(db);
    const actor = new ProviderMirrorActor(db);
    const result = await createOriginWithOptionalMirrors(
      ctx,
      {
        id: body.connectedCalendarId,
        connectionId: ctx.connectionId,
        providerCalendarId,
      },
      {
        title: body.title,
        description: body.description,
        location: body.location,
        startAt: body.startAt,
        endAt: body.endAt,
        timezone: body.timezone,
        allDay: body.allDay,
        blockOtherCalendars: body.blockOtherCalendars,
        clientEventId: body.clientEventId,
        attendees: Array.isArray(rawBody.attendees)
          ? (rawBody.attendees as Array<{ email?: string; displayName?: string }>)
              .filter((a) => typeof a?.email === 'string' && a.email.includes('@'))
              .map((a) => ({ email: String(a.email), displayName: a.displayName ? String(a.displayName) : undefined }))
          : undefined,
      },
      store,
      actor,
    );

    await track(db, userId, 'event_created');
    if (body.blockOtherCalendars) await track(db, userId, 'block_others_enabled');
    logSafe('[create-event] ok', {
      userId,
      provider: ctx.provider,
      calendarId: body.connectedCalendarId,
      mirrors: result.createdMirrors,
    });

    return json({
      event: result.stored,
      createdMirrors: result.createdMirrors,
      errors: result.errors,
      partial: result.errors.length > 0,
    });
  }),
);
