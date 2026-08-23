import { describe, expect, it } from 'vitest';
import {
  computeAvailableSlots,
  eventsToBusyIntervals,
  isSlotFree,
  mergeIntervals,
  withBuffers,
} from './engine.ts';

function helpers() {
  return {
    zonedParts: (ms: number, _tz: string) => {
      const d = new Date(ms);
      // Approximate UTC as host tz for unit tests
      const day = d.getUTCDay();
      const weekday = day === 0 ? 7 : day;
      const y = d.getUTCFullYear();
      const mo = d.getUTCMonth() + 1;
      const dd = d.getUTCDate();
      return {
        y,
        mo,
        d: dd,
        weekday,
        dayKey: `${y}-${String(mo).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
      };
    },
    localToUtc: (y: number, mo: number, d: number, h: number, m: number) =>
      Date.UTC(y, mo - 1, d, h, m, 0, 0),
  };
}

describe('Availability Engine', () => {
  it('merges overlapping busy intervals', () => {
    expect(
      mergeIntervals([
        { startMs: 0, endMs: 100 },
        { startMs: 50, endMs: 150 },
        { startMs: 200, endMs: 250 },
      ]),
    ).toEqual([
      { startMs: 0, endMs: 150 },
      { startMs: 200, endMs: 250 },
    ]);
  });

  it('applies buffers around busy blocks', () => {
    const buffered = withBuffers([{ startMs: 60_000 * 60, endMs: 60_000 * 120 }], 15, 15);
    expect(buffered[0]?.startMs).toBe(60_000 * 45);
    expect(buffered[0]?.endMs).toBe(60_000 * 135);
  });

  it('detects conflicts', () => {
    expect(isSlotFree({ startMs: 0, endMs: 30 }, [{ startMs: 10, endMs: 20 }])).toBe(false);
    expect(isSlotFree({ startMs: 0, endMs: 10 }, [{ startMs: 10, endMs: 20 }])).toBe(true);
  });

  it('hides slots that collide with multi-calendar busy', () => {
    // Monday 2026-08-24 working 09-17 UTC, busy 10-11 and 14-15
    const nowMs = Date.UTC(2026, 7, 24, 6, 0, 0);
    const busy = eventsToBusyIntervals([
      { start_at: '2026-08-24T10:00:00.000Z', end_at: '2026-08-24T11:00:00.000Z', status: 'confirmed' },
      { start_at: '2026-08-24T14:00:00.000Z', end_at: '2026-08-24T15:00:00.000Z', status: 'confirmed' },
    ]);
    const slots = computeAvailableSlots(
      {
        durationMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        minimumNoticeMinutes: 0,
        bookingWindowDays: 1,
        timezone: 'UTC',
        availabilityRules: [{ weekday: 1, start: '09:00', end: '17:00' }],
        busy,
        nowMs,
        dayFilter: '2026-08-24',
      },
      helpers(),
    );
    const starts = slots.map((s) => s.startAt);
    expect(starts).not.toContain('2026-08-24T10:00:00.000Z');
    expect(starts).not.toContain('2026-08-24T10:30:00.000Z');
    expect(starts).not.toContain('2026-08-24T14:00:00.000Z');
    expect(starts).toContain('2026-08-24T09:00:00.000Z');
    expect(starts).toContain('2026-08-24T11:00:00.000Z');
  });

  it('respects buffer so adjacent slots stay clear', () => {
    const nowMs = Date.UTC(2026, 7, 24, 6, 0, 0);
    const busy = eventsToBusyIntervals([
      { start_at: '2026-08-24T10:00:00.000Z', end_at: '2026-08-24T10:30:00.000Z', status: 'confirmed' },
    ]);
    const slots = computeAvailableSlots(
      {
        durationMinutes: 30,
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
        minimumNoticeMinutes: 0,
        bookingWindowDays: 1,
        timezone: 'UTC',
        availabilityRules: [{ weekday: 1, start: '09:00', end: '17:00' }],
        busy,
        nowMs,
        dayFilter: '2026-08-24',
      },
      helpers(),
    );
    const starts = slots.map((s) => s.startAt);
    expect(starts).not.toContain('2026-08-24T09:30:00.000Z');
    expect(starts).not.toContain('2026-08-24T10:30:00.000Z');
    expect(starts).toContain('2026-08-24T09:00:00.000Z');
    expect(starts).toContain('2026-08-24T11:00:00.000Z');
  });

  it('enforces minimum notice', () => {
    const nowMs = Date.UTC(2026, 7, 24, 9, 0, 0);
    const slots = computeAvailableSlots(
      {
        durationMinutes: 30,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        minimumNoticeMinutes: 120,
        bookingWindowDays: 1,
        timezone: 'UTC',
        availabilityRules: [{ weekday: 1, start: '09:00', end: '17:00' }],
        busy: [],
        nowMs,
        dayFilter: '2026-08-24',
      },
      helpers(),
    );
    const starts = slots.map((s) => s.startAt);
    expect(starts).not.toContain('2026-08-24T09:00:00.000Z');
    expect(starts).not.toContain('2026-08-24T10:30:00.000Z');
    expect(starts).toContain('2026-08-24T11:00:00.000Z');
  });
});
