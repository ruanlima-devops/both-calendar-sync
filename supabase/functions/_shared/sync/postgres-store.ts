import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { buildMirrorAbandonmentKey, parseMirrorAbandonmentKey } from './abandonment.ts';
import type { EventRole, EventStatus, StoredEvent, SyncStore } from './types.ts';

function mapRow(row: Record<string, unknown>, connectionId = '', providerCalendarId = ''): StoredEvent {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    connectedCalendarId: String(row.connected_calendar_id),
    connectionId: String(row.connection_id ?? connectionId),
    providerCalendarId: String(row.provider_calendar_id ?? providerCalendarId),
    providerEventId: String(row.provider_event_id),
    eventRole: row.event_role as EventRole,
    syncGroupId: (row.sync_group_id as string | null) ?? null,
    firewallRuleId: (row.firewall_rule_id as string | null) ?? null,
    title: String(row.title ?? ''),
    startAt: String(row.start_at),
    endAt: String(row.end_at),
    timezone: String(row.timezone ?? 'UTC'),
    allDay: Boolean(row.all_day),
    location: (row.location as string | null) ?? null,
    status: row.status as EventStatus,
    recurrenceRule: (row.recurrence_rule as string | null) ?? null,
    recurringEventId: (row.recurring_event_id as string | null) ?? null,
  };
}

export class PostgresStore implements SyncStore {
  constructor(private readonly db: SupabaseClient) {}

  async findByProviderEventId(calendarId: string, providerEventId: string): Promise<StoredEvent | null> {
    const { data } = await this.db
      .from('calendar_events')
      .select('*, connected_calendars!inner(connection_id, provider_calendar_id)')
      .eq('connected_calendar_id', calendarId)
      .eq('provider_event_id', providerEventId)
      .maybeSingle();
    if (!data) return null;
    const cal = data.connected_calendars as { connection_id: string; provider_calendar_id: string };
    return mapRow(data as Record<string, unknown>, cal.connection_id, cal.provider_calendar_id);
  }

  async findById(id: string): Promise<StoredEvent | null> {
    const { data } = await this.db
      .from('calendar_events')
      .select('*, connected_calendars!inner(connection_id, provider_calendar_id)')
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    const cal = data.connected_calendars as { connection_id: string; provider_calendar_id: string };
    return mapRow(data as Record<string, unknown>, cal.connection_id, cal.provider_calendar_id);
  }

