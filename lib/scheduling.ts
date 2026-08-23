import { appPublicUrl } from '@/lib/app';
import { invokeFunction } from '@/lib/supabase';

const FUNCTIONS_BASE = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${FUNCTIONS_BASE}/functions/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      (typeof data.message === 'string' && data.message) ||
      (typeof data.error === 'string' && data.error) ||
      `HTTP ${res.status}`;
    throw new Error(message);
  }
  if (data.error) throw new Error(String(data.error));
  return data as T;
}

export type AvailabilityRule = { weekday: number; start: string; end: string };

export type SchedulingLink = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  destination_calendar_id: string;
  timezone: string;
  availability_rules: AvailabilityRule[];
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  minimum_notice_minutes: number;
  booking_window_days: number;
  conference_mode: string;
  custom_location: string | null;
  link_kind: string;
  enabled: boolean;
  expires_at: string | null;
  conflict_calendar_ids?: string[];
};

export type PublicSlot = { startAt: string; endAt: string };

export function bookingPagePath(username: string, slug: string): string {
  return `/book/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`;
}

export function bookingPageUrl(username: string, slug: string): string {
  const base = appPublicUrl();
  const path = bookingPagePath(username, slug);
  return base ? `${base}${path}` : path;
}

export async function listSchedulingLinks(): Promise<{
  bookingUsername: string | null;
  displayName: string | null;
  timezone: string;
  links: SchedulingLink[];
}> {
  return invokeFunction('scheduling-links');
}

export async function setBookingUsername(bookingUsername: string) {
  return invokeFunction<{ bookingUsername: string }>('scheduling-links', {
    action: 'set_username',
    bookingUsername,
  });
}

export async function saveSchedulingLink(body: Record<string, unknown>) {
  return invokeFunction<{ link: SchedulingLink }>('scheduling-links', body);
}

export async function deleteSchedulingLink(id: string) {
  return invokeFunction('scheduling-links', { action: 'delete', id });
}

export async function fetchPublicBooking(username: string, slug: string, day?: string) {
  const params = new URLSearchParams({ username, slug });
  if (day) params.set('day', day);
  return publicFetch<{
    host: { displayName: string; username: string };
    link: {
      slug: string;
      title: string;
      description: string | null;
      durationMinutes: number;
      timezone: string;
      conferenceMode: string;
      customLocation: string | null;
    };
    slots: PublicSlot[];
    lastCalendarChangeAt: string | null;
  }>(`public-booking?${params.toString()}`, { method: 'GET' });
}

export async function submitPublicBooking(body: {
  username: string;
  slug: string;
  startAt: string;
  guestName: string;
  guestEmail: string;
  guestNotes?: string;
  guestTimezone?: string;
}) {
  try {
    return await publicFetch<{
      ok: boolean;
      manageToken: string;
      startAt: string;
      endAt: string;
      title: string;
      hostName: string;
      guestEmail: string;
      timezone: string;
    }>('public-booking', { method: 'POST', body: JSON.stringify(body) });
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    if (message.includes('SLOT_UNAVAILABLE') || message.includes('indisponível')) {
      throw new Error('Este horário acabou de ficar indisponível. Escolha outro horário.');
    }
    throw err;
  }
}

export async function fetchManageBooking(token: string, day?: string) {
  const params = new URLSearchParams({ token });
  if (day) params.set('day', day);
  return publicFetch<{
    booking: {
      id: string;
      status: string;
      startAt: string;
      endAt: string;
      guestName: string;
      title: string;
      timezone: string;
      durationMinutes: number;
    };
    slots: PublicSlot[];
  }>(`manage-booking?${params.toString()}`, { method: 'GET' });
}

export async function cancelManagedBooking(token: string) {
  return publicFetch('manage-booking', {
    method: 'POST',
    body: JSON.stringify({ action: 'cancel', token }),
  });
}

export async function rescheduleManagedBooking(token: string, startAt: string) {
  try {
    return await publicFetch('manage-booking', {
      method: 'POST',
      body: JSON.stringify({ action: 'reschedule', token, startAt }),
    });
  } catch (err) {
    const message = String(err instanceof Error ? err.message : err);
    if (message.includes('SLOT_UNAVAILABLE') || message.includes('indisponível')) {
      throw new Error('Este horário acabou de ficar indisponível. Escolha outro horário.');
    }
    throw err;
  }
}

export const DURATION_PRESETS = [15, 30, 45, 60] as const;

export const WEEKDAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'] as const;

export function defaultWeekdayRules(): AvailabilityRule[] {
  return [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '17:00' }));
}

export function groupSlotsByDay(
  slots: PublicSlot[],
  timeZone: string,
): Array<{ dayKey: string; label: string; slots: PublicSlot[] }> {
  const map = new Map<string, PublicSlot[]>();
  for (const slot of slots) {
    const dayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(slot.startAt));
    const list = map.get(dayKey) ?? [];
    list.push(slot);
    map.set(dayKey, list);
  }
  return [...map.entries()].map(([dayKey, daySlots]) => ({
    dayKey,
    label: new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date(daySlots[0]!.startAt)),
    slots: daySlots,
  }));
}

export function formatSlotTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function formatSlotRange(startAt: string, endAt: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(startAt));
  return `${day}, ${formatSlotTime(startAt, timeZone)}–${formatSlotTime(endAt, timeZone)}`;
}

export function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
