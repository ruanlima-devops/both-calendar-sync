import { describe, expect, it } from 'vitest';
import { monthlyPeriod, shouldSendDigest, totalScheduledMinutes, weeklyPeriod } from '@/lib/email/digest';

describe('digest periods', () => {
  it('weekly uses Monday–Sunday in America/Sao_Paulo', () => {
    const now = new Date('2026-08-19T15:00:00.000Z');
    const period = weeklyPeriod(now, 'America/Sao_Paulo');
    expect(period.periodStart).toBe('2026-08-17');
    expect(period.periodEnd).toBe('2026-08-23');
  });

  it('monthly covers previous local month', () => {
    const now = new Date('2026-08-19T12:00:00.000Z');
    const period = monthlyPeriod(now, 'America/Sao_Paulo');
    expect(period.periodStart).toBe('2026-07-01');
    expect(period.periodEnd).toBe('2026-07-31');
  });

  it('schedules weekly on Monday 8am local', () => {
    const monday = new Date('2026-08-24T11:00:00.000Z');
    expect(shouldSendDigest('weekly', monday, 'America/Sao_Paulo', 8)).toBe(true);
  });

  it('sums timed events', () => {
    expect(
      totalScheduledMinutes([
        {
          title: 'A',
          startAt: '2026-08-20T12:00:00.000Z',
          endAt: '2026-08-20T13:30:00.000Z',
          allDay: false,
          timezone: 'UTC',
        },
      ]),
    ).toBe(90);
  });
});
