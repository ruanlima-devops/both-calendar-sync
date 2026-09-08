export type ProviderName = 'GOOGLE' | 'MICROSOFT' | 'ICLOUD';
export type EventRole = 'ORIGIN' | 'MIRROR' | 'EXTERNAL';
export type EventStatus = 'confirmed' | 'cancelled' | 'tentative' | 'abandoned';
export type ConnectionStatus = 'CONNECTED' | 'SYNCING' | 'DEGRADED' | 'AUTH_REQUIRED' | 'ERROR';

export interface NormalizedEvent {
  providerEventId: string;
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
  unifySyncGroupId?: string;
  unifyEventRole?: EventRole;
  isDeleted?: boolean;
  /** Google transparency / Microsoft showAs — used by Calendar Firewall ignore_free. */
  busyTransparency?: string;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  location?: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  role: EventRole;
  syncGroupId?: string;
  /** Optional client idempotency id (Google event id when valid). */
  clientEventId?: string;
  attendees?: Array<{ email: string; displayName?: string }>;
}

export interface CalendarInfo {
  providerCalendarId: string;
  name: string;
  color?: string;
  timezone?: string;
  isPrimary: boolean;
  accessRole: string;
}

export interface WatchInfo {
  externalSubscriptionId: string;
  externalResourceId?: string;
  expiresAt: string;
  clientState?: string;
}

export interface SyncPage {
  events: NormalizedEvent[];
  nextSyncToken?: string;
  nextDeltaLink?: string;
  nextPageToken?: string;
  needsFullResync?: boolean;
}

export interface StoredEvent {
  id: string;
  userId: string;
  connectedCalendarId: string;
  connectionId: string;
  providerCalendarId: string;
  providerEventId: string;
  eventRole: EventRole;
  syncGroupId: string | null;
  firewallRuleId?: string | null;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  location?: string | null;
  status: EventStatus;
}

export interface TargetCalendar {
  id: string;
  connectionId: string;
  provider: ProviderName;
  providerCalendarId: string;
  enabled: boolean;
  accessRole: string;
}

export interface SyncContext {
  userId: string;
  connectionId: string;
  connectedCalendarId: string;
  provider: ProviderName;
  autoBlockOthers: boolean;
  targets: TargetCalendar[];
  /** Enabled Calendar Firewall rules whose source is this calendar. */
  firewallRules: import('../firewall/rules.ts').FirewallRule[];
}

export interface ApplyResult {
  stored: StoredEvent | null;
  createdMirrors: number;
  updatedMirrors: number;
  deletedMirrors: number;
  skipped: string | null;
  errors: string[];
}

export interface CalendarProvider {
  name: ProviderName;
  getAuthorizationUrl(input: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    accountId: string;
    accountEmail: string;
  }>;
  refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt: string;
  }>;
  listCalendars(accessToken: string): Promise<CalendarInfo[]>;
  initialSync(
    accessToken: string,
    calendarId: string,
    pageToken?: string,
    range?: { timeMin: string; timeMax: string },
  ): Promise<SyncPage>;
  incrementalSync(
    accessToken: string,
    calendarId: string,
    token: string,
    pageToken?: string,
  ): Promise<SyncPage>;
  createEvent(
    accessToken: string,
    calendarId: string,
    input: CreateEventInput,
  ): Promise<{ providerEventId: string; etag?: string }>;
  updateEvent(
    accessToken: string,
    calendarId: string,
    providerEventId: string,
    input: Partial<CreateEventInput> & { startAt: string; endAt: string; allDay: boolean; timezone: string },
  ): Promise<void>;
  deleteEvent(
    accessToken: string,
    calendarId: string,
    providerEventId: string,
  ): Promise<void>;
  createWebhookSubscription(
    accessToken: string,
    calendarId: string,
    webhookUrl: string,
    clientState?: string,
  ): Promise<WatchInfo>;
  renewWebhookSubscription(
    accessToken: string,
    subscription: WatchInfo,
    webhookUrl: string,
  ): Promise<WatchInfo>;
  deleteWebhookSubscription(
    accessToken: string,
    subscription: WatchInfo,
  ): Promise<void>;
}

export interface SyncStore {
  findByProviderEventId(
    calendarId: string,
    providerEventId: string,
  ): Promise<StoredEvent | null>;
  findById(id: string): Promise<StoredEvent | null>;
  upsertEvent(input: {
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
  }): Promise<StoredEvent>;
  markStatus(id: string, status: EventStatus): Promise<void>;
  createSyncGroup(input: {
    userId: string;
    originEventId: string;
    blockOtherCalendars: boolean;
  }): Promise<{ id: string }>;
  attachSyncGroup(eventId: string, syncGroupId: string, role: EventRole): Promise<void>;
  listMirrors(syncGroupId: string): Promise<StoredEvent[]>;
  listGroupEvents(syncGroupId: string): Promise<StoredEvent[]>;
  wasMirrorAbandoned(calendarId: string, originKey: string): Promise<boolean>;
  markAbandoned(id: string): Promise<void>;
}

export interface MirrorActor {
  createEvent(
    target: TargetCalendar,
    input: CreateEventInput,
  ): Promise<{ providerEventId: string }>;
  updateEvent(
    stored: StoredEvent,
    input: {
      startAt: string;
      endAt: string;
      allDay: boolean;
      timezone: string;
      title: string;
      description?: string;
    },
  ): Promise<void>;
  deleteEvent(stored: StoredEvent): Promise<void>;
}

/** User-visible title for Unify-managed busy placeholders (privacy-preserving). */
export const BUSY_TITLE = 'Horário reservado · Both';

/** Institutional description — never copies origin details. */
export const BUSY_DESCRIPTION =
  'Este horário foi reservado automaticamente pelo Both para evitar conflitos entre suas agendas.\n\nOs detalhes do compromisso original permanecem privados.\n\nGerencie suas agendas pelo Both.';

export const BUSY_DESCRIPTION_COMPACT =
  'Horário reservado automaticamente pelo Both para evitar conflitos entre agendas.';

export const UNIFY_PROP_GROUP = 'unifySyncGroupId';
export const UNIFY_PROP_ROLE = 'unifyEventRole';
export const MS_PROP_GUID = '66f5a389-4445-4c0a-9b0c-7f3c8e8e0001';
