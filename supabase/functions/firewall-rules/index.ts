import { adminClient, handle, json, userFromRequest } from '../_shared/function.ts';
import { applyPreset, type FirewallPrivacyPreset } from '../_shared/firewall/rules.ts';
import { removeMirrorsForRule } from '../_shared/sync/engine.ts';
import { PostgresStore } from '../_shared/sync/postgres-store.ts';
import { ProviderMirrorActor } from '../_shared/sync/runtime.ts';
import { logSafe } from '../_shared/http.ts';

type RuleBody = {
  id?: string;
  action?: 'upsert' | 'delete';
  sourceCalendarId?: string;
  destinationCalendarId?: string;
  enabled?: boolean;
  privacyPreset?: FirewallPrivacyPreset;
  syncTitle?: boolean;
  syncDescription?: boolean;
  syncLocation?: boolean;
  syncAttendees?: boolean;
  syncConference?: boolean;
  ignoreFree?: boolean;
  ignoreCancelled?: boolean;
  placeholderTitle?: string;
  removeMirrors?: boolean;
};

async function assertOwnsCalendars(
  db: ReturnType<typeof adminClient>,
  userId: string,
  sourceId: string,
  destId: string,
): Promise<void> {
  if (sourceId === destId) throw new Error('invalid_rule_same_calendar');
  const { data: rows } = await db
    .from('connected_calendars')
    .select('id, access_role')
    .eq('user_id', userId)
    .in('id', [sourceId, destId]);
  if (!rows || rows.length !== 2) throw new Error('calendar_not_found');
  const dest = rows.find((r) => r.id === destId);
  const role = String(dest?.access_role ?? '').toLowerCase();
  if (role !== 'owner' && role !== 'writer' && role !== 'editor') {
    throw new Error('calendar_read_only');
  }
}

