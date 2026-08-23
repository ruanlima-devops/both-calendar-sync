import { describe, expect, it } from 'vitest';
import { groupEvents } from './events';
import type { CalendarConnection, CalendarEvent, ConnectedCalendar } from './types';

function cal(over: Partial<ConnectedCalendar> & { id: string; connection_id: string }): ConnectedCalendar {
  return {
    provider_calendar_id: over.id,
    name: over.name ?? over.id,
    color: '#000',
    timezone: 'UTC',
    is_primary: false,
    enabled: true,
    auto_block_others: false,
    access_role: 'owner',
    ...over,
  };
}

function conn(id: string, provider: 'GOOGLE' | 'MICROSOFT'): CalendarConnection {
  return {
    id,
    provider,
    account_email: `${id}@x.com`,
    status: 'CONNECTED',
    last_sync_at: null,
    last_sync_error: null,
  };
}

function ev(over: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    connected_calendar_id: 'cal-g',
    provider_event_id: over.id,
    event_role: 'EXTERNAL',
    sync_group_id: null,
    title: 'Reunião',
    description: null,
    location: null,
    start_at: '2026-08-25T17:00:00.000Z',
    end_at: '2026-08-25T18:00:00.000Z',
    timezone: 'America/Sao_Paulo',
    all_day: false,
    status: 'confirmed',
    ...over,
  };
}

describe('groupEvents visual dedupe', () => {
  const calendars = [
    cal({ id: 'cal-g', connection_id: 'conn-g', name: 'Google' }),
    cal({ id: 'cal-m', connection_id: 'conn-m', name: 'Microsoft' }),
  ];
  const connections = [conn('conn-g', 'GOOGLE'), conn('conn-m', 'MICROSOFT')];

  it('shows only the origin when mirror exists in the same sync group', () => {
    const unified = groupEvents(
      [
        ev({ id: 'o1', event_role: 'ORIGIN', sync_group_id: 'sg1', title: 'Reunião Projeto X' }),
        ev({
          id: 'm1',
          event_role: 'MIRROR',
          sync_group_id: 'sg1',
          connected_calendar_id: 'cal-m',
          title: 'Horário reservado · Unify',
        }),
      ],
      calendars,
      connections,
    );
    expect(unified).toHaveLength(1);
    expect(unified[0]?.title).toBe('Reunião Projeto X');
    expect(unified[0]?.calendars.map((c: { id: string }) => c.id).sort()).toEqual(['cal-g', 'cal-m']);
  });

  it('shows a discrete reserved slot when only the mirror calendar is visible', () => {
    const unified = groupEvents(
      [
        ev({
          id: 'm1',
          event_role: 'MIRROR',
          sync_group_id: 'sg1',
          connected_calendar_id: 'cal-m',
          title: 'Horário reservado · Unify',
        }),
      ],
      calendars.filter((c: ConnectedCalendar) => c.id === 'cal-m'),
      connections,
    );
    expect(unified).toHaveLength(1);
    expect(unified[0]?.title).toBe('Horário reservado');
  });
});
