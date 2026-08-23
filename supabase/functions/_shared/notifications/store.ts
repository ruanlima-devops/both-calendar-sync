import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { logSafe } from '../http.ts';
import type { ProviderName } from '../sync/types.ts';
import type { CalendarNotificationDraft } from './messages.ts';

export async function persistCalendarNotification(
  db: SupabaseClient,
  input: {
    userId: string;
    provider: ProviderName;
    connectionId: string;
    eventId?: string | null;
    providerEventId: string;
    draft: CalendarNotificationDraft;
    startAt: string;
    allDay: boolean;
    version: string;
  },
): Promise<void> {
  const dedupeKey = [
    input.provider,
    input.connectionId,
    input.providerEventId,
    input.draft.kind,
    input.version,
  ].join(':');

  const { error } = await db.from('notifications').upsert(
    {
      user_id: input.userId,
      type: input.draft.type,
      provider: input.provider,
      connection_id: input.connectionId,
      entity_type: 'calendar_event',
      entity_id: input.eventId ?? null,
      title: input.draft.title,
      body: input.draft.body,
      metadata: {
        providerEventId: input.providerEventId,
        startAt: input.startAt,
        allDay: input.allDay,
        changes: input.draft.changes,
      },
      dedupe_key: dedupeKey,
    },
    { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
  );

  if (error) {
    logSafe('[notifications] persist_failed', { message: error.message, type: input.draft.type });
  }
}
