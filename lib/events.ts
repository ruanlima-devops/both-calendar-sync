import type { CalendarEvent, ConnectedCalendar, CalendarConnection, UnifiedEvent } from './types';
import { BUSY_TITLE } from './events/busy';

/**
 * Unified agenda view:
 * - Prefer ORIGIN/EXTERNAL over MIRROR for the same sync_group.
 * - Hide mirrors when the origin is already visible.
 * - If the origin calendar is hidden/disabled but a mirror remains visible,
 *   show a discrete "Horário reservado" row so occupancy is not lost.
 */
export function groupEvents(
  events: CalendarEvent[],
  calendars: ConnectedCalendar[],
  connections: CalendarConnection[],
): UnifiedEvent[] {
  const calById = new Map(calendars.map((c) => [c.id, c]));
  const connById = new Map(connections.map((c) => [c.id, c]));
  const enabledCalIds = new Set(calendars.filter((c) => c.enabled).map((c) => c.id));
  const grouped = new Map<string, UnifiedEvent>();
  const result: UnifiedEvent[] = [];

  for (const event of events) {
    if (event.status !== 'confirmed' && event.status !== 'tentative') continue;
    if (!enabledCalIds.has(event.connected_calendar_id)) continue;
    if (event.event_role === 'MIRROR') continue;

    const calendar = calById.get(event.connected_calendar_id);
    const connection = calendar ? connById.get(calendar.connection_id) : undefined;
    const meta =
      calendar && connection
        ? [{ id: calendar.id, name: calendar.name, color: calendar.color, provider: connection.provider }]
        : [];

    if (event.sync_group_id) {
      const current = grouped.get(event.sync_group_id);
      if (current) {
        current.calendars.push(...meta);
        continue;
      }
    }

    const unified: UnifiedEvent = { ...event, calendars: meta };
    if (event.sync_group_id) grouped.set(event.sync_group_id, unified);
    result.push(unified);
  }

  for (const event of events) {
    if (event.event_role !== 'MIRROR' || !event.sync_group_id) continue;
    if (event.status !== 'confirmed' && event.status !== 'tentative') continue;
    if (!enabledCalIds.has(event.connected_calendar_id)) continue;

    const origin = grouped.get(event.sync_group_id);
    const calendar = calById.get(event.connected_calendar_id);
    const connection = calendar ? connById.get(calendar.connection_id) : undefined;

    if (origin) {
      if (calendar && connection && !origin.calendars.some((c) => c.id === calendar.id)) {
        origin.calendars.push({
          id: calendar.id,
          name: calendar.name,
          color: calendar.color,
          provider: connection.provider,
        });
      }
      continue;
    }

    const meta =
      calendar && connection
        ? [{ id: calendar.id, name: calendar.name, color: calendar.color, provider: connection.provider }]
        : [];
    const placeholder: UnifiedEvent = {
      ...event,
      title: 'Horário reservado',
      description: null,
      location: null,
      calendars: meta,
    };
    grouped.set(event.sync_group_id, placeholder);
    result.push(placeholder);
  }

  return result.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

export function isBusyBlockEvent(event: Pick<CalendarEvent, 'event_role'>): boolean {
  return event.event_role === 'MIRROR';
}

export function busyBlockDisplayTitle(title: string | null | undefined): string {
  if (
    !title ||
    title === BUSY_TITLE ||
    title === 'Horário reservado · Unify' ||
    title === 'Ocupado'
  ) {
    return 'Horário reservado';
  }
  return title;
}
