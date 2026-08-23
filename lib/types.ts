export type ProviderName = 'GOOGLE' | 'MICROSOFT' | 'ICLOUD';
export type EventRole = 'ORIGIN' | 'MIRROR' | 'EXTERNAL';
export type ConnectionStatus = 'CONNECTED' | 'SYNCING' | 'DEGRADED' | 'AUTH_REQUIRED' | 'ERROR';
export type ColorSchemePreference = 'system' | 'light' | 'dark';
export type DigestType = 'weekly' | 'monthly';

export interface Profile {
  id: string;
  display_name: string | null;
  booking_username: string | null;
  timezone: string;
  locale: string;
  visual_theme: 'GOOGLE_STYLE' | 'MICROSOFT_STYLE';
  color_scheme: ColorSchemePreference;
  avatar_url: string | null;
  notify_event_created: boolean;
  notify_event_updated: boolean;
  notify_event_cancelled: boolean;
  email_weekly_digest: boolean;
  email_monthly_digest: boolean;
  onboarding_completed_at: string | null;
}

export interface CalendarConnection {
  id: string;
  provider: ProviderName;
  account_email: string | null;
  status: ConnectionStatus;
  last_sync_at: string | null;
  last_sync_error: string | null;
}

export interface ConnectedCalendar {
  id: string;
  connection_id: string;
  provider_calendar_id: string;
  name: string;
  color: string;
  timezone: string | null;
  is_primary: boolean;
  enabled: boolean;
  auto_block_others: boolean;
  access_role: string;
}

export interface CalendarEvent {
  id: string;
  connected_calendar_id: string;
  provider_event_id: string;
  event_role: EventRole;
  sync_group_id: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  timezone: string;
  all_day: boolean;
  status: string;
}

export interface UnifiedEvent extends CalendarEvent {
  calendars: Array<{ id: string; name: string; color: string; provider: ProviderName }>;
}

export interface EmailDigestLog {
  id: string;
  user_id: string;
  digest_type: DigestType;
  period_start: string;
  period_end: string;
  sent_at: string;
}
