import { describe, expect, it } from 'vitest';
import { isWritableAccessRole, toGoogleEventId, validateCreateEventForm } from '@/lib/events/create';

describe('create event helpers', () => {
  it('accepts writable roles only', () => {
    expect(isWritableAccessRole('owner')).toBe(true);
    expect(isWritableAccessRole('writer')).toBe(true);
    expect(isWritableAccessRole('reader')).toBe(false);
    expect(isWritableAccessRole('freeBusyReader')).toBe(false);
  });

  it('builds google-safe event ids', () => {
    const id = toGoogleEventId('A1B2C3D4-E5F6-7890-ABCD-EF1234567890');
    expect(id).toMatch(/^[a-v0-9]+$/);
    expect(id.length).toBeGreaterThanOrEqual(8);
  });

  it('validates form fields', () => {
    expect(validateCreateEventForm({
      title: '',
      date: '2026-08-22',
      start: '09:00',
      end: '10:00',
      allDay: false,
      calendarId: 'c1',
    })).toBeTruthy();

    expect(validateCreateEventForm({
      title: 'Daily',
      date: '2026-08-22',
      start: '10:00',
      end: '09:00',
      allDay: false,
      calendarId: 'c1',
    })).toContain('final');

    expect(validateCreateEventForm({
      title: 'Daily',
      date: '2026-08-22',
      start: '09:00',
      end: '10:00',
      allDay: false,
      calendarId: 'c1',
    })).toBeNull();
  });
});
