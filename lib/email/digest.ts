import {
  addMonths,
  differenceInMinutes,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

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

export function totalScheduledMinutes(events: DigestEvent[]): number {
  return events.reduce((sum, event) => {
    if (event.allDay) return sum + 8 * 60;
    const mins = differenceInMinutes(new Date(event.endAt), new Date(event.startAt));
    return sum + Math.max(mins, 0);
  }, 0);
}
