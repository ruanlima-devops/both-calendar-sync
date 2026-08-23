const DAY_MS = 24 * 60 * 60 * 1000;

/** Window used for Google full sync so page 1 is not 10 years of history. */
export function googleFullSyncWindow(now = new Date()): { timeMin: string; timeMax: string } {
  return {
    timeMin: new Date(now.getTime() - 365 * DAY_MS).toISOString(),
    timeMax: new Date(now.getTime() + 730 * DAY_MS).toISOString(),
  };
}

/** Convert a wall-clock time in an IANA zone to an ISO UTC instant. */
export function zonedDateTimeToUtc(
  date: string,
  time: string,
  timeZone: string,
): string {
  const asUtc = new Date(`${date}T${time}Z`);
  const inZone = utcToParts(asUtc, timeZone);
  const wanted = `${date}T${time}`;
  const got = `${pad(inZone.year)}-${pad(inZone.month)}-${pad(inZone.day)}T${pad(inZone.hour)}:${pad(inZone.minute)}:${pad(inZone.second)}`;
  const driftMs = asUtc.getTime() - Date.parse(`${got}Z`);
  const guessed = new Date(asUtc.getTime() + driftMs);
  const check = utcToParts(guessed, timeZone);
  const got2 = `${pad(check.year)}-${pad(check.month)}-${pad(check.day)}T${pad(check.hour)}:${pad(check.minute)}:${pad(check.second)}`;
  if (got2 === wanted) return guessed.toISOString();
  const adjust = Date.parse(`${wanted}Z`) - Date.parse(`${got2}Z`);
  return new Date(guessed.getTime() + adjust).toISOString();
}

export function allDayRange(date: string, endDateExclusive?: string): { startAt: string; endAt: string } {
  const startAt = `${date}T00:00:00.000Z`;
  const end = endDateExclusive ?? addDays(date, 1);
  return { startAt, endAt: `${end}T00:00:00.000Z` };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatInTimeZone(iso: string, timeZone: string, allDay = false): {
  date: string;
  time: string;
} {
  if (allDay) {
    return { date: iso.slice(0, 10), time: '00:00:00' };
  }
  const parts = utcToParts(new Date(iso), timeZone);
  return {
    date: `${pad(parts.year)}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function utcToParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') bag[p.type] = p.value;
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

export function googleDateToNormalized(
  start: { date?: string; dateTime?: string; timeZone?: string } | undefined,
  end: { date?: string; dateTime?: string; timeZone?: string } | undefined,
  fallbackTz: string,
): { startAt: string; endAt: string; timezone: string; allDay: boolean } {
  const timezone = start?.timeZone || end?.timeZone || fallbackTz || 'UTC';
  if (start?.date) {
    const range = allDayRange(start.date, end?.date);
    return { ...range, timezone, allDay: true };
  }
  const startAt = start?.dateTime
    ? new Date(start.dateTime).toISOString()
    : new Date().toISOString();
  const endAt = end?.dateTime
    ? new Date(end.dateTime).toISOString()
    : startAt;
  return { startAt, endAt, timezone, allDay: false };
}

export function microsoftDateToNormalized(
  start: { dateTime?: string; timeZone?: string } | undefined,
  end: { dateTime?: string; timeZone?: string } | undefined,
  isAllDay: boolean,
  fallbackTz: string,
): { startAt: string; endAt: string; timezone: string; allDay: boolean } {
  const timezone = start?.timeZone || fallbackTz || 'UTC';
  if (isAllDay && start?.dateTime) {
    const date = start.dateTime.slice(0, 10);
    const endDate = end?.dateTime?.slice(0, 10);
    return { ...allDayRange(date, endDate), timezone, allDay: true };
  }
  if (start?.dateTime && !start.dateTime.endsWith('Z') && !start.dateTime.includes('+') && start.timeZone) {
    const [date, rest] = start.dateTime.split('T');
    const time = (rest ?? '00:00:00').slice(0, 8);
    const endParts = (end?.dateTime ?? start.dateTime).split('T');
    const endTime = (endParts[1] ?? '00:00:00').slice(0, 8);
    return {
      startAt: zonedDateTimeToUtc(date, time.length === 5 ? `${time}:00` : time, timezone),
      endAt: zonedDateTimeToUtc(
        endParts[0] ?? date,
        endTime.length === 5 ? `${endTime}:00` : endTime,
        end?.timeZone || timezone,
      ),
      timezone,
      allDay: false,
    };
  }
  return {
    startAt: start?.dateTime ? new Date(start.dateTime).toISOString() : new Date().toISOString(),
    endAt: end?.dateTime ? new Date(end.dateTime).toISOString() : new Date().toISOString(),
    timezone,
    allDay: isAllDay,
  };
}
