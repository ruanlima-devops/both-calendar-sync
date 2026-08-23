/** Minimal iCalendar (RFC 5545) parse/build for Unify ↔ iCloud CalDAV. */

export type IcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  status?: string;
  transp?: string;
  sequence?: number;
  dtstamp?: string;
  lastModified?: string;
  rrule?: string;
  exdates: string[];
  recurrenceId?: string;
  /** Absolute start/end as ISO UTC, or all-day date keys */
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  attendees: Array<{ email: string; displayName?: string }>;
  xProps: Record<string, string>;
};

function unfold(ics: string): string[] {
  const raw = ics.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseProp(line: string): { name: string; params: Record<string, string>; value: string } {
  const colon = line.indexOf(':');
  if (colon < 0) return { name: line.toUpperCase(), params: {}, value: '' };
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = left.split(';');
  const name = (parts[0] ?? '').toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** Parse DTSTART/DTEND style values into Unify normalized times. */
export function parseIcsDate(
  value: string,
  params: Record<string, string>,
): { startAt: string; timezone: string; allDay: boolean } {
  const tzid = params.TZID;
  if (params.VALUE === 'DATE' || (/^\d{8}$/.test(value) && !value.includes('T'))) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    return { startAt: `${y}-${m}-${d}T00:00:00.000Z`, timezone: tzid || 'UTC', allDay: true };
  }
  // Form: 20260824T140000Z or 20260824T140000
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) {
    return { startAt: new Date().toISOString(), timezone: tzid || 'UTC', allDay: false };
  }
  const isoLocal = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (m[7] === 'Z') {
    return { startAt: `${isoLocal}.000Z`, timezone: 'UTC', allDay: false };
  }
  if (tzid) {
    // Interpret wall time in TZID → approximate via offset probe
    const utc = wallTimeToUtc(isoLocal, tzid);
    return { startAt: utc, timezone: tzid, allDay: false };
  }
  // Floating time — treat as UTC wall (Unify stores explicit tz)
  return { startAt: `${isoLocal}.000Z`, timezone: 'UTC', allDay: false };
}

