import { describe, expect, it } from 'vitest';
import {
  groupNotifications,
  notificationsA11yLabel,
  relativeTime,
  unreadBadgeLabel,
  type AppNotification,
} from './notifications';

function item(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: '1',
    user_id: 'u',
    type: 'calendar_event_created',
    provider: 'GOOGLE',
    connection_id: 'c',
    entity_type: 'calendar_event',
    entity_id: 'e',
    title: 'Novo evento',
    body: 'Reunião',
    metadata: {},
    dedupe_key: 'k',
    read_at: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

describe('notification presentation', () => {
  it('caps the unread badge', () => {
    expect(unreadBadgeLabel(0)).toBeNull();
    expect(unreadBadgeLabel(3)).toBe('3');
    expect(unreadBadgeLabel(10)).toBe('9+');
  });

  it('labels the bell for screen readers', () => {
    expect(notificationsA11yLabel(0)).toBe('Notificações');
    expect(notificationsA11yLabel(3)).toBe('Notificações, 3 não lidas');
  });

  it('formats relative time in Portuguese', () => {
    const now = new Date('2026-08-19T15:00:00.000Z');
    expect(relativeTime('2026-08-19T14:58:00.000Z', now)).toBe('há 2 min');
    expect(relativeTime('2026-08-19T14:00:00.000Z', now)).toBe('há 1 h');
  });

  it('groups by today and yesterday', () => {
    const now = new Date();
    const yesterday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 15, 0, 0),
    );
    const groups = groupNotifications(
      [
        item({ id: 'a', created_at: now.toISOString() }),
        item({ id: 'b', created_at: yesterday.toISOString() }),
      ],
      'UTC',
    );
    expect(groups.map((g) => g.label)).toEqual(['Hoje', 'Ontem']);
  });
});
