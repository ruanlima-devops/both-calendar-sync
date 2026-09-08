import {
  BUSY_DESCRIPTION,
  BUSY_TITLE,
  type ApplyResult,
  type CreateEventInput,
  type EventRole,
  type MirrorActor,
  type NormalizedEvent,
  type StoredEvent,
  type SyncContext,
  type SyncStore,
  type TargetCalendar,
} from './types.ts';
import { optionalUuidOrNull } from './metadata.ts';
import {
  mirrorPayloadFromRule,
  shouldPropagateEvent,
  type FirewallRule,
} from '../firewall/rules.ts';

function timesChanged(a: StoredEvent, incoming: NormalizedEvent): boolean {
  return a.startAt !== incoming.startAt || a.endAt !== incoming.endAt || a.allDay !== incoming.allDay;
}

function writableTargets(ctx: SyncContext): TargetCalendar[] {
  return ctx.targets.filter(
    (t) =>
      t.enabled &&
      t.id !== ctx.connectedCalendarId &&
      (t.accessRole === 'owner' || t.accessRole === 'writer' || t.accessRole === 'editor'),
  );
}

function legacyBusyInput(incoming: NormalizedEvent, syncGroupId: string): CreateEventInput {
  return {
    title: BUSY_TITLE,
    description: BUSY_DESCRIPTION,
    startAt: incoming.startAt,
    endAt: incoming.endAt,
    timezone: incoming.timezone,
    allDay: incoming.allDay,
    role: 'MIRROR',
    syncGroupId,
  };
}

/** Resolve destination targets + rules for this source calendar. */
function resolveFirewallTargets(
  ctx: SyncContext,
  incoming: NormalizedEvent,
): Array<{ target: TargetCalendar; rule: FirewallRule | null }> {
  const writable = writableTargets(ctx);
  const rules = (ctx.firewallRules ?? []).filter((r) => r.enabled && r.sourceCalendarId === ctx.connectedCalendarId);

  if (rules.length > 0) {
    const out: Array<{ target: TargetCalendar; rule: FirewallRule | null }> = [];
    for (const rule of rules) {
      if (!shouldPropagateEvent(rule, incoming)) continue;
      const target = writable.find((t) => t.id === rule.destinationCalendarId);
      if (!target) continue;
      out.push({ target, rule });
    }
    return out;
  }

  // Legacy: auto_block_others → all writable calendars with privacy-first payload
  if (ctx.autoBlockOthers) {
    return writable.map((target) => ({ target, rule: null }));
  }
  return [];
}

export async function applyIncomingEvent(
  ctx: SyncContext,
  incoming: NormalizedEvent,
  store: SyncStore,
  actor: MirrorActor,
): Promise<ApplyResult> {
  const result: ApplyResult = {
    stored: null,
    createdMirrors: 0,
    updatedMirrors: 0,
    deletedMirrors: 0,
    skipped: null,
    errors: [],
  };

  const existing = await store.findByProviderEventId(ctx.connectedCalendarId, incoming.providerEventId);
  const incomingDeleted = incoming.isDeleted || incoming.status === 'cancelled';

  if (existing?.eventRole === 'MIRROR' || incoming.unifyEventRole === 'MIRROR') {
    return applyMirrorChange(ctx, incoming, existing, store, result);
  }

  if (incomingDeleted) {
    return applyOriginDelete(existing, store, actor, result);
  }

  const role: EventRole =
    existing?.eventRole === 'ORIGIN' || incoming.unifyEventRole === 'ORIGIN'
      ? 'ORIGIN'
      : existing?.eventRole === 'EXTERNAL'
        ? 'EXTERNAL'
        : 'EXTERNAL';

  const stored = await store.upsertEvent({
    userId: ctx.userId,
    connectedCalendarId: ctx.connectedCalendarId,
    providerEventId: incoming.providerEventId,
    eventRole: role,
    syncGroupId: existing?.syncGroupId ?? optionalUuidOrNull(incoming.unifySyncGroupId),
    title: incoming.title,
    description: incoming.description,
    location: incoming.location,
    startAt: incoming.startAt,
    endAt: incoming.endAt,
    timezone: incoming.timezone,
    allDay: incoming.allDay,
    status: incoming.status === 'abandoned' ? 'confirmed' : incoming.status,
    etag: incoming.etag,
    updatedAt: incoming.updatedAt,
    recurrenceRule: incoming.recurrenceRule,
    recurringEventId: incoming.recurringEventId,
  });
  result.stored = stored;

  if (stored.syncGroupId) {
    if (existing && timesChanged(existing, incoming)) {
      await propagateOriginTimes(stored, incoming, store, actor, result, ctx);
    }
    await createMirrorsForOrigin(ctx, stored, incoming, store, actor, result);
    return result;
  }

  if (resolveFirewallTargets(ctx, incoming).length > 0) {
    await createMirrorsForOrigin(ctx, stored, incoming, store, actor, result);
  }

  return result;
}

