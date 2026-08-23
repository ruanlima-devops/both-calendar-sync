import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { persistCalendarNotification } from './store.ts';

function fakeClient() {
  const upserts: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      expect(table).toBe('notifications');
      return {
        upsert(row: Record<string, unknown>, opts: { onConflict?: string; ignoreDuplicates?: boolean }) {
          expect(opts.onConflict).toBe('user_id,dedupe_key');
          expect(opts.ignoreDuplicates).toBe(true);
          upserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, upserts };
}

describe('persistCalendarNotification', () => {
  it('writes a provider-agnostic row with a stable dedupe key', async () => {
    const { db, upserts } = fakeClient();
    await persistCalendarNotification(db, {
      userId: 'user-1',
      provider: 'GOOGLE',
      connectionId: 'conn-1',
      eventId: 'evt-1',
      providerEventId: 'g-123',
      draft: {
        kind: 'created',
        type: 'calendar_event_created',
        title: 'Novo evento',
        body: 'Reunião teste',
        changes: [],
      },
      startAt: '2026-08-19T20:00:00.000Z',
      allDay: false,
      version: 'etag-1',
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      user_id: 'user-1',
      provider: 'GOOGLE',
      type: 'calendar_event_created',
      entity_id: 'evt-1',
      dedupe_key: 'GOOGLE:conn-1:g-123:created:etag-1',
    });
    const meta = upserts[0].metadata as Record<string, unknown>;
    expect(JSON.stringify(meta)).not.toMatch(/token|secret|authorization/i);
  });

  it('reuses the same key for a repeated webhook', async () => {
    const { db, upserts } = fakeClient();
    const input = {
      userId: 'user-1',
      provider: 'MICROSOFT' as const,
      connectionId: 'conn-2',
      eventId: 'evt-2',
      providerEventId: 'm-9',
      draft: {
        kind: 'updated' as const,
        type: 'calendar_event_updated' as const,
        title: 'Evento atualizado',
        body: 'Horário alterado',
        changes: ['time' as const],
      },
      startAt: '2026-08-19T20:00:00.000Z',
      allDay: false,
      version: '2026-08-19T20:01:00.000Z',
    };
    await persistCalendarNotification(db, input);
    await persistCalendarNotification(db, input);
    expect(upserts[0].dedupe_key).toBe(upserts[1].dedupe_key);
  });
});