Deno.serve((req) =>
  handle(req, async () => {
    const { userId } = await userFromRequest(req);
    const db = adminClient();
    const method = req.method.toUpperCase();

    if (method === 'GET') {
      const { data, error } = await db
        .from('calendar_firewall_rules')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return json({ rules: data ?? [] });
    }

    const body = (await req.json().catch(() => ({}))) as RuleBody;

    if (method === 'DELETE' || body.action === 'delete') {
      const id = body.id;
      if (!id) throw new Error('rule_required');
      const { data: existing } = await db
        .from('calendar_firewall_rules')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!existing) throw new Error('rule_not_found');

      const store = new PostgresStore(db);
      const actor = new ProviderMirrorActor(db);
      const { data: mirrors } = await db
        .from('calendar_events')
        .select('*, connected_calendars!inner(connection_id, provider_calendar_id)')
        .eq('firewall_rule_id', id)
        .eq('event_role', 'MIRROR')
        .in('status', ['confirmed', 'tentative']);

      const result = {
        stored: null,
        createdMirrors: 0,
        updatedMirrors: 0,
        deletedMirrors: 0,
        skipped: null,
        errors: [] as string[],
      };
      const mapped = (mirrors ?? []).map((row) => {
        const cal = row.connected_calendars as { connection_id: string; provider_calendar_id: string };
        return {
          id: String(row.id),
          userId: String(row.user_id),
          connectedCalendarId: String(row.connected_calendar_id),
          connectionId: cal.connection_id,
          providerCalendarId: cal.provider_calendar_id,
          providerEventId: String(row.provider_event_id),
          eventRole: 'MIRROR' as const,
          syncGroupId: (row.sync_group_id as string | null) ?? null,
          firewallRuleId: id,
          title: String(row.title ?? ''),
          startAt: String(row.start_at),
          endAt: String(row.end_at),
          timezone: String(row.timezone ?? 'UTC'),
          allDay: Boolean(row.all_day),
          status: row.status as 'confirmed',
        };
      });
      await removeMirrorsForRule(id, mapped, store, actor, result);
      await db.from('calendar_firewall_rules').delete().eq('id', id).eq('user_id', userId);
      logSafe('firewall-rule-deleted', { userId, ruleId: id, deletedMirrors: result.deletedMirrors });
      return json({ ok: true, deletedMirrors: result.deletedMirrors, errors: result.errors });
    }

    // upsert / enable-disable
    const sourceCalendarId = String(body.sourceCalendarId ?? '');
    const destinationCalendarId = String(body.destinationCalendarId ?? '');
    if (!body.id && (!sourceCalendarId || !destinationCalendarId)) {
      throw new Error('calendars_required');
    }

    if (sourceCalendarId && destinationCalendarId) {
      await assertOwnsCalendars(db, userId, sourceCalendarId, destinationCalendarId);
    }

    const preset = body.privacyPreset ?? 'availability';
    const fromPreset = applyPreset(preset === 'custom' ? 'availability' : preset);
    const flags =
      preset === 'custom'
        ? {
            privacyPreset: 'custom' as const,
            syncTitle: Boolean(body.syncTitle),
            syncDescription: Boolean(body.syncDescription),
            syncLocation: Boolean(body.syncLocation),
            syncAttendees: false,
            syncConference: false,
          }
        : fromPreset;

    const row = {
      user_id: userId,
      source_calendar_id: sourceCalendarId || undefined,
      destination_calendar_id: destinationCalendarId || undefined,
      enabled: body.enabled ?? true,
      privacy_preset: flags.privacyPreset,
      sync_title: flags.syncTitle,
      sync_description: flags.syncDescription,
      sync_location: flags.syncLocation,
      sync_attendees: flags.syncAttendees,
      sync_conference: flags.syncConference,
      ignore_free: body.ignoreFree ?? true,
      ignore_cancelled: body.ignoreCancelled ?? true,
      placeholder_title: body.placeholderTitle?.trim() || 'Horário reservado · Both',
      health_status: 'active',
      last_error: null,
      updated_at: new Date().toISOString(),
    };

    if (body.id) {
      const { data: existing } = await db
        .from('calendar_firewall_rules')
        .select('*')
        .eq('id', body.id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!existing) throw new Error('rule_not_found');

      const disabling = existing.enabled && body.enabled === false;
      const patch = {
        enabled: body.enabled ?? existing.enabled,
        privacy_preset: body.privacyPreset ? flags.privacyPreset : existing.privacy_preset,
        sync_title: body.privacyPreset || body.syncTitle !== undefined ? flags.syncTitle : existing.sync_title,
        sync_description:
          body.privacyPreset || body.syncDescription !== undefined
            ? flags.syncDescription
            : existing.sync_description,
        sync_location:
          body.privacyPreset || body.syncLocation !== undefined ? flags.syncLocation : existing.sync_location,
        sync_attendees: false,
        sync_conference: false,
        ignore_free: body.ignoreFree ?? existing.ignore_free,
        ignore_cancelled: body.ignoreCancelled ?? existing.ignore_cancelled,
        placeholder_title: body.placeholderTitle?.trim() || existing.placeholder_title,
        updated_at: new Date().toISOString(),
      };

      const { data: updated, error } = await db
        .from('calendar_firewall_rules')
        .update(patch)
        .eq('id', body.id)
        .eq('user_id', userId)
        .select('*')
        .single();
      if (error || !updated) throw new Error(error?.message ?? 'update_failed');

      let deletedMirrors = 0;
      let updatedMirrors = 0;
      if (disabling || body.removeMirrors) {
        const store = new PostgresStore(db);
        const actor = new ProviderMirrorActor(db);
        const { data: mirrors } = await db
          .from('calendar_events')
          .select('*, connected_calendars!inner(connection_id, provider_calendar_id)')
          .eq('firewall_rule_id', body.id)
          .eq('event_role', 'MIRROR')
          .in('status', ['confirmed', 'tentative']);
        const result = {
          stored: null,
          createdMirrors: 0,
          updatedMirrors: 0,
          deletedMirrors: 0,
          skipped: null,
          errors: [] as string[],
        };
        const mapped = (mirrors ?? []).map((m) => {
          const cal = m.connected_calendars as { connection_id: string; provider_calendar_id: string };
          return {
            id: String(m.id),
            userId: String(m.user_id),
            connectedCalendarId: String(m.connected_calendar_id),
            connectionId: cal.connection_id,
            providerCalendarId: cal.provider_calendar_id,
            providerEventId: String(m.provider_event_id),
            eventRole: 'MIRROR' as const,
            syncGroupId: (m.sync_group_id as string | null) ?? null,
            firewallRuleId: body.id!,
            title: String(m.title ?? ''),
            startAt: String(m.start_at),
            endAt: String(m.end_at),
            timezone: String(m.timezone ?? 'UTC'),
            allDay: Boolean(m.all_day),
            status: 'confirmed' as const,
          };
        });
        await removeMirrorsForRule(body.id, mapped, store, actor, result);
        deletedMirrors = result.deletedMirrors;
      } else if (
        body.privacyPreset ||
        body.syncTitle !== undefined ||
        body.syncDescription !== undefined ||
        body.syncLocation !== undefined
      ) {
        // Privacy change: refresh existing mirror payloads from origin events
        const { mirrorPayloadFromRule } = await import('../_shared/firewall/rules.ts');
        const store = new PostgresStore(db);
        const actor = new ProviderMirrorActor(db);
        const { data: mirrors } = await db
          .from('calendar_events')
          .select('*, connected_calendars!inner(connection_id, provider_calendar_id)')
          .eq('firewall_rule_id', body.id)
          .eq('event_role', 'MIRROR')
          .in('status', ['confirmed', 'tentative']);
        for (const m of mirrors ?? []) {
          if (!m.sync_group_id) continue;
          const { data: origin } = await db
            .from('calendar_events')
            .select('*')
            .eq('sync_group_id', m.sync_group_id)
            .eq('event_role', 'ORIGIN')
            .maybeSingle();
          if (!origin) continue;
          const cal = m.connected_calendars as { connection_id: string; provider_calendar_id: string };
          const storedMirror = {
            id: String(m.id),
            userId: String(m.user_id),
            connectedCalendarId: String(m.connected_calendar_id),
            connectionId: cal.connection_id,
            providerCalendarId: cal.provider_calendar_id,
            providerEventId: String(m.provider_event_id),
            eventRole: 'MIRROR' as const,
            syncGroupId: String(m.sync_group_id),
            firewallRuleId: body.id!,
            title: String(m.title ?? ''),
            startAt: String(m.start_at),
            endAt: String(m.end_at),
            timezone: String(m.timezone ?? 'UTC'),
            allDay: Boolean(m.all_day),
            status: 'confirmed' as const,
          };
          const rule = {
            id: String(updated.id),
            userId,
            sourceCalendarId: String(updated.source_calendar_id),
            destinationCalendarId: String(updated.destination_calendar_id),
            enabled: Boolean(updated.enabled),
            privacyPreset: updated.privacy_preset as FirewallPrivacyPreset,
            syncTitle: Boolean(updated.sync_title),
            syncDescription: Boolean(updated.sync_description),
            syncLocation: Boolean(updated.sync_location),
            syncAttendees: false,
            syncConference: false,
            ignoreFree: Boolean(updated.ignore_free),
            ignoreCancelled: Boolean(updated.ignore_cancelled),
            placeholderTitle: String(updated.placeholder_title),
            busyStatus: 'busy' as const,
          };
          const payload = mirrorPayloadFromRule(
            rule,
            {
              providerEventId: String(origin.provider_event_id),
              title: String(origin.title ?? ''),
              description: origin.description ? String(origin.description) : undefined,
              location: origin.location ? String(origin.location) : undefined,
              startAt: String(origin.start_at),
              endAt: String(origin.end_at),
              timezone: String(origin.timezone ?? 'UTC'),
              allDay: Boolean(origin.all_day),
              status: 'confirmed',
            },
            String(m.sync_group_id),
          );
          try {
            await actor.updateEvent(storedMirror, {
              startAt: payload.startAt,
              endAt: payload.endAt,
              allDay: payload.allDay,
              timezone: payload.timezone,
              title: payload.title,
              description: payload.description,
            });
            await store.upsertEvent({
              userId,
              connectedCalendarId: storedMirror.connectedCalendarId,
              providerEventId: storedMirror.providerEventId,
              eventRole: 'MIRROR',
              syncGroupId: storedMirror.syncGroupId,
              firewallRuleId: body.id,
              title: payload.title,
              description: payload.description,
              location: payload.location,
              startAt: payload.startAt,
              endAt: payload.endAt,
              timezone: payload.timezone,
              allDay: payload.allDay,
              status: 'confirmed',
            });
            updatedMirrors += 1;
          } catch {
            /* continue other mirrors */
          }
        }
      }

      await db
        .from('calendar_firewall_rules')
        .update({ last_processed_at: new Date().toISOString() })
        .eq('id', body.id);

      return json({ rule: updated, deletedMirrors, updatedMirrors });
    }

    const { data: inserted, error } = await db
      .from('calendar_firewall_rules')
      .upsert(
        {
          ...row,
          source_calendar_id: sourceCalendarId,
          destination_calendar_id: destinationCalendarId,
        },
        { onConflict: 'source_calendar_id,destination_calendar_id' },
      )
      .select('*')
      .single();
    if (error || !inserted) throw new Error(error?.message ?? 'upsert_failed');
    return json({ rule: inserted });
  }),
);
