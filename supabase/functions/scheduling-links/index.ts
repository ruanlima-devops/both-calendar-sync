import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { requireEntitlement } from '../_shared/billing/entitlement.ts';
import { isValidLinkSlug, isValidUsername } from '../_shared/availability/timezone.ts';
import { track } from '../_shared/sync/runtime.ts';

type LinkBody = {
  id?: string;
  action?: 'create' | 'update' | 'delete' | 'set_username';
  slug?: string;
  title?: string;
  description?: string | null;
  durationMinutes?: number;
  destinationCalendarId?: string;
  conflictCalendarIds?: string[];
  timezone?: string;
  availabilityRules?: Array<{ weekday: number; start: string; end: string }>;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  minimumNoticeMinutes?: number;
  bookingWindowDays?: number;
  conferenceMode?: string;
  customLocation?: string | null;
  linkKind?: string;
  enabled?: boolean;
  expiresAt?: string | null;
  bookingUsername?: string;
};

function isWritableRole(role: unknown): boolean {
  const value = String(role ?? '').toLowerCase();
  return value === 'owner' || value === 'writer' || value === 'editor';
}

Deno.serve((req) =>
  handle(req, async () => {
    const { userId } = await userFromRequest(req);
    const db = adminClient();
    await requireEntitlement(db, userId);
    const method = req.method.toUpperCase();

    if (method === 'GET') {
      const [{ data: links }, { data: profile }] = await Promise.all([
        db
          .from('scheduling_links')
          .select('*, scheduling_link_calendars(connected_calendar_id)')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        db.from('profiles').select('booking_username, display_name, timezone').eq('id', userId).maybeSingle(),
      ]);
      return json({
        bookingUsername: profile?.booking_username ?? null,
        displayName: profile?.display_name ?? null,
        timezone: profile?.timezone ?? 'UTC',
        links: (links ?? []).map((row) => ({
          ...row,
          conflict_calendar_ids: (
            (row.scheduling_link_calendars as Array<{ connected_calendar_id: string }> | null) ?? []
          ).map((c) => c.connected_calendar_id),
          scheduling_link_calendars: undefined,
        })),
      });
    }

    const body = (await req.json().catch(() => ({}))) as LinkBody;

    if (body.action === 'set_username' || (method === 'POST' && body.bookingUsername && !body.title)) {
      const username = String(body.bookingUsername ?? '').trim().toLowerCase();
      if (!isValidUsername(username)) throw new Error('invalid_username');
      const { error } = await db.from('profiles').update({ booking_username: username }).eq('id', userId);
      if (error) {
        if (error.code === '23505') throw new Error('username_taken');
        throw new Error(error.message);
      }
      return json({ bookingUsername: username });
    }

    if (method === 'DELETE' || body.action === 'delete') {
      const id = body.id;
      if (!id) throw new Error('id_required');
      const { error } = await db.from('scheduling_links').delete().eq('id', id).eq('user_id', userId);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    const slug = String(body.slug ?? '').trim().toLowerCase();
    const title = String(body.title ?? '').trim();
    const destinationCalendarId = String(body.destinationCalendarId ?? '');
    const conflictCalendarIds = Array.isArray(body.conflictCalendarIds)
      ? [...new Set(body.conflictCalendarIds.map(String))]
      : [];

    if (!isValidLinkSlug(slug)) throw new Error('invalid_slug');
    if (!title) throw new Error('title_required');
    if (!destinationCalendarId) throw new Error('destination_required');
    if (conflictCalendarIds.length === 0) throw new Error('conflict_calendars_required');

    const allIds = [...new Set([destinationCalendarId, ...conflictCalendarIds])];
    const { data: cals } = await db
      .from('connected_calendars')
      .select('id, access_role')
      .eq('user_id', userId)
      .in('id', allIds);
    if (!cals || cals.length !== allIds.length) throw new Error('calendar_not_found');
    const dest = cals.find((c) => c.id === destinationCalendarId);
    if (!isWritableRole(dest?.access_role)) throw new Error('calendar_read_only');

    const duration = Number(body.durationMinutes ?? 30);
    if (!Number.isFinite(duration) || duration < 5 || duration > 480) throw new Error('invalid_duration');

    const payload = {
      user_id: userId,
      slug,
      title,
      description: body.description ?? null,
      duration_minutes: duration,
      destination_calendar_id: destinationCalendarId,
      timezone: body.timezone || 'UTC',
      availability_rules: body.availabilityRules ?? [
        { weekday: 1, start: '09:00', end: '17:00' },
        { weekday: 2, start: '09:00', end: '17:00' },
        { weekday: 3, start: '09:00', end: '17:00' },
        { weekday: 4, start: '09:00', end: '17:00' },
        { weekday: 5, start: '09:00', end: '17:00' },
      ],
      buffer_before_minutes: Number(body.bufferBeforeMinutes ?? 0),
      buffer_after_minutes: Number(body.bufferAfterMinutes ?? 0),
      minimum_notice_minutes: Number(body.minimumNoticeMinutes ?? 120),
      booking_window_days: Number(body.bookingWindowDays ?? 30),
      conference_mode: body.conferenceMode === 'custom' ? 'custom' : 'none',
      custom_location: body.conferenceMode === 'custom' ? body.customLocation ?? null : null,
      link_kind: body.linkKind === 'one_time' ? 'one_time' : 'recurring',
      enabled: body.enabled !== false,
      expires_at: body.expiresAt ?? null,
    };

    let linkId = body.id;
    if (method === 'POST' && body.action !== 'update' && !linkId) {
      const { data, error } = await db.from('scheduling_links').insert(payload).select('*').single();
      if (error) {
        if (error.code === '23505') throw new Error('slug_taken');
        throw new Error(error.message);
      }
      linkId = data.id;
      await track(db, userId, 'scheduling_link_created');
    } else {
      if (!linkId) throw new Error('id_required');
      const { error } = await db
        .from('scheduling_links')
        .update(payload)
        .eq('id', linkId)
        .eq('user_id', userId);
      if (error) {
        if (error.code === '23505') throw new Error('slug_taken');
        throw new Error(error.message);
      }
    }

    await db.from('scheduling_link_calendars').delete().eq('scheduling_link_id', linkId);
    await db.from('scheduling_link_calendars').insert(
      conflictCalendarIds.map((connected_calendar_id) => ({
        scheduling_link_id: linkId,
        connected_calendar_id,
      })),
    );

    const { data: link } = await db
      .from('scheduling_links')
      .select('*, scheduling_link_calendars(connected_calendar_id)')
      .eq('id', linkId!)
      .single();

    return json({ link });
  }),
);
