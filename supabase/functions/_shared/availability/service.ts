import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { computeAvailableSlots, eventsToBusyIntervals, isSlotFree, withBuffers } from './engine.ts';
import { localToUtcMs, zonedParts } from './timezone.ts';
import { logSafe } from '../http.ts';

export type SchedulingLinkRow = {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  destination_calendar_id: string;
  timezone: string;
  availability_rules: Array<{ weekday: number; start: string; end: string }>;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  minimum_notice_minutes: number;
  booking_window_days: number;
  conference_mode: string;
  custom_location: string | null;
  enabled: boolean;
  expires_at: string | null;
};

export async function loadLinkByPublicPath(
  db: SupabaseClient,
  username: string,
  slug: string,
): Promise<{ link: SchedulingLinkRow; displayName: string; conflictCalendarIds: string[] } | null> {
  const { data: profile } = await db
    .from('profiles')
    .select('id, display_name, booking_username')
    .ilike('booking_username', username)
    .maybeSingle();
  if (!profile) return null;

  const { data: link } = await db
    .from('scheduling_links')
    .select('*')
    .eq('user_id', profile.id)
    .eq('slug', slug.toLowerCase())
    .maybeSingle();
  if (!link) return null;

  const { data: cals } = await db
    .from('scheduling_link_calendars')
    .select('connected_calendar_id')
    .eq('scheduling_link_id', link.id);

  return {
    link: link as SchedulingLinkRow,
    displayName: String(profile.display_name ?? profile.booking_username ?? 'Unify'),
    conflictCalendarIds: (cals ?? []).map((c) => String(c.connected_calendar_id)),
  };
}

export async function loadBusyForCalendars(
  db: SupabaseClient,
  calendarIds: string[],
  fromIso: string,
  toIso: string,
): Promise<Array<{ start_at: string; end_at: string; all_day?: boolean; status?: string }>> {
  if (calendarIds.length === 0) return [];
  const { data } = await db
    .from('calendar_events')
    .select('start_at, end_at, all_day, status')
    .in('connected_calendar_id', calendarIds)
    .in('status', ['confirmed', 'tentative'])
    .lt('start_at', toIso)
    .gt('end_at', fromIso);
  return (data ?? []) as Array<{ start_at: string; end_at: string; all_day?: boolean; status?: string }>;
}

export async function loadBookingBusy(
  db: SupabaseClient,
  linkId: string,
  fromIso: string,
  toIso: string,
  excludeBookingId?: string,
): Promise<Array<{ start_at: string; end_at: string; status?: string }>> {
  let query = db
    .from('bookings')
    .select('start_at, end_at, status')
    .eq('scheduling_link_id', linkId)
    .in('status', ['pending', 'confirmed'])
    .lt('start_at', toIso)
    .gt('end_at', fromIso);
  if (excludeBookingId) query = query.neq('id', excludeBookingId);
  const { data } = await query;
  return (data ?? []) as Array<{ start_at: string; end_at: string; status?: string }>;
}

export async function computePublicSlots(
  db: SupabaseClient,
  input: {
    link: SchedulingLinkRow;
    conflictCalendarIds: string[];
    dayFilter?: string;
    nowMs?: number;
  },
) {
  const nowMs = input.nowMs ?? Date.now();
  const fromIso = new Date(nowMs).toISOString();
  const toIso = new Date(nowMs + input.link.booking_window_days * 86_400_000).toISOString();

  const [events, bookings] = await Promise.all([
    loadBusyForCalendars(db, input.conflictCalendarIds, fromIso, toIso),
    loadBookingBusy(db, input.link.id, fromIso, toIso),
  ]);

  const busy = eventsToBusyIntervals([
    ...events,
    ...bookings.map((b) => ({ start_at: b.start_at, end_at: b.end_at, status: 'confirmed' })),
  ]);

  const started = Date.now();
  const slots = computeAvailableSlots(
    {
      durationMinutes: input.link.duration_minutes,
      bufferBeforeMinutes: input.link.buffer_before_minutes,
      bufferAfterMinutes: input.link.buffer_after_minutes,
      minimumNoticeMinutes: input.link.minimum_notice_minutes,
      bookingWindowDays: input.link.booking_window_days,
      timezone: input.link.timezone,
      availabilityRules: input.link.availability_rules ?? [],
      busy,
      nowMs,
      dayFilter: input.dayFilter,
    },
    { zonedParts, localToUtc: localToUtcMs },
  );

  logSafe('availability_compute', {
    linkId: input.link.id,
    calendars: input.conflictCalendarIds.length,
    busyBlocks: busy.length,
    slots: slots.length,
    latencyMs: Date.now() - started,
  });

  return slots;
}

/** Strict revalidation at booking time (includes buffers). */
export async function assertSlotStillFree(
  db: SupabaseClient,
  link: SchedulingLinkRow,
  conflictCalendarIds: string[],
  startAt: string,
  endAt: string,
  excludeBookingId?: string,
): Promise<void> {
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('invalid_slot');
  }
  const noticeMs = link.minimum_notice_minutes * 60_000;
  if (startMs < Date.now() + noticeMs) throw new Error('slot_too_soon');

  const pad = Math.max(link.buffer_before_minutes, link.buffer_after_minutes, 60) * 60_000;
  const fromIso = new Date(startMs - pad).toISOString();
  const toIso = new Date(endMs + pad).toISOString();
  const [events, bookings] = await Promise.all([
    loadBusyForCalendars(db, conflictCalendarIds, fromIso, toIso),
    loadBookingBusy(db, link.id, fromIso, toIso, excludeBookingId),
  ]);
  const busy = withBuffers(
    eventsToBusyIntervals([
      ...events,
      ...bookings.map((b) => ({ start_at: b.start_at, end_at: b.end_at, status: 'confirmed' })),
    ]),
    link.buffer_before_minutes,
    link.buffer_after_minutes,
  );
  if (!isSlotFree({ startMs, endMs }, busy)) {
    throw new Error('SLOT_UNAVAILABLE');
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
