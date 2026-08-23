import { addDays, format, parseISO, startOfDay } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export function formatRange(startIso: string, endIso: string, timeZone: string, allDay: boolean): string {
  if (allDay) {
    return formatInTimeZone(parseISO(startIso), timeZone, 'd MMM');
  }
  return `${formatInTimeZone(parseISO(startIso), timeZone, 'HH:mm')}–${formatInTimeZone(parseISO(endIso), timeZone, 'HH:mm')}`;
}

/** Long form for event detail: "terça-feira, 25 de agosto" + time range. */
export function formatEventDetail(
  startIso: string,
  endIso: string,
  timeZone: string,
  allDay: boolean,
): { dateLine: string; timeLine: string | null } {
  const dateLine = formatInTimeZone(parseISO(startIso), timeZone, "EEEE, d 'de' MMMM");
  if (allDay) return { dateLine, timeLine: 'Dia inteiro' };
  const timeLine = `${formatInTimeZone(parseISO(startIso), timeZone, 'HH:mm')} – ${formatInTimeZone(parseISO(endIso), timeZone, 'HH:mm')}`;
  return { dateLine, timeLine };
}

export function localPartsFromUtc(iso: string, timeZone: string): { date: string; time: string } {
  return {
    date: formatInTimeZone(parseISO(iso), timeZone, 'yyyy-MM-dd'),
    time: formatInTimeZone(parseISO(iso), timeZone, 'HH:mm'),
  };
}

export function dayKey(iso: string, timeZone: string): string {
  return formatInTimeZone(parseISO(iso), timeZone, 'yyyy-MM-dd');
}

export function localInputToUtc(date: string, time: string, timeZone: string): string {
  return fromZonedTime(`${date}T${time}:00`, timeZone).toISOString();
}

export function addDay(date: string, amount: number): string {
  return format(addDays(parseISO(`${date}T00:00:00`), amount), 'yyyy-MM-dd');
}

export function todayKey(timeZone: string): string {
  return formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd');
}

export function startOfLocalDay(date: string, timeZone: string): Date {
  return fromZonedTime(`${date}T00:00:00`, timeZone);
}

export function utcRangeForLocalDay(date: string, timeZone: string): { from: string; to: string } {
  return {
    from: localInputToUtc(addDay(date, -1), '00:00', timeZone),
    to: localInputToUtc(addDay(date, 2), '00:00', timeZone),
  };
}

export function eventFallsOnDay(startAt: string, allDay: boolean, day: string, timeZone: string): boolean {
  if (allDay) return startAt.slice(0, 10) === day;
  return dayKey(startAt, timeZone) === day;
}

/** True if a timed/all-day event overlaps the local calendar day. */
export function eventOverlapsDay(
  startAt: string,
  endAt: string,
  allDay: boolean,
  day: string,
  timeZone: string,
): boolean {
  if (allDay) {
    const start = startAt.slice(0, 10);
    const end = endAt.slice(0, 10);
    return start <= day && end > day;
  }
  const start = dayKey(startAt, timeZone);
  const end = dayKey(endAt, timeZone);
  if (start === day) return true;
  if (start < day && end > day) return true;
  if (end === day) {
    const endHm = formatInTimeZone(endAt, timeZone, 'HHmm');
    return endHm !== '0000';
  }
  return false;
}

export { format, parseISO, startOfDay };