async function applyMirrorChange(
  ctx: SyncContext,
  incoming: NormalizedEvent,
  existing: StoredEvent | null,
  store: SyncStore,
  result: ApplyResult,
): Promise<ApplyResult> {
  if (incoming.isDeleted || incoming.status === 'cancelled') {
    if (existing) {
      await store.markAbandoned(existing.id);
      result.stored = { ...existing, status: 'abandoned' };
    }
    result.skipped = 'mirror_deleted_externally';
    return result;
  }

  if (existing) {
    result.stored = await store.upsertEvent({
      userId: ctx.userId,
      connectedCalendarId: ctx.connectedCalendarId,
      providerEventId: incoming.providerEventId,
      eventRole: 'MIRROR',
      syncGroupId: existing.syncGroupId,
      firewallRuleId: existing.firewallRuleId,
      title: existing.title || BUSY_TITLE,
      description: BUSY_DESCRIPTION,
      startAt: incoming.startAt,
      endAt: incoming.endAt,
      timezone: incoming.timezone,
      allDay: incoming.allDay,
      status: 'confirmed',
      etag: incoming.etag,
      updatedAt: incoming.updatedAt,
    });
  }
  result.skipped = 'mirror_no_propagate';
  return result;
}

async function applyOriginDelete(
  existing: StoredEvent | null,
  store: SyncStore,
  actor: MirrorActor,
  result: ApplyResult,
): Promise<ApplyResult> {
  if (!existing) {
    result.skipped = 'unknown_deleted_event';
    return result;
  }
  await store.markStatus(existing.id, 'cancelled');
  result.stored = { ...existing, status: 'cancelled' };
  if (!existing.syncGroupId) return result;

  const mirrors = await store.listMirrors(existing.syncGroupId);
  for (const mirror of mirrors) {
    if (mirror.status === 'abandoned' || mirror.status === 'cancelled') continue;
    try {
      await actor.deleteEvent(mirror);
      await store.markStatus(mirror.id, 'cancelled');
      result.deletedMirrors += 1;
    } catch (err) {
      result.errors.push(`mirror_delete_failed:${mirror.id}:${String(err)}`);
    }
  }
  return result;
}

async function propagateOriginTimes(
  origin: StoredEvent,
  incoming: NormalizedEvent,
  store: SyncStore,
  actor: MirrorActor,
  result: ApplyResult,
  ctx?: SyncContext,
): Promise<void> {
  if (!origin.syncGroupId) return;
  const mirrors = await store.listMirrors(origin.syncGroupId);
  const rules = ctx?.firewallRules ?? [];

  for (const mirror of mirrors) {
    if (mirror.status === 'abandoned' || mirror.status === 'cancelled') continue;
    const rule = rules.find((r) => r.id === mirror.firewallRuleId) ?? null;
    const payload = rule
      ? mirrorPayloadFromRule(rule, incoming, origin.syncGroupId)
      : legacyBusyInput(incoming, origin.syncGroupId);

    try {
      await actor.updateEvent(mirror, {
        startAt: payload.startAt,
        endAt: payload.endAt,
        allDay: payload.allDay,
        timezone: payload.timezone,
        title: payload.title,
        description: payload.description,
      });
      await store.upsertEvent({
        userId: origin.userId,
        connectedCalendarId: mirror.connectedCalendarId,
        providerEventId: mirror.providerEventId,
        eventRole: 'MIRROR',
        syncGroupId: origin.syncGroupId,
        firewallRuleId: mirror.firewallRuleId,
        title: payload.title,
        description: payload.description,
        location: payload.location,
        startAt: payload.startAt,
        endAt: payload.endAt,
        timezone: payload.timezone,
        allDay: payload.allDay,
        status: 'confirmed',
      });
      result.updatedMirrors += 1;
    } catch (err) {
      result.errors.push(`mirror_update_failed:${mirror.id}:${String(err)}`);
    }
  }
}

