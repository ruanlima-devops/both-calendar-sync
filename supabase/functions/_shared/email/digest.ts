import {
  addMonths,
  differenceInMinutes,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'npm:date-fns@4';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'npm:date-fns-tz@3';

export type DigestType = 'weekly' | 'monthly';

export interface DigestPeriod {
  type: DigestType;
  periodStart: string;
  periodEnd: string;
  periodStartUtc: string;
  periodEndUtc: string;
  titleLabel: string;
}

export interface DigestEvent {
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  timezone: string;
}

const WEEK_OPTS = { weekStartsOn: 1 as const };

function utcStartOfLocalDay(day: string, timezone: string): string {
  return fromZonedTime(`${day}T00:00:00`, timezone).toISOString();
}

function utcEndExclusiveLocalDay(day: string, timezone: string): string {
  const next = format(addDaysLocal(day, 1), 'yyyy-MM-dd');
  return fromZonedTime(`${next}T00:00:00`, timezone).toISOString();
}

function addDaysLocal(day: string, amount: number): Date {
  const base = new Date(`${day}T12:00:00`);
  base.setDate(base.getDate() + amount);
  return base;
}

/** Current calendar week (Mon→Sun) in the user's timezone. */
export function weeklyPeriod(now: Date, timezone: string): DigestPeriod {
  const zoned = toZonedTime(now, timezone);
  const monday = format(startOfWeek(zoned, WEEK_OPTS), 'yyyy-MM-dd');
  const sunday = format(endOfWeek(zoned, WEEK_OPTS), 'yyyy-MM-dd');
  const startLabel = formatInTimeZone(fromZonedTime(`${monday}T12:00:00`, timezone), timezone, 'd MMM');
  const endLabel = formatInTimeZone(fromZonedTime(`${sunday}T12:00:00`, timezone), timezone, 'd MMM yyyy');
  return {
    type: 'weekly',
    periodStart: monday,
    periodEnd: sunday,
    periodStartUtc: utcStartOfLocalDay(monday, timezone),
    periodEndUtc: utcEndExclusiveLocalDay(sunday, timezone),
    titleLabel: `${startLabel} – ${endLabel}`,
  };
}

/** Previous calendar month in the user's timezone. */
export function monthlyPeriod(now: Date, timezone: string): DigestPeriod {
  const zoned = toZonedTime(now, timezone);
  const prev = addMonths(startOfMonth(zoned), -1);
  const start = format(prev, 'yyyy-MM-dd');
  const end = format(endOfMonth(prev), 'yyyy-MM-dd');
  const titleLabel = formatInTimeZone(prev, timezone, 'MMMM yyyy');
  return {
    type: 'monthly',
    periodStart: start,
    periodEnd: end,
    periodStartUtc: utcStartOfLocalDay(start, timezone),
    periodEndUtc: utcEndExclusiveLocalDay(end, timezone),
    titleLabel,
  };
}

export function periodFor(type: DigestType, now: Date, timezone: string): DigestPeriod {
  return type === 'weekly' ? weeklyPeriod(now, timezone) : monthlyPeriod(now, timezone);
}

/** True when local time matches the scheduled send window (hour precision). */
export function shouldSendDigest(
  type: DigestType,
  now: Date,
  timezone: string,
  sendHour = 8,
): boolean {
  const zoned = toZonedTime(now, timezone);
  if (zoned.getHours() !== sendHour) return false;
  if (type === 'weekly') return zoned.getDay() === 1;
  return zoned.getDate() === 1;
}

export function formatEventTime(event: DigestEvent, timezone: string): string {
  if (event.allDay) return 'Dia inteiro';
  return `${formatInTimeZone(event.startAt, timezone, 'HH:mm')}–${formatInTimeZone(event.endAt, timezone, 'HH:mm')}`;
}

export function totalScheduledMinutes(events: DigestEvent[]): number {
  return events.reduce((sum, event) => {
    if (event.allDay) return sum + 8 * 60;
    const mins = differenceInMinutes(new Date(event.endAt), new Date(event.startAt));
    return sum + Math.max(mins, 0);
  }, 0);
}

export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins}min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h${String(mins).padStart(2, '0')}`;
}

export function groupEventsByDay(events: DigestEvent[], timezone: string): Map<string, DigestEvent[]> {
  const map = new Map<string, DigestEvent[]>();
  const sorted = [...events].sort((a, b) => a.startAt.localeCompare(b.startAt));
  for (const event of sorted) {
    const day = event.allDay ? event.startAt.slice(0, 10) : formatInTimeZone(event.startAt, timezone, 'yyyy-MM-dd');
    const list = map.get(day) ?? [];
    list.push(event);
    map.set(day, list);
  }
  return map;
}

export function dayHeading(day: string, timezone: string): string {
  return formatInTimeZone(fromZonedTime(`${day}T12:00:00`, timezone), timezone, 'EEEE, d MMM').toUpperCase();
}
