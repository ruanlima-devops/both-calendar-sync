import type { TimedLayoutItem } from '@/lib/calendar/types';
import { minutesOnDay } from '@/lib/calendar/ranges';
import type { UnifiedEvent } from '@/lib/types';

interface Interval {
  event: UnifiedEvent;
  startMin: number;
  endMin: number;
}

/**
 * Pack overlapping timed events into columns (Google/Outlook-style).
 */
export function layoutTimedEvents(
  events: UnifiedEvent[],
  day: string,
  timeZone: string,
  hourHeight: number,
  minEventHeight: number,
): TimedLayoutItem[] {
  const intervals: Interval[] = events
    .filter((e) => !e.all_day)
    .map((event) => {
      let startMin = minutesOnDay(event.start_at, day, timeZone, false, 'start');
      let endMin = minutesOnDay(event.end_at, day, timeZone, false, 'end');
      if (endMin <= startMin) endMin = Math.min(24 * 60, startMin + 15);
      return { event, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const result: TimedLayoutItem[] = [];
  let cluster: Interval[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const columns: number[] = [];
    const assigned: Array<{ interval: Interval; column: number }> = [];

    for (const interval of cluster) {
      let col = 0;
      while (columns[col] !== undefined && columns[col]! > interval.startMin) col += 1;
      columns[col] = interval.endMin;
      assigned.push({ interval, column: col });
    }

    const columnCount = Math.max(1, columns.length);
    for (const { interval, column } of assigned) {
      const top = (interval.startMin / 60) * hourHeight;
      const rawHeight = ((interval.endMin - interval.startMin) / 60) * hourHeight;
      result.push({
        eventId: interval.event.id,
        column,
        columnCount,
        top,
        height: Math.max(minEventHeight, rawHeight),
        startMin: interval.startMin,
        endMin: interval.endMin,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const interval of intervals) {
    if (cluster.length === 0 || interval.startMin < clusterEnd) {
      cluster.push(interval);
      clusterEnd = Math.max(clusterEnd, interval.endMin);
    } else {
      flush();
      cluster = [interval];
      clusterEnd = interval.endMin;
    }
  }
  flush();
  return result;
}

export function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