export async function createMirrorsForOrigin(
  ctx: SyncContext,
  origin: StoredEvent,
  incoming: NormalizedEvent,
  store: SyncStore,
  actor: MirrorActor,
  result: ApplyResult,
): Promise<void> {
  const pairs = resolveFirewallTargets(ctx, incoming);
  if (pairs.length === 0) return;

  let groupId = origin.syncGroupId;
  if (!groupId) {
    const group = await store.createSyncGroup({
      userId: ctx.userId,
      originEventId: origin.id,
      blockOtherCalendars: true,
    });
    groupId = group.id;
    await store.attachSyncGroup(origin.id, groupId, 'ORIGIN');
  } else {
    await store.attachSyncGroup(origin.id, groupId, 'ORIGIN');
  }
  result.stored = { ...origin, eventRole: 'ORIGIN', syncGroupId: groupId };

  for (const { target, rule } of pairs) {
    const originKey = `${origin.connectedCalendarId}:${origin.providerEventId}:${target.id}`;
    if (await store.wasMirrorAbandoned(target.id, originKey)) {
      result.skipped = result.skipped ?? 'abandoned_mirror_not_recreated';
      continue;
    }
    const already = (await store.listMirrors(groupId)).find(
      (m) => m.connectedCalendarId === target.id && (m.status === 'confirmed' || m.status === 'tentative'),
    );
    if (already) continue;

    const payload = rule
      ? mirrorPayloadFromRule(rule, incoming, groupId)
      : legacyBusyInput(incoming, groupId);

    try {
      const created = await actor.createEvent(target, payload);
      await store.upsertEvent({
        userId: ctx.userId,
        connectedCalendarId: target.id,
        providerEventId: created.providerEventId,
        eventRole: 'MIRROR',
        syncGroupId: groupId,
        firewallRuleId: rule?.id ?? null,
        title: payload.title,
        description: payload.description,
        location: payload.location,
        startAt: incoming.startAt,
        endAt: incoming.endAt,
        timezone: incoming.timezone,
        allDay: incoming.allDay,
        status: 'confirmed',
      });
      result.createdMirrors += 1;
    } catch (err) {
      result.errors.push(`mirror_create_failed:${target.id}:${String(err)}`);
    }
  }
}

/** Deletes all Unify-managed mirrors for an origin (toggle block OFF). */
export async function removeMirrorsForOrigin(
  origin: StoredEvent,
  store: SyncStore,
  actor: MirrorActor,
  result: ApplyResult,
): Promise<void> {
  if (!origin.syncGroupId) return;
  const mirrors = await store.listMirrors(origin.syncGroupId);
  for (const mirror of mirrors) {
    if (mirror.status === 'abandoned' || mirror.status === 'cancelled') continue;
    try {
      await actor.deleteEvent(mirror);
      await store.markStatus(mirror.id, 'cancelled');
      result.deletedMirrors += 1;
    } catch (err) {
      result.errors.push(`mirror_delete_failed:${mirror.id}:${String(err)}`);
    }
  }
}