  async upsertEvent(input: {
    userId: string;
    connectedCalendarId: string;
    providerEventId: string;
    eventRole: EventRole;
    syncGroupId: string | null;
    title: string;
    description?: string;
    location?: string;
    startAt: string;
    endAt: string;
    timezone: string;
    allDay: boolean;
    status: EventStatus;
    etag?: string;
    updatedAt?: string;
    recurrenceRule?: string;
    recurringEventId?: string;
    firewallRuleId?: string | null;
  }): Promise<StoredEvent> {
    const { data, error } = await this.db
      .from('calendar_events')
      .upsert(
        {
          user_id: input.userId,
          connected_calendar_id: input.connectedCalendarId,
          provider_event_id: input.providerEventId,
          event_role: input.eventRole,
          sync_group_id: input.syncGroupId,
          firewall_rule_id: input.firewallRuleId ?? null,
          title: input.title,
          description: input.description ?? null,
          location: input.location ?? null,
          start_at: input.startAt,
          end_at: input.endAt,
          timezone: input.timezone,
          all_day: input.allDay,
          status: input.status,
          provider_etag: input.etag ?? null,
          provider_updated_at: input.updatedAt ?? null,
          recurrence_rule: input.recurrenceRule ?? null,
          recurring_event_id: input.recurringEventId ?? null,
        },
        { onConflict: 'connected_calendar_id,provider_event_id' },
      )
      .select('*, connected_calendars!inner(connection_id, provider_calendar_id)')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'upsert_event_failed');
    const cal = data.connected_calendars as { connection_id: string; provider_calendar_id: string };
    // Fire-and-forget: stamp availability freshness for Scheduling Links latency metrics.
    void this.db.from('availability_invalidations').insert({
      user_id: input.userId,
      connected_calendar_id: input.connectedCalendarId,
      source: 'calendar_event_upsert',
    });
    return mapRow(data as Record<string, unknown>, cal.connection_id, cal.provider_calendar_id);
  }

  async markStatus(id: string, status: EventStatus): Promise<void> {
    await this.db.from('calendar_events').update({ status }).eq('id', id);
  }

  async createSyncGroup(input: {
    userId: string;
    originEventId: string;
    blockOtherCalendars: boolean;
  }): Promise<{ id: string }> {
    const { data, error } = await this.db
      .from('sync_groups')
      .insert({
        user_id: input.userId,
        origin_event_id: input.originEventId,
        block_other_calendars: input.blockOtherCalendars,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'create_sync_group_failed');
    return { id: data.id as string };
  }

  async attachSyncGroup(eventId: string, syncGroupId: string, role: EventRole): Promise<void> {
    await this.db
      .from('calendar_events')
      .update({ sync_group_id: syncGroupId, event_role: role })
      .eq('id', eventId);
  }

  async listMirrors(syncGroupId: string): Promise<StoredEvent[]> {
    const { data } = await this.db
      .from('calendar_events')
      .select('*, connected_calendars!inner(connection_id, provider_calendar_id)')
      .eq('sync_group_id', syncGroupId)
      .eq('event_role', 'MIRROR');
    return (data ?? []).map((row) => {
      const cal = row.connected_calendars as { connection_id: string; provider_calendar_id: string };
      return mapRow(row as Record<string, unknown>, cal.connection_id, cal.provider_calendar_id);
    });
  }

  async listGroupEvents(syncGroupId: string): Promise<StoredEvent[]> {
    const { data } = await this.db
      .from('calendar_events')
      .select('*, connected_calendars!inner(connection_id, provider_calendar_id)')
      .eq('sync_group_id', syncGroupId);
    return (data ?? []).map((row) => {
      const cal = row.connected_calendars as { connection_id: string; provider_calendar_id: string };
      return mapRow(row as Record<string, unknown>, cal.connection_id, cal.provider_calendar_id);
    });
  }

  async wasMirrorAbandoned(calendarId: string, originKey: string): Promise<boolean> {
    // 1) Explicit audit trail written by markAbandoned (authoritative when present).
    const { data: logs } = await this.db
      .from('sync_log')
      .select('id')
      .eq('calendar_id', calendarId)
      .eq('operation', 'mirror_abandoned')
      .eq('detail', originKey)
      .limit(1);
    if (logs && logs.length > 0) return true;

    // 2) Structural: abandoned MIRROR on target calendar linked to matching ORIGIN via sync_group.
    // Never infer abandonment from a temporarily missing provider observation / description text.
    const parsed = parseMirrorAbandonmentKey(originKey);
    if (!parsed || parsed.targetCalendarId !== calendarId) return false;

    const { data: origins } = await this.db
      .from('calendar_events')
      .select('sync_group_id')
      .eq('connected_calendar_id', parsed.originCalendarId)
      .eq('provider_event_id', parsed.originProviderEventId)
      .eq('event_role', 'ORIGIN')
      .not('sync_group_id', 'is', null);
    const groupIds = [
      ...new Set(
        (origins ?? [])
          .map((row) => row.sync_group_id as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (groupIds.length === 0) return false;

    const { data: abandoned } = await this.db
      .from('calendar_events')
      .select('id')
      .eq('connected_calendar_id', calendarId)
      .eq('event_role', 'MIRROR')
      .eq('status', 'abandoned')
      .in('sync_group_id', groupIds)
      .limit(1);
    return Boolean(abandoned && abandoned.length > 0);
  }

  async markAbandoned(id: string): Promise<void> {
    const event = await this.findById(id);
    await this.db.from('calendar_events').update({ status: 'abandoned' }).eq('id', id);
    if (event?.syncGroupId) {
      const origin = (await this.listGroupEvents(event.syncGroupId)).find((e) => e.eventRole === 'ORIGIN');
      if (origin) {
        const originKey = buildMirrorAbandonmentKey(
          origin.connectedCalendarId,
          origin.providerEventId,
          event.connectedCalendarId,
        );
        await this.db.from('sync_log').insert({
          user_id: event.userId,
          calendar_id: event.connectedCalendarId,
          operation: 'mirror_abandoned',
          result: 'ok',
          detail: originKey,
        });
      }
    }
  }
}
