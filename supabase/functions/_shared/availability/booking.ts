import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { requireEntitlement } from '../billing/entitlement.ts';
import { bookingConfirmationEmail } from '../email/booking.ts';
import { sendEmail } from '../email/send.ts';
import { logSafe } from '../http.ts';
import {
  assertSlotStillFree,
  computePublicSlots,
  loadLinkByPublicPath,
  randomToken,
  sha256Hex,
  type SchedulingLinkRow,
} from './service.ts';
import {
  createOriginWithOptionalMirrors,
  getValidAccessToken,
  loadSyncContext,
  providerFor,
  ProviderMirrorActor,
  track,
} from '../sync/runtime.ts';
import { PostgresStore } from '../sync/postgres-store.ts';

function isWritableRole(role: unknown): boolean {
  const value = String(role ?? '').toLowerCase();
  return value === 'owner' || value === 'writer' || value === 'editor';
}

function linkIsBookable(link: SchedulingLinkRow): string | null {
  if (!link.enabled) return 'link_disabled';
  if (link.expires_at && Date.parse(link.expires_at) < Date.now()) return 'link_expired';
  return null;
}

export async function getPublicPage(
  db: SupabaseClient,
  username: string,
  slug: string,
  day?: string,
) {
  const loaded = await loadLinkByPublicPath(db, username, slug);
  if (!loaded) throw new Error('link_not_found');
  const blocked = linkIsBookable(loaded.link);
  if (blocked) throw new Error(blocked);

  await requireEntitlement(db, loaded.link.user_id);

  const slotsStarted = Date.now();
  const slots = await computePublicSlots(db, {
    link: loaded.link,
    conflictCalendarIds: loaded.conflictCalendarIds,
    dayFilter: day,
  });

  const { data: inv } = await db
    .from('availability_invalidations')
    .select('created_at')
    .eq('user_id', loaded.link.user_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  await track(db, null, 'scheduling_link_opened');

  return {
    host: {
      displayName: loaded.displayName,
      username: username.toLowerCase(),
    },
    link: {
      slug: loaded.link.slug,
      title: loaded.link.title,
      description: loaded.link.description,
      durationMinutes: loaded.link.duration_minutes,
      timezone: loaded.link.timezone,
      conferenceMode: loaded.link.conference_mode,
      customLocation: loaded.link.custom_location,
    },
    slots,
    availabilityComputedAt: new Date().toISOString(),
    availabilityComputeMs: Date.now() - slotsStarted,
    lastCalendarChangeAt: inv?.created_at ?? null,
  };
}

export async function createBooking(
  db: SupabaseClient,
  input: {
    username: string;
    slug: string;
    startAt: string;
    guestName: string;
    guestEmail: string;
    guestNotes?: string;
    guestTimezone?: string;
  },
) {
  const loaded = await loadLinkByPublicPath(db, input.username, input.slug);
  if (!loaded) throw new Error('link_not_found');
  const blocked = linkIsBookable(loaded.link);
  if (blocked) throw new Error(blocked);
  await requireEntitlement(db, loaded.link.user_id);

  const link = loaded.link;
  const startMs = Date.parse(input.startAt);
  if (!Number.isFinite(startMs)) throw new Error('invalid_slot');
  const endAt = new Date(startMs + link.duration_minutes * 60_000).toISOString();

  await assertSlotStillFree(db, link, loaded.conflictCalendarIds, input.startAt, endAt);

  const manageToken = randomToken();
  const manageTokenHash = await sha256Hex(manageToken);
  const guestName = input.guestName.trim().slice(0, 120);
  const guestEmail = input.guestEmail.trim().toLowerCase().slice(0, 254);
  if (!guestName) throw new Error('guest_name_required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) throw new Error('guest_email_invalid');

  const { data: booking, error: insertError } = await db
    .from('bookings')
    .insert({
      scheduling_link_id: link.id,
      user_id: link.user_id,
      guest_name: guestName,
      guest_email: guestEmail,
      guest_notes: input.guestNotes?.trim().slice(0, 2000) || null,
      start_at: input.startAt,
      end_at: endAt,
      status: 'pending',
      manage_token_hash: manageTokenHash,
      guest_timezone: input.guestTimezone ?? null,
    })
    .select('*')
    .single();

  if (insertError || !booking) {
    if (insertError?.code === '23505' || /duplicate|unique/i.test(insertError?.message ?? '')) {
      throw new Error('SLOT_UNAVAILABLE');
    }
    throw new Error(insertError?.message ?? 'booking_failed');
  }

  try {
    await assertSlotStillFree(db, link, loaded.conflictCalendarIds, input.startAt, endAt, booking.id);

    const { ctx, calendar } = await loadSyncContext(db, link.destination_calendar_id);
    if (ctx.userId !== link.user_id) throw new Error('calendar_not_found');
    if (!isWritableRole(calendar.access_role)) throw new Error('calendar_read_only');

    const providerCalendarId = String(calendar.provider_calendar_id ?? '');
    const store = new PostgresStore(db);
    const actor = new ProviderMirrorActor(db);

    const location =
      link.conference_mode === 'custom' && link.custom_location
        ? link.custom_location
        : undefined;

    const notes = input.guestNotes?.trim()
      ? `\n\nObservação do convidado:\n${input.guestNotes.trim()}`
      : '';

    const result = await createOriginWithOptionalMirrors(
      ctx,
      {
        id: link.destination_calendar_id,
        connectionId: ctx.connectionId,
        providerCalendarId,
      },
      {
        title: `${link.title} — ${guestName}`,
        description: `Agendado via Both\nAnfitrião: ${loaded.displayName}\nConvidado: ${guestName} <${guestEmail}>${notes}`,
        location,
        startAt: input.startAt,
        endAt,
        timezone: link.timezone,
        allDay: false,
        blockOtherCalendars: true,
        attendees: [{ email: guestEmail, displayName: guestName }],
      },
      store,
      actor,
    );

    await db
      .from('bookings')
      .update({
        status: 'confirmed',
        event_id: result.stored.id,
      })
      .eq('id', booking.id);

    const whenLabel = new Intl.DateTimeFormat('pt-BR', {
      timeZone: link.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(input.startAt));

    await db.from('notifications').insert({
      user_id: link.user_id,
      type: 'booking_created',
      provider: 'UNIFY',
      entity_type: 'booking',
      entity_id: booking.id,
      title: 'Novo agendamento',
      body: `${guestName} marcou "${link.title}" para ${whenLabel}.`,
      metadata: {
        bookingId: booking.id,
        startAt: input.startAt,
        guestName,
        guestEmail,
        linkTitle: link.title,
      },
      dedupe_key: `UNIFY:booking:${booking.id}:created`,
    });

    const mail = bookingConfirmationEmail({
      guestName,
      guestEmail,
      hostName: loaded.displayName,
      meetingTitle: link.title,
      startAt: input.startAt,
      endAt,
      timezone: input.guestTimezone || link.timezone,
      manageToken,
    });
    try {
      await sendEmail({ to: guestEmail, ...mail });
    } catch (err) {
      logSafe('booking_email_failed', { message: String(err) });
    }

    await track(db, link.user_id, 'booking_completed');

    return {
      bookingId: booking.id,
      manageToken,
      startAt: input.startAt,
      endAt,
      title: link.title,
      hostName: loaded.displayName,
      guestEmail,
      timezone: link.timezone,
    };
  } catch (err) {
    await db.from('bookings').update({ status: 'canceled' }).eq('id', booking.id);
    if (String(err).includes('SLOT_UNAVAILABLE')) throw new Error('SLOT_UNAVAILABLE');
    throw err;
  }
}

export async function loadBookingByToken(db: SupabaseClient, token: string) {
  const hash = await sha256Hex(token);
  const { data: booking } = await db
    .from('bookings')
    .select('*, scheduling_links(*)')
    .eq('manage_token_hash', hash)
    .maybeSingle();
  if (!booking) throw new Error('booking_not_found');
  return booking as Record<string, unknown> & {
    id: string;
    status: string;
    start_at: string;
    end_at: string;
    guest_name: string;
    guest_email: string;
    event_id: string | null;
    user_id: string;
    scheduling_link_id: string;
    scheduling_links: SchedulingLinkRow;
  };
}

export async function cancelBooking(db: SupabaseClient, token: string) {
  const booking = await loadBookingByToken(db, token);
  if (booking.status === 'canceled') {
    return { ok: true, already: true };
  }

  if (booking.event_id) {
    const store = new PostgresStore(db);
    const actor = new ProviderMirrorActor(db);
    const existing = await store.findById(booking.event_id);
    if (existing) {
      try {
        await actor.deleteEvent(existing);
      } catch (err) {
        logSafe('booking_cancel_provider_failed', { message: String(err) });
      }
      await store.markStatus(existing.id, 'cancelled');
      if (existing.syncGroupId) {
        const { data: mirrors } = await db
          .from('calendar_events')
          .select('id')
          .eq('sync_group_id', existing.syncGroupId)
          .neq('id', existing.id);
        for (const m of mirrors ?? []) {
          const mirror = await store.findById(String(m.id));
          if (!mirror) continue;
          try {
            await actor.deleteEvent(mirror);
          } catch {
            /* ignore */
          }
          await store.markStatus(mirror.id, 'cancelled');
        }
      }
    }
  }

  await db.from('bookings').update({ status: 'canceled' }).eq('id', booking.id);
  await track(db, booking.user_id, 'booking_canceled');
  return { ok: true };
}

export async function rescheduleBooking(db: SupabaseClient, token: string, newStartAt: string) {
  const booking = await loadBookingByToken(db, token);
  if (booking.status === 'canceled') throw new Error('booking_canceled');
  const link = booking.scheduling_links;
  const blocked = linkIsBookable(link);
  if (blocked) throw new Error(blocked);
  await requireEntitlement(db, link.user_id);

  const { data: cals } = await db
    .from('scheduling_link_calendars')
    .select('connected_calendar_id')
    .eq('scheduling_link_id', link.id);
  const conflictCalendarIds = (cals ?? []).map((c) => String(c.connected_calendar_id));

  const startMs = Date.parse(newStartAt);
  if (!Number.isFinite(startMs)) throw new Error('invalid_slot');
  const endAt = new Date(startMs + link.duration_minutes * 60_000).toISOString();

  const previous = {
    status: booking.status,
    start_at: booking.start_at,
    end_at: booking.end_at,
  };

  // Free current slot from active unique index while checking the new one.
  await db.from('bookings').update({ status: 'rescheduled' }).eq('id', booking.id);

  try {
    await assertSlotStillFree(db, link, conflictCalendarIds, newStartAt, endAt);

    const { error: claimError } = await db
      .from('bookings')
      .update({
        status: 'confirmed',
        start_at: newStartAt,
        end_at: endAt,
      })
      .eq('id', booking.id);

    if (claimError) {
      if (claimError.code === '23505') throw new Error('SLOT_UNAVAILABLE');
      throw new Error(claimError.message);
    }

    if (!booking.event_id) throw new Error('event_missing');
    const store = new PostgresStore(db);
    const existing = await store.findById(booking.event_id);
    if (!existing || !existing.connectionId || !existing.providerCalendarId) {
      throw new Error('event_missing');
    }

    const { data: eventRow } = await db
      .from('calendar_events')
      .select('description, location')
      .eq('id', booking.event_id)
      .maybeSingle();

    const { accessToken, provider } = await getValidAccessToken(db, existing.connectionId);
    await providerFor(provider).updateEvent(
      accessToken,
      existing.providerCalendarId,
      existing.providerEventId,
      {
        title: existing.title,
        description: (eventRow?.description as string | null) ?? undefined,
        location: (eventRow?.location as string | null) ?? existing.location ?? undefined,
        startAt: newStartAt,
        endAt,
        timezone: link.timezone,
        allDay: false,
        role: 'ORIGIN',
        syncGroupId: existing.syncGroupId ?? undefined,
      },
    );

    await store.upsertEvent({
      userId: existing.userId,
      connectedCalendarId: existing.connectedCalendarId,
      providerEventId: existing.providerEventId,
      eventRole: existing.eventRole,
      syncGroupId: existing.syncGroupId,
      title: existing.title,
      description: (eventRow?.description as string | null) ?? undefined,
      location: (eventRow?.location as string | null) ?? existing.location ?? undefined,
      startAt: newStartAt,
      endAt,
      timezone: link.timezone,
      allDay: false,
      status: 'confirmed',
    });

    await track(db, booking.user_id, 'booking_rescheduled');
    return {
      startAt: newStartAt,
      endAt,
      title: link.title,
    };
  } catch (err) {
    await db
      .from('bookings')
      .update({
        status: previous.status === 'rescheduled' ? 'confirmed' : previous.status,
        start_at: previous.start_at,
        end_at: previous.end_at,
      })
      .eq('id', booking.id);
    throw err;
  }
}

export async function slotsForManage(db: SupabaseClient, token: string, day?: string) {
  const booking = await loadBookingByToken(db, token);
  const link = booking.scheduling_links;
  const blocked = linkIsBookable(link);
  if (blocked) throw new Error(blocked);
  const { data: cals } = await db
    .from('scheduling_link_calendars')
    .select('connected_calendar_id')
    .eq('scheduling_link_id', link.id);
  const conflictCalendarIds = (cals ?? []).map((c) => String(c.connected_calendar_id));
  const slots = await computePublicSlots(db, {
    link,
    conflictCalendarIds,
    dayFilter: day,
  });
  return {
    booking: {
      id: booking.id,
      status: booking.status,
      startAt: booking.start_at,
      endAt: booking.end_at,
      guestName: booking.guest_name,
      title: link.title,
      timezone: link.timezone,
      durationMinutes: link.duration_minutes,
    },
    slots,
  };
}
