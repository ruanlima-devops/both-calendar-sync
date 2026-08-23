import { describe, expect, it } from 'vitest';
import { describeCalendarChange, notificationDraftForSync, type EventSnapshot } from './messages.ts';

const tz = 'America/Sao_Paulo';

function snap(over: Partial<EventSnapshot> = {}): EventSnapshot {
  return {
    title: 'Daily',
    startAt: '2026-08-19T12:00:00.000Z',
    endAt: '2026-08-19T12:30:00.000Z',
    allDay: false,
    location: null,
    eventRole: 'EXTERNAL',
    ...over,
  };
}

describe('describeCalendarChange', () => {
  it('creates a new-event draft', () => {
    const draft = describeCalendarChange(null, snap({ title: 'Reunião teste' }), tz);
    expect(draft?.type).toBe('calendar_event_created');
    expect(draft?.title).toBe('Novo evento');
    expect(draft?.body).toContain('Reunião teste');
  });

  it('describes a time change', () => {
    const draft = describeCalendarChange(
      snap(),
      snap({ startAt: '2026-08-19T13:30:00.000Z', endAt: '2026-08-19T14:00:00.000Z' }),
      tz,
    );
    expect(draft?.type).toBe('calendar_event_updated');
    expect(draft?.body).toMatch(/Horário alterado/);
  });

  it('collapses multiple field changes into one draft', () => {
    const draft = describeCalendarChange(
      snap(),
      snap({ title: 'Daily Engenharia', location: 'Sala 3', startAt: '2026-08-19T13:00:00.000Z' }),
      tz,
    );
    expect(draft?.kind).toBe('updated');
    expect(draft?.changes.length).toBeGreaterThan(1);
    expect(draft?.body).toMatch(/foram alterados/);
  });

  it('ignores etag-only / identical snapshots', () => {
    expect(describeCalendarChange(snap(), snap(), tz)).toBeNull();
  });

  it('skips origin and mirror events', () => {
    expect(describeCalendarChange(snap({ eventRole: 'ORIGIN' }), snap({ title: 'X' }), tz)).toBeNull();
    expect(describeCalendarChange(null, snap({ eventRole: 'MIRROR' }), tz)).toBeNull();
  });

  it('describes deletion', () => {
    const draft = describeCalendarChange(snap({ title: 'Reunião comercial' }), snap(), tz, true);
    expect(draft?.type).toBe('calendar_event_deleted');
    expect(draft?.body).toContain('Reunião comercial');
    expect(describeCalendarChange(snap({ title: 'Reunião comercial' }), snap(), tz, true, 'GOOGLE')?.body)
      .toContain('Google Calendar');
  });

  it('does not notify during initial or recovery full sync', () => {
    expect(notificationDraftForSync('full', null, snap({ title: 'Histórico' }), tz)).toBeNull();
  });

  it('notifies on incremental create', () => {
    expect(notificationDraftForSync('incremental', null, snap({ title: 'Novo' }), tz)?.type).toBe('calendar_event_created');
  });
});
