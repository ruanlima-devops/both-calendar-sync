import { buildMirrorAbandonmentKey, parseMirrorAbandonmentKey } from './abandonment.ts';
import type { EventRole, EventStatus, StoredEvent, SyncStore } from './types.ts';

export class MemoryStore implements SyncStore {
  events = new Map<string, StoredEvent>();
  calendars = new Map<string, { connectionId: string; providerCalendarId: string }>();
  abandoned = new Set<string>();
  private seq = 0;

  registerCalendar(id: string, connectionId: string, providerCalendarId: string): void {
    this.calendars.set(id, { connectionId, providerCalendarId });
  }

  private key(calendarId: string, providerEventId: string): string {
    return `${calendarId}::${providerEventId}`;
  }

  async findByProviderEventId(calendarId: string, providerEventId: string): Promise<StoredEvent | null> {
    return this.events.get(this.key(calendarId, providerEventId)) ?? null;
  }

  async findById(id: string): Promise<StoredEvent | null> {
    return [...this.events.values()].find((e) => e.id === id) ?? null;
  }

  async upsertEvent(input: {
    userId: string;
    connectedCalendarId: string;
    providerEventId: string;
    eventRole: EventRole;
    syncGroupId: string | null;
    title: string;
    description?: string;
    startAt: string;
    endAt: string;
    timezone: string;
    allDay: boolean;
    location?: string;
    status: EventStatus;
    firewallRuleId?: string | null;
    recurrenceRule?: string;
    recurringEventId?: string;
  }): Promise<StoredEvent> {
    const k = this.key(input.connectedCalendarId, input.providerEventId);
    const prev = this.events.get(k);
    const cal = this.calendars.get(input.connectedCalendarId);
    const stored: StoredEvent = {
      id: prev?.id ?? `evt_${++this.seq}`,
      userId: input.userId,
      connectedCalendarId: input.connectedCalendarId,
      connectionId: cal?.connectionId ?? input.connectedCalendarId,
      providerCalendarId: cal?.providerCalendarId ?? input.connectedCalendarId,
      providerEventId: input.providerEventId,
      eventRole: input.eventRole,
      syncGroupId: input.syncGroupId,
      firewallRuleId: input.firewallRuleId ?? prev?.firewallRuleId ?? null,
      title: input.title,
      startAt: input.startAt,
      endAt: input.endAt,
      timezone: input.timezone,
      allDay: input.allDay,
      location: input.location ?? prev?.location ?? null,
      status: input.status,
      recurrenceRule: input.recurrenceRule ?? prev?.recurrenceRule ?? null,
      recurringEventId: input.recurringEventId ?? prev?.recurringEventId ?? null,
    };
    this.events.set(k, stored);
    return stored;
  }

  async markStatus(id: string, status: EventStatus): Promise<void> {
    const event = await this.findById(id);
    if (event) {
      event.status = status;
      this.events.set(this.key(event.connectedCalendarId, event.providerEventId), event);
    }
  }

  async createSyncGroup(input: { userId: string; originEventId: string; blockOtherCalendars: boolean }): Promise<{ id: string }> {
    return { id: `grp_${input.originEventId}` };
  }

  async attachSyncGroup(eventId: string, syncGroupId: string, role: EventRole): Promise<void> {
    const event = await this.findById(eventId);
    if (!event) return;
    event.syncGroupId = syncGroupId;
    event.eventRole = role;
    this.events.set(this.key(event.connectedCalendarId, event.providerEventId), event);
  }

  async listMirrors(syncGroupId: string): Promise<StoredEvent[]> {
    return [...this.events.values()].filter(
      (e) => e.syncGroupId === syncGroupId && e.eventRole === 'MIRROR',
    );
  }

  async listGroupEvents(syncGroupId: string): Promise<StoredEvent[]> {
    return [...this.events.values()].filter((e) => e.syncGroupId === syncGroupId);
  }

  async wasMirrorAbandoned(calendarId: string, originKey: string): Promise<boolean> {
    if (this.abandoned.has(`${calendarId}::${originKey}`)) return true;

    const parsed = parseMirrorAbandonmentKey(originKey);
    if (!parsed || parsed.targetCalendarId !== calendarId) return false;

    for (const mirror of this.events.values()) {
      if (
        mirror.eventRole !== 'MIRROR' ||
        mirror.status !== 'abandoned' ||
        mirror.connectedCalendarId !== calendarId ||
        !mirror.syncGroupId
      ) {
        continue;
      }
      const origin = [...this.events.values()].find(
        (e) =>
          e.syncGroupId === mirror.syncGroupId &&
          e.eventRole === 'ORIGIN' &&
          e.connectedCalendarId === parsed.originCalendarId &&
          e.providerEventId === parsed.originProviderEventId,
      );
      if (origin) return true;
    }
    return false;
  }

  async markAbandoned(id: string): Promise<void> {
    const event = await this.findById(id);
    if (!event) return;
    event.status = 'abandoned';
    this.events.set(this.key(event.connectedCalendarId, event.providerEventId), event);
    if (event.syncGroupId) {
      const origin = (await this.listGroupEvents(event.syncGroupId)).find((e) => e.eventRole === 'ORIGIN');
      if (origin) {
        const originKey = buildMirrorAbandonmentKey(
          origin.connectedCalendarId,
          origin.providerEventId,
          event.connectedCalendarId,
        );
        this.abandoned.add(`${event.connectedCalendarId}::${originKey}`);
      }
    }
  }
}

export class RecordingActor {
  creates: Array<{ calendarId: string; title: string; syncGroupId?: string }> = [];
  updates: Array<{ providerEventId: string; startAt: string }> = [];
  deletes: string[] = [];
  failCreates = false;
  failForCalendarIds = new Set<string>();
  /** When set, updateEvent throws with this httpStatus (e.g. 404 = mirror gone). */
  updateHttpStatus: number | null = null;
  private n = 0;

  async createEvent(target: { id: string; providerCalendarId: string }, input: { title: string; syncGroupId?: string }) {
    if (this.failCreates || this.failForCalendarIds.has(target.id)) throw new Error('provider_create_failed');
    this.creates.push({ calendarId: target.id, title: input.title, syncGroupId: input.syncGroupId });
    this.n += 1;
    return { providerEventId: `remote_${target.id}_${this.n}` };
  }

  async updateEvent(stored: { providerEventId: string }, input: { startAt: string }) {
    if (this.updateHttpStatus != null) {
      throw Object.assign(new Error(`provider_update_${this.updateHttpStatus}`), {
        httpStatus: this.updateHttpStatus,
      });
    }
    this.updates.push({ providerEventId: stored.providerEventId, startAt: input.startAt });
  }

  async deleteEvent(stored: { providerEventId: string }) {
    this.deletes.push(stored.providerEventId);
  }
}
