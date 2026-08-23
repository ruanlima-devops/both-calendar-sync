/**
 * Unify Availability Engine — single source of truth for free/busy slot math.
 * Used by Scheduling Links (and reusable by Calendar Firewall / future AI).
 */

export interface BusyInterval {
  startMs: number;
  endMs: number;
}

export interface WorkingWindow {
  /** ISO weekday: 1 = Monday … 7 = Sunday */
  weekday: number;
  /** "HH:mm" in the host timezone */
  start: string;
  /** "HH:mm" in the host timezone */
  end: string;
}

export interface SlotRequest {
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  bookingWindowDays: number;
  timezone: string;
  availabilityRules: WorkingWindow[];
  busy: BusyInterval[];
  /** UTC instant considered "now" */
  nowMs: number;
  /** Optional: only return slots on this local day (yyyy-MM-dd in host tz) */
  dayFilter?: string;
}

export interface AvailableSlot {
  startAt: string;
  endAt: string;
}

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map((x) => Number(x));
  return { h: h || 0, m: m || 0 };
}

/** Expand a UTC range of calendar days into working windows as UTC intervals. */
export function expandWorkingWindows(
  rules: WorkingWindow[],
  fromMs: number,
  toMs: number,
  timeZone: string,
  zonedParts: (ms: number, tz: string) => { y: number; mo: number; d: number; weekday: number },
  localToUtc: (y: number, mo: number, d: number, h: number, m: number, tz: string) => number,
): BusyInterval[] {
  // Returns FREE windows as intervals (misnamed type reused as generic interval).
  const free: BusyInterval[] = [];
  const cursor = new Date(fromMs);
  cursor.setUTCHours(12, 0, 0, 0);
  const end = new Date(toMs);
  while (cursor.getTime() <= end.getTime() + 36 * 3600_000) {
    const parts = zonedParts(cursor.getTime(), timeZone);
    for (const rule of rules) {
      if (rule.weekday !== parts.weekday) continue;
      const a = parseHm(rule.start);
      const b = parseHm(rule.end);
      const startMs = localToUtc(parts.y, parts.mo, parts.d, a.h, a.m, timeZone);
      const endMs = localToUtc(parts.y, parts.mo, parts.d, b.h, b.m, timeZone);
      if (endMs > startMs) free.push({ startMs, endMs });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return free;
}

export function mergeIntervals(intervals: BusyInterval[]): BusyInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const out: BusyInterval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, cur.endMs);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Expand busy blocks with before/after buffers. */
export function withBuffers(
  busy: BusyInterval[],
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number,
): BusyInterval[] {
  const before = bufferBeforeMinutes * 60_000;
  const after = bufferAfterMinutes * 60_000;
  return mergeIntervals(
    busy.map((b) => ({
      startMs: b.startMs - before,
      endMs: b.endMs + after,
    })),
  );
}

export function overlaps(a: BusyInterval, b: BusyInterval): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

export function isSlotFree(slot: BusyInterval, busy: BusyInterval[]): boolean {
  return !busy.some((b) => overlaps(slot, b));
}

/**
 * Compute available booking slots.
 * `busy` should already include all conflict calendars (events + confirmed bookings).
 * Buffers are applied to busy intervals (not to working hours).
 */
export function computeAvailableSlots(
  input: SlotRequest,
  helpers: {
    zonedParts: (ms: number, tz: string) => { y: number; mo: number; d: number; weekday: number; dayKey: string };
    localToUtc: (y: number, mo: number, d: number, h: number, m: number, tz: string) => number;
  },
): AvailableSlot[] {
  const durationMs = input.durationMinutes * 60_000;
  const noticeMs = input.minimumNoticeMinutes * 60_000;
  const windowEndMs = input.nowMs + input.bookingWindowDays * 86_400_000;
  const earliestMs = input.nowMs + noticeMs;

  const freeWindows = expandWorkingWindows(
    input.availabilityRules,
    earliestMs,
    windowEndMs,
    input.timezone,
    helpers.zonedParts,
    helpers.localToUtc,
  );

  const blocked = withBuffers(input.busy, input.bufferBeforeMinutes, input.bufferAfterMinutes);
  const stepMs = Math.min(durationMs, 15 * 60_000);
  const slots: AvailableSlot[] = [];

  for (const win of freeWindows) {
    let cursor = Math.max(win.startMs, earliestMs);
    // Align to 15-min grid in UTC approximation is fine for slot stepping;
    // finer alignment happens via local start times from working window.
    cursor = Math.ceil(cursor / stepMs) * stepMs;
    while (cursor + durationMs <= win.endMs && cursor + durationMs <= windowEndMs) {
      const slot = { startMs: cursor, endMs: cursor + durationMs };
      const parts = helpers.zonedParts(cursor, input.timezone);
      if (input.dayFilter && parts.dayKey !== input.dayFilter) {
        cursor += stepMs;
        continue;
      }
      if (isSlotFree(slot, blocked)) {
        slots.push({
          startAt: new Date(cursor).toISOString(),
          endAt: new Date(cursor + durationMs).toISOString(),
        });
      }
      cursor += stepMs;
    }
  }

  return slots;
}

/** Convert DB events into busy intervals. Free/transparent events should be filtered by caller. */
export function eventsToBusyIntervals(
  events: Array<{ start_at: string; end_at: string; all_day?: boolean; status?: string }>,
): BusyInterval[] {
  const out: BusyInterval[] = [];
  for (const ev of events) {
    if (ev.status && ev.status !== 'confirmed' && ev.status !== 'tentative') continue;
    const startMs = Date.parse(ev.start_at);
    const endMs = Date.parse(ev.end_at);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    out.push({ startMs, endMs });
  }
  return mergeIntervals(out);
}
