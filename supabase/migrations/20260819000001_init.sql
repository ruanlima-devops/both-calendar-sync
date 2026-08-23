-- Unify MVP schema
create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres, service_role;
grant all on all tables in schema private to postgres, service_role;
alter default privileges in schema private grant all on tables to postgres, service_role;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  locale text not null default 'pt-BR',
  visual_theme text not null default 'GOOGLE_STYLE'
    check (visual_theme in ('GOOGLE_STYLE', 'MICROSOFT_STYLE')),
  plan_tier text not null default 'beta',
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- calendar_connections (NO tokens)
-- ---------------------------------------------------------------------------
create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('GOOGLE', 'MICROSOFT')),
  provider_account_id text not null,
  account_email text,
  status text not null default 'CONNECTED'
    check (status in ('CONNECTED', 'SYNCING', 'DEGRADED', 'AUTH_REQUIRED', 'ERROR')),
  last_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider),
  unique (user_id, provider, provider_account_id)
);

create index calendar_connections_user_id_idx on public.calendar_connections (user_id);

create table private.calendar_secrets (
  connection_id uuid primary key references public.calendar_connections (id) on delete cascade,
  encrypted_refresh_token text not null,
  encrypted_access_token text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('GOOGLE', 'MICROSOFT')),
  state text not null unique,
  code_verifier text not null,
  redirect_to text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- connected_calendars
-- ---------------------------------------------------------------------------
create table public.connected_calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  provider_calendar_id text not null,
  name text not null,
  color text not null default '#2563eb',
  timezone text,
  is_primary boolean not null default false,
  enabled boolean not null default true,
  auto_block_others boolean not null default false,
  access_role text not null default 'writer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, provider_calendar_id)
);

create index connected_calendars_user_id_idx on public.connected_calendars (user_id);

-- ---------------------------------------------------------------------------
-- sync_groups
-- ---------------------------------------------------------------------------
create table public.sync_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  origin_event_id uuid,
  block_other_calendars boolean not null default true,
  mirror_privacy text not null default 'BUSY_ONLY',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sync_groups_user_id_idx on public.sync_groups (user_id);

-- ---------------------------------------------------------------------------
-- calendar_events
-- ---------------------------------------------------------------------------
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  connected_calendar_id uuid not null references public.connected_calendars (id) on delete cascade,
  provider_event_id text not null,
  sync_group_id uuid references public.sync_groups (id) on delete set null,
  event_role text not null default 'EXTERNAL'
    check (event_role in ('ORIGIN', 'MIRROR', 'EXTERNAL')),
  title text,
  description text,
  location text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'UTC',
  all_day boolean not null default false,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled', 'tentative', 'abandoned')),
  recurrence_rule text,
  recurring_event_id text,
  provider_etag text,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connected_calendar_id, provider_event_id)
);

alter table public.sync_groups
  add constraint sync_groups_origin_event_fk
  foreign key (origin_event_id) references public.calendar_events (id) on delete set null;

create index calendar_events_user_range_idx on public.calendar_events (user_id, start_at, end_at);
create index calendar_events_sync_group_idx on public.calendar_events (sync_group_id);
create index calendar_events_role_idx on public.calendar_events (connected_calendar_id, event_role);

-- ---------------------------------------------------------------------------
-- webhook_subscriptions / sync_state / jobs / logs
-- ---------------------------------------------------------------------------
create table public.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  connected_calendar_id uuid references public.connected_calendars (id) on delete cascade,
  provider text not null check (provider in ('GOOGLE', 'MICROSOFT')),
  external_subscription_id text not null,
  external_resource_id text,
  client_state_hash text,
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expired', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index webhook_subscriptions_expiry_idx
  on public.webhook_subscriptions (status, expires_at);

create table public.sync_state (
  id uuid primary key default gen_random_uuid(),
  connected_calendar_id uuid not null unique references public.connected_calendars (id) on delete cascade,
  google_sync_token text,
  google_page_token text,
  microsoft_delta_link text,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text
);

create table public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  connection_id uuid not null references public.calendar_connections (id) on delete cascade,
  connected_calendar_id uuid references public.connected_calendars (id) on delete cascade,
  reason text not null,
  dedupe_key text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create unique index sync_jobs_dedupe_pending_idx
  on public.sync_jobs (dedupe_key)
  where status in ('pending', 'running');

create index sync_jobs_status_idx on public.sync_jobs (status, created_at);

create table public.sync_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  provider text,
  calendar_id uuid,
  operation text not null,
  result text not null,
  latency_ms integer,
  error_code text,
  detail text,
  created_at timestamptz not null default now()
);

create index sync_log_user_created_idx on public.sync_log (user_id, created_at desc);

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  name text not null,
  created_at timestamptz not null default now()
);

create index product_events_name_idx on public.product_events (name, created_at);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger calendar_connections_updated_at before update on public.calendar_connections
  for each row execute function public.set_updated_at();
create trigger connected_calendars_updated_at before update on public.connected_calendars
  for each row execute function public.set_updated_at();
create trigger calendar_events_updated_at before update on public.calendar_events
  for each row execute function public.set_updated_at();
create trigger sync_groups_updated_at before update on public.sync_groups
  for each row execute function public.set_updated_at();
create trigger webhook_subscriptions_updated_at before update on public.webhook_subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- new user → profile
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, timezone, locale)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email, 'user'), '@', 1)
    ),
    coalesce(new.raw_user_meta_data->>'timezone', 'UTC'),
    coalesce(new.raw_user_meta_data->>'locale', 'pt-BR')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.connected_calendars enable row level security;
alter table public.calendar_events enable row level security;
alter table public.sync_groups enable row level security;
alter table public.webhook_subscriptions enable row level security;
alter table public.sync_state enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.sync_log enable row level security;
alter table public.product_events enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy connections_select_own on public.calendar_connections
  for select to authenticated using (user_id = auth.uid());
create policy connections_update_own on public.calendar_connections
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy calendars_select_own on public.connected_calendars
  for select to authenticated using (user_id = auth.uid());
create policy calendars_update_own on public.connected_calendars
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy events_select_own on public.calendar_events
  for select to authenticated using (user_id = auth.uid());

create policy sync_groups_select_own on public.sync_groups
  for select to authenticated using (user_id = auth.uid());

create policy webhooks_select_own on public.webhook_subscriptions
  for select to authenticated using (
    exists (
      select 1 from public.calendar_connections c
      where c.id = webhook_subscriptions.connection_id and c.user_id = auth.uid()
    )
  );

create policy sync_state_select_own on public.sync_state
  for select to authenticated using (
    exists (
      select 1 from public.connected_calendars c
      where c.id = sync_state.connected_calendar_id and c.user_id = auth.uid()
    )
  );

create policy sync_log_select_own on public.sync_log
  for select to authenticated using (user_id = auth.uid());

create policy product_events_insert_own on public.product_events
  for insert to authenticated with check (user_id = auth.uid());

-- Realtime
alter publication supabase_realtime add table public.calendar_events;
alter publication supabase_realtime add table public.calendar_connections;
alter publication supabase_realtime add table public.connected_calendars;
alter publication supabase_realtime add table public.sync_state;