/** Remove mirrors created by a specific firewall rule. */
export async function removeMirrorsForRule(
  ruleId: string,
  mirrors: StoredEvent[],
  store: SyncStore,
  actor: MirrorActor,
  result: ApplyResult,
): Promise<void> {
  for (const mirror of mirrors) {
    if (mirror.firewallRuleId !== ruleId) continue;
    if (mirror.status === 'abandoned' || mirror.status === 'cancelled') continue;
    try {
      await actor.deleteEvent(mirror);
      await store.markStatus(mirror.id, 'cancelled');
      result.deletedMirrors += 1;
    } catch (err) {
      result.errors.push(`mirror_delete_failed:${mirror.id}:${String(err)}`);
    }
  }
}

export async function createOriginWithOptionalMirrors(
  ctx: SyncContext,
  originCalendar: { id: string; connectionId: string; providerCalendarId: string },
  input: {
    title: string;
    description?: string;
    location?: string;
    startAt: string;
    endAt: string;
    timezone: string;
    allDay: boolean;
    blockOtherCalendars: boolean;
    clientEventId?: string;
    attendees?: Array<{ email: string; displayName?: string }>;
  },
  store: SyncStore,
  actor: MirrorActor,
): Promise<ApplyResult> {
  const created = await actor.createEvent(
    {
      id: originCalendar.id,
      connectionId: originCalendar.connectionId,
      provider: ctx.provider,
      providerCalendarId: originCalendar.providerCalendarId,
      enabled: true,
      accessRole: 'writer',
    },
    {
      title: input.title,
      description: input.description,
      location: input.location,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      allDay: input.allDay,
      role: 'ORIGIN',
      clientEventId: input.clientEventId,
      attendees: input.attendees,
    },
  );

  const stored = await store.upsertEvent({
    userId: ctx.userId,
    connectedCalendarId: originCalendar.id,
    providerEventId: created.providerEventId,
    eventRole: 'ORIGIN',
    syncGroupId: null,
    title: input.title,
    description: input.description,
    location: input.location,
    startAt: input.startAt,
    endAt: input.endAt,
    timezone: input.timezone,
    allDay: input.allDay,
    status: 'confirmed',
  });

  const result: ApplyResult = {
    stored,
    createdMirrors: 0,
    updatedMirrors: 0,
    deletedMirrors: 0,
    skipped: null,
    errors: [],
  };

  if (input.blockOtherCalendars) {
    await createMirrorsForOrigin(
      {
        ...ctx,
        connectedCalendarId: originCalendar.id,
        // Prefer directional firewall rules when present; otherwise legacy broadcast.
        autoBlockOthers: !(ctx.firewallRules && ctx.firewallRules.length > 0),
      },
      stored,
      {
        providerEventId: created.providerEventId,
        title: input.title,
        description: input.description,
        location: input.location,
        startAt: input.startAt,
        endAt: input.endAt,
        timezone: input.timezone,
        allDay: input.allDay,
        status: 'confirmed',
        busyTransparency: 'opaque',
      },
      store,
      actor,
      result,
    );
  }

  return result;
}

export function groupForUnifiedView<
  T extends { id: string; syncGroupId: string | null; eventRole: EventRole; status: string },
>(events: T[]): T[] {
  const visible: T[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.status !== 'confirmed' && event.status !== 'tentative') continue;
    if (event.eventRole === 'MIRROR') continue;
    if (event.syncGroupId) {
      if (seen.has(event.syncGroupId)) continue;
      seen.add(event.syncGroupId);
    }
    visible.push(event);
  }
  return visible;
}

export function sameTimeDifferentCalendarsAllowed(
  a: { connectedCalendarId: string },
  b: { connectedCalendarId: string },
): boolean {
  return a.connectedCalendarId !== b.connectedCalendarId;
}

export function isSyncTokenInvalid(status: number, message?: string): boolean {
  if (status === 410) return true;
  const text = (message ?? '').toLowerCase();
  return text.includes('synctoken') && (text.includes('invalid') || text.includes('gone'));
}

export function isDeltaLinkInvalid(status: number, message?: string): boolean {
  if (status === 410 || status === 404) return true;
  const text = (message ?? '').toLowerCase();
  return text.includes('delta') && (text.includes('resync') || text.includes('expired') || text.includes('malformed'));
}