function wallTimeToUtc(localIsoNoZ: string, timeZone: string): string {
  const [date, time] = localIsoNoZ.split('T');
  const [y, mo, d] = date!.split('-').map(Number);
  const [hh, mm, ss] = time!.split(':').map(Number);
  const utcGuess = Date.UTC(y!, mo! - 1, d!, hh!, mm!, ss! || 0);
  for (const deltaHours of [0, -14, -12, -10, -8, -5, -3, -1, 1, 3, 5, 8, 10, 12, 14]) {
    for (const fine of [0, -30, 30]) {
      const candidate = utcGuess + (deltaHours * 60 + fine) * 60_000;
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
      const parts = Object.fromEntries(fmt.formatToParts(new Date(candidate)).map((p) => [p.type, p.value]));
      const got =
        `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
      if (got === `${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss || 0).padStart(2, '0')}`) {
        return new Date(candidate).toISOString();
      }
    }
  }
  return new Date(utcGuess).toISOString();
}

export function parseVEvents(ics: string): IcsEvent[] {
  const lines = unfold(ics);
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> & { xProps: Record<string, string>; exdates: string[]; attendees: IcsEvent['attendees'] } | null =
    null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = { xProps: {}, exdates: [], attendees: [], summary: '', uid: '', startAt: '', endAt: '', timezone: 'UTC', allDay: false };
      continue;
    }
    if (line === 'END:VEVENT' && cur) {
      if (cur.uid && cur.startAt) {
        events.push({
          uid: cur.uid,
          summary: cur.summary || '(sem título)',
          description: cur.description,
          location: cur.location,
          status: cur.status,
          transp: cur.transp,
          sequence: cur.sequence,
          dtstamp: cur.dtstamp,
          lastModified: cur.lastModified,
          rrule: cur.rrule,
          exdates: cur.exdates,
          recurrenceId: cur.recurrenceId,
          startAt: cur.startAt,
          endAt: cur.endAt || cur.startAt,
          timezone: cur.timezone || 'UTC',
          allDay: Boolean(cur.allDay),
          attendees: cur.attendees,
          xProps: cur.xProps,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const { name, params, value } = parseProp(line);
    const plain = unescapeIcs(value);
    switch (name) {
      case 'UID':
        cur.uid = plain;
        break;
      case 'SUMMARY':
        cur.summary = plain;
        break;
      case 'DESCRIPTION':
        cur.description = plain;
        break;
      case 'LOCATION':
        cur.location = plain;
        break;
      case 'STATUS':
        cur.status = plain.toUpperCase();
        break;
      case 'TRANSP':
        cur.transp = plain.toUpperCase();
        break;
      case 'SEQUENCE':
        cur.sequence = Number(plain) || 0;
        break;
      case 'DTSTAMP':
        cur.dtstamp = plain;
        break;
      case 'LAST-MODIFIED':
        cur.lastModified = plain;
        break;
      case 'RRULE':
        cur.rrule = plain;
        break;
      case 'EXDATE': {
        const parsed = parseIcsDate(plain.split(',')[0]!, params);
        cur.exdates.push(parsed.startAt);
        break;
      }
      case 'RECURRENCE-ID': {
        const parsed = parseIcsDate(plain, params);
        cur.recurrenceId = parsed.startAt;
        break;
      }
      case 'DTSTART': {
        const parsed = parseIcsDate(plain, params);
        cur.startAt = parsed.startAt;
        cur.timezone = parsed.timezone;
        cur.allDay = parsed.allDay;
        break;
      }
      case 'DTEND': {
        const parsed = parseIcsDate(plain, params);
        cur.endAt = parsed.startAt;
        if (!cur.timezone) cur.timezone = parsed.timezone;
        break;
      }
      case 'DURATION': {
        // Fallback if DTEND missing — ignore complex durations for v1 beyond hours
        break;
      }
      case 'ATTENDEE': {
        const email = (params.EMAIL || plain.replace(/^mailto:/i, '')).toLowerCase();
        if (email.includes('@')) {
          cur.attendees.push({ email, displayName: params.CN });
        }
        break;
      }
      default:
        if (name.startsWith('X-UNIFY-') || name.startsWith('X-')) {
          cur.xProps[name] = plain;
        }
    }
  }
  return events;
}

function formatUtcStamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function formatLocal(iso: string, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}`;
}

export function buildVEvent(input: {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  role?: string;
  syncGroupId?: string;
  transp?: 'OPAQUE' | 'TRANSPARENT';
  attendees?: Array<{ email: string; displayName?: string }>;
}): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Unify//Calendar//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT'];
  lines.push(`UID:${input.uid}`);
  lines.push(`DTSTAMP:${formatUtcStamp(new Date().toISOString())}`);
  if (input.allDay) {
    const startDay = input.startAt.slice(0, 10).replace(/-/g, '');
    let endDay = input.endAt.slice(0, 10).replace(/-/g, '');
    if (endDay <= startDay) {
      const next = new Date(`${input.startAt.slice(0, 10)}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      endDay = next.toISOString().slice(0, 10).replace(/-/g, '');
    }
    lines.push(`DTSTART;VALUE=DATE:${startDay}`);
    lines.push(`DTEND;VALUE=DATE:${endDay}`);
  } else if (input.timezone && input.timezone !== 'UTC') {
    lines.push(`DTSTART;TZID=${input.timezone}:${formatLocal(input.startAt, input.timezone)}`);
    lines.push(`DTEND;TZID=${input.timezone}:${formatLocal(input.endAt, input.timezone)}`);
  } else {
    lines.push(`DTSTART:${formatUtcStamp(input.startAt)}`);
    lines.push(`DTEND:${formatUtcStamp(input.endAt)}`);
  }
  lines.push(`SUMMARY:${escapeIcs(input.title)}`);
  if (input.description) lines.push(`DESCRIPTION:${escapeIcs(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeIcs(input.location)}`);
  lines.push(`TRANSP:${input.transp ?? 'OPAQUE'}`);
  lines.push('STATUS:CONFIRMED');
  if (input.syncGroupId) lines.push(`X-UNIFY-CORRELATION-ID:${escapeIcs(input.syncGroupId)}`);
  if (input.role) lines.push(`X-UNIFY-MANAGED:${escapeIcs(input.role)}`);
  for (const a of input.attendees ?? []) {
    const cn = a.displayName ? `;CN=${escapeIcs(a.displayName)}` : '';
    lines.push(`ATTENDEE${cn}:mailto:${a.email}`);
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length) {
    out += `\r\n ${rest.slice(0, 74)}`;
    rest = rest.slice(74);
  }
  return out;
}
