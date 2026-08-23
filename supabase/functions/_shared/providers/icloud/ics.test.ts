import { describe, expect, it } from 'vitest';
import { buildVEvent, parseVEvents } from './ics.ts';

describe('iCloud ICS', () => {
  it('parses timed VEVENT with UID', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:abc-123
DTSTART:20260824T140000Z
DTEND:20260824T150000Z
SUMMARY:Lunch
TRANSP:OPAQUE
STATUS:CONFIRMED
X-UNIFY-MANAGED:MIRROR
X-UNIFY-CORRELATION-ID:group-1
END:VEVENT
END:VCALENDAR`;
    const events = parseVEvents(ics);
    expect(events).toHaveLength(1);
    expect(events[0]!.uid).toBe('abc-123');
    expect(events[0]!.summary).toBe('Lunch');
    expect(events[0]!.startAt).toBe('2026-08-24T14:00:00.000Z');
    expect(events[0]!.xProps['X-UNIFY-MANAGED']).toBe('MIRROR');
  });

  it('parses all-day without shifting date', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:day-1
DTSTART;VALUE=DATE:20260825
DTEND;VALUE=DATE:20260826
SUMMARY:Birthday
END:VEVENT
END:VCALENDAR`;
    const events = parseVEvents(ics);
    expect(events[0]!.allDay).toBe(true);
    expect(events[0]!.startAt.startsWith('2026-08-25')).toBe(true);
  });

  it('builds opaque busy block with unify props', () => {
    const ics = buildVEvent({
      uid: 'u1',
      title: 'Horário reservado · Both',
      startAt: '2026-08-24T14:00:00.000Z',
      endAt: '2026-08-24T15:00:00.000Z',
      timezone: 'UTC',
      allDay: false,
      role: 'MIRROR',
      syncGroupId: 'g1',
      transp: 'OPAQUE',
    });
    expect(ics).toContain('SUMMARY:Horário reservado');
    expect(ics).toContain('TRANSP:OPAQUE');
    expect(ics).toContain('X-UNIFY-MANAGED:MIRROR');
    expect(ics).toContain('X-UNIFY-CORRELATION-ID:g1');
  });
});

describe('iCloud host allowlist', () => {
  it('allows icloud hosts only', async () => {
    const { isAllowedIcloudHost, assertSafeIcloudUrl } = await import('./config.ts');
    expect(isAllowedIcloudHost('caldav.icloud.com')).toBe(true);
    expect(isAllowedIcloudHost('p12-caldav.icloud.com')).toBe(true);
    expect(isAllowedIcloudHost('evil.com')).toBe(false);
    expect(() => assertSafeIcloudUrl('http://caldav.icloud.com/')).toThrow();
    expect(() => assertSafeIcloudUrl('https://127.0.0.1/')).toThrow();
  });
});
