import { describe, expect, it } from 'vitest';
import { daysInWeek, minutesOnDay, shiftAnchor, startOfWeekKey, utcRangeForView } from '@/lib/calendar/ranges';
import { layoutTimedEvents } from '@/lib/calendar/layout';
import type { UnifiedEvent } from '@/lib/types';

describe('calendar ranges', () => {
  it('starts week on Monday for pt-BR', () => {
    // 2026-08-19 is Wednesday
    expect(startOfWeekKey('2026-08-19', 'America/Sao_Paulo')).toBe('2026-08-17');
    expect(daysInWeek('2026-08-19', 'America/Sao_Paulo')).toHaveLength(7);
    expect(daysInWeek('2026-08-19', 'America/Sao_Paulo')[0]).toBe('2026-08-17');
  });

  it('shifts by view mode', () => {
    expect(shiftAnchor('2026-08-19', 'day', 1)).toBe('2026-08-20');
    expect(shiftAnchor('2026-08-19', 'week', 1)).toBe('2026-08-26');
    expect(shiftAnchor('2026-08-19', 'month', 1)).toBe('2026-09-19');
  });

  it('builds a week utc range', () => {
    const range = utcRangeForView('2026-08-19', 'week', 'America/Sao_Paulo');
    expect(range.from < range.to).toBe(true);
  });

  it('computes minutes on day', () => {
    const start = minutesOnDay('2026-08-19T12:00:00.000Z', '2026-08-19', 'America/Sao_Paulo', false, 'start');
    // 12:00 UTC = 09:00 in SP (UTC-3)
    expect(start).toBe(9 * 60);
  });
});

describe('layoutTimedEvents', () => {
  it('places overlapping events in adjacent columns', () => {
    const events = [
      event('a', '2026-08-19T12:00:00.000Z', '2026-08-19T13:00:00.000Z'),
      event('b', '2026-08-19T12:30:00.000Z', '2026-08-19T13:30:00.000Z'),
    ];
    const layout = layoutTimedEvents(events, '2026-08-19', 'America/Sao_Paulo', 52, 20);
    expect(layout).toHaveLength(2);
    expect(new Set(layout.map((l) => l.column)).size).toBe(2);
    expect(layout[0]!.columnCount).toBe(2);
  });
});

function event(id: string, start: string, end: string): UnifiedEvent {
  return {
    id,
    connected_calendar_id: 'c1',
    provider_event_id: id,
    event_role: 'EXTERNAL',
    sync_group_id: null,
    title: id,
    description: null,
    location: null,
    start_at: start,
    end_at: end,
    timezone: 'America/Sao_Paulo',
    all_day: false,
    status: 'confirmed',
    calendars: [{ id: 'c1', name: 'Main', color: '#2563eb', provider: 'GOOGLE' }],
  };
}
