-- Apple iCloud Calendar via CalDAV (app-specific password)

-- Expand provider checks
alter table public.calendar_connections drop constraint if exists calendar_connections_provider_check;
alter table public.calendar_connections
  add constraint calendar_connections_provider_check
  check (provider in ('GOOGLE', 'MICROSOFT', 'ICLOUD'));

alter table public.oauth_states drop constraint if exists oauth_states_provider_check;
alter table public.oauth_states
  add constraint oauth_states_provider_check
  check (provider in ('GOOGLE', 'MICROSOFT', 'ICLOUD'));

alter table public.webhook_subscriptions drop constraint if exists webhook_subscriptions_provider_check;
alter table public.webhook_subscriptions
  add constraint webhook_subscriptions_provider_check
  check (provider in ('GOOGLE', 'MICROSOFT', 'ICLOUD'));

alter table public.notifications drop constraint if exists notifications_provider_check;
alter table public.notifications
  add constraint notifications_provider_check
  check (provider is null or provider in ('GOOGLE', 'MICROSOFT', 'UNIFY', 'ICLOUD'));

-- CalDAV discovery endpoints (non-secret)
alter table public.calendar_connections
  add column if not exists caldav_principal_url text,
  add column if not exists caldav_calendar_home_url text,
  add column if not exists next_sync_at timestamptz,
  add column if not exists poll_interval_seconds int not null default 90
    check (poll_interval_seconds between 30 and 3600),
  add column if not exists consecutive_sync_failures int not null default 0;

create index if not exists calendar_connections_icloud_due_idx
  on public.calendar_connections (next_sync_at)
  where provider = 'ICLOUD' and status in ('CONNECTED', 'SYNCING', 'DEGRADED');

-- Sync cursors for CalDAV
alter table public.sync_state
  add column if not exists caldav_sync_token text,
  add column if not exists caldav_ctag text;
