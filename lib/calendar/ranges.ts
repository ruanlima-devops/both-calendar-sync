import { addDays, addMonths, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { addDay, dayKey, localInputToUtc, todayKey } from '@/lib/dates';
import type { CalendarViewMode } from '@/lib/calendar/types';

const WEEK_OPTS = { weekStartsOn: 1 as const }; // Monday (pt-BR)

function parseLocalDay(day: string): Date {
  return new Date(`${day}T12:00:00`);
}

export function startOfWeekKey(day: string, _timeZone: string): string {
  return format(startOfWeek(parseLocalDay(day), WEEK_OPTS), 'yyyy-MM-dd');
}

export function endOfWeekKey(day: string, _timeZone: string): string {
  return format(endOfWeek(parseLocalDay(day), WEEK_OPTS), 'yyyy-MM-dd');
}

export function daysInWeek(day: string, timeZone: string): string[] {
  const start = startOfWeekKey(day, timeZone);
  return Array.from({ length: 7 }, (_, i) => addDay(start, i));
}

export function daysInMonthGrid(day: string, _timeZone: string): string[] {
  const monthStart = startOfMonth(parseLocalDay(day));
  const gridStart = startOfWeek(monthStart, WEEK_OPTS);
  return Array.from({ length: 42 }, (_, i) => format(addDays(gridStart, i), 'yyyy-MM-dd'));
}

export function shiftAnchor(day: string, mode: CalendarViewMode, amount: number): string {
  if (mode === 'day') return addDay(day, amount);
  if (mode === 'week') return addDay(day, amount * 7);
  const base = parseLocalDay(day);
  return format(addMonths(base, amount), 'yyyy-MM-dd');
}

export function utcRangeForView(
  day: string,
  mode: CalendarViewMode,
  timeZone: string,
): { from: string; to: string } {
  if (mode === 'day') {
    return {
      from: localInputToUtc(addDay(day, -1), '00:00', timeZone),
      to: localInputToUtc(addDay(day, 2), '00:00', timeZone),
    };
  }
  if (mode === 'week') {
    const start = startOfWeekKey(day, timeZone);
    const end = addDay(endOfWeekKey(day, timeZone), 1);
    return {
      from: localInputToUtc(addDay(start, -1), '00:00', timeZone),
      to: localInputToUtc(addDay(end, 1), '00:00', timeZone),
    };
  }
  const grid = daysInMonthGrid(day, timeZone);
  const first = grid[0]!;
  const last = grid[grid.length - 1]!;
  return {
    from: localInputToUtc(addDay(first, -1), '00:00', timeZone),
    to: localInputToUtc(addDay(last, 2), '00:00', timeZone),
  };
}

function intlFormat(day: string, timeZone: string, options: Intl.DateTimeFormatOptions, locale = 'pt-BR'): string {
  return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(
    fromZonedTime(`${day}T12:00:00`, timeZone),
  );
}

export function headerLabel(day: string, mode: CalendarViewMode, timeZone: string, locale = 'pt-BR'): string {
  if (mode === 'day') {
    return intlFormat(day, timeZone, { day: 'numeric', month: 'long', year: 'numeric' }, locale);
  }
  if (mode === 'week') {
    const start = startOfWeekKey(day, timeZone);
    const end = endOfWeekKey(day, timeZone);
    const startLabel = intlFormat(start, timeZone, { day: 'numeric', month: 'short' }, locale);
    const endLabel = intlFormat(end, timeZone, { day: 'numeric', month: 'short', year: 'numeric' }, locale);
    return `${startLabel} – ${endLabel}`;
  }
  return intlFormat(day, timeZone, { month: 'long', year: 'numeric' }, locale);
}

/** Minutes from local midnight for a timed event start/end on a given local day. */
export function minutesOnDay(
  iso: string,
  day: string,
  timeZone: string,
  allDay: boolean,
  role: 'start' | 'end',
): number {
  if (allDay) return role === 'start' ? 0 : 24 * 60;
  const key = dayKey(iso, timeZone);
  if (role === 'start') {
    if (key < day) return 0;
    if (key > day) return 24 * 60;
    const hm = formatInTimeZone(iso, timeZone, 'H:m').split(':').map(Number);
    return (hm[0] ?? 0) * 60 + (hm[1] ?? 0);
  }
  if (key < day) return 0;
  if (key > day) return 24 * 60;
  const hm = formatInTimeZone(iso, timeZone, 'H:m').split(':').map(Number);
  const mins = (hm[0] ?? 0) * 60 + (hm[1] ?? 0);
  return mins === 0 && key === day ? 24 * 60 : mins;
}

export function nowMinutes(timeZone: string): number {
  const zoned = toZonedTime(new Date(), timeZone);
  return zoned.getHours() * 60 + zoned.getMinutes();
}

export function weekdayShort(day: string, timeZone: string, locale = 'pt-BR'): string {
  return intlFormat(day, timeZone, { weekday: 'short' }, locale);
}

export function dayOfMonth(day: string): number {
  return Number(day.slice(8, 10));
}

export function isSameMonth(day: string, anchor: string): boolean {
  return day.slice(0, 7) === anchor.slice(0, 7);
}

export function monthLabel(day: string, timeZone: string, locale = 'pt-BR'): string {
  return intlFormat(day, timeZone, { month: 'long', year: 'numeric' }, locale);
}

export function startOfMonthKey(day: string): string {
  return format(startOfMonth(parseLocalDay(day)), 'yyyy-MM-dd');
}

export function endOfMonthKey(day: string): string {
  return format(endOfMonth(parseLocalDay(day)), 'yyyy-MM-dd');
}

export { todayKey, addDay };
