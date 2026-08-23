-- Scheduling Links / Booking Pages + booking username

alter table public.profiles
  add column if not exists booking_username text;

create unique index if not exists profiles_booking_username_uidx
  on public.profiles (lower(booking_username))
  where booking_username is not null;

create table if not exists public.scheduling_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  slug text not null,
  title text not null,
  description text,
  duration_minutes int not null check (duration_minutes between 5 and 480),
  destination_calendar_id uuid not null references public.connected_calendars (id) on delete restrict,
  timezone text not null default 'UTC',
  -- [{ "weekday": 1, "start": "09:00", "end": "17:00" }] ISO weekday 1=Mon … 7=Sun
  availability_rules jsonb not null default '[]'::jsonb,
  buffer_before_minutes int not null default 0 check (buffer_before_minutes between 0 and 180),
  buffer_after_minutes int not null default 0 check (buffer_after_minutes between 0 and 180),
  minimum_notice_minutes int not null default 120 check (minimum_notice_minutes between 0 and 10080),
  booking_window_days int not null default 30 check (booking_window_days between 1 and 365),
  conference_mode text not null default 'none'
    check (conference_mode in ('none', 'google_meet', 'teams', 'custom')),
  custom_location text,
  link_kind text not null default 'recurring'
    check (link_kind in ('recurring', 'one_time')),
  enabled boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists scheduling_links_user_idx on public.scheduling_links (user_id);
create index if not exists scheduling_links_slug_idx on public.scheduling_links (slug);

create table if not exists public.scheduling_link_calendars (
  scheduling_link_id uuid not null references public.scheduling_links (id) on delete cascade,
  connected_calendar_id uuid not null references public.connected_calendars (id) on delete cascade,
  primary key (scheduling_link_id, connected_calendar_id)
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  scheduling_link_id uuid not null references public.scheduling_links (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid references public.calendar_events (id) on delete set null,
  guest_name text not null,
  guest_email text not null,
  guest_notes text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'canceled', 'rescheduled')),
  manage_token_hash text not null,
  guest_timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists bookings_link_slot_active_uidx
  on public.bookings (scheduling_link_id, start_at)
  where status in ('pending', 'confirmed');

create index if not exists bookings_user_idx on public.bookings (user_id, created_at desc);
create index if not exists bookings_manage_hash_idx on public.bookings (manage_token_hash);
create index if not exists bookings_link_idx on public.bookings (scheduling_link_id);

create table if not exists public.api_rate_buckets (
  bucket_key text primary key,
  window_start timestamptz not null,
  hit_count int not null default 0
);

create trigger scheduling_links_updated_at
  before update on public.scheduling_links
  for each row execute function public.set_updated_at();

create trigger bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

alter table public.scheduling_links enable row level security;
alter table public.scheduling_link_calendars enable row level security;
alter table public.bookings enable row level security;

create policy scheduling_links_select_own on public.scheduling_links
  for select to authenticated using (user_id = auth.uid());
create policy scheduling_links_insert_own on public.scheduling_links
  for insert to authenticated with check (user_id = auth.uid());
create policy scheduling_links_update_own on public.scheduling_links
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy scheduling_links_delete_own on public.scheduling_links
  for delete to authenticated using (user_id = auth.uid());

create policy scheduling_link_calendars_select_own on public.scheduling_link_calendars
  for select to authenticated
  using (
    exists (
      select 1 from public.scheduling_links l
      where l.id = scheduling_link_id and l.user_id = auth.uid()
    )
  );
create policy scheduling_link_calendars_write_own on public.scheduling_link_calendars
  for all to authenticated
  using (
    exists (
      select 1 from public.scheduling_links l
      where l.id = scheduling_link_id and l.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.scheduling_links l
      where l.id = scheduling_link_id and l.user_id = auth.uid()
    )
  );

create policy bookings_select_own on public.bookings
  for select to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.scheduling_links to authenticated;
grant select, insert, update, delete on public.scheduling_link_calendars to authenticated;
grant select on public.bookings to authenticated;
grant all on public.scheduling_links to service_role;
grant all on public.scheduling_link_calendars to service_role;
grant all on public.bookings to service_role;
grant all on public.api_rate_buckets to service_role;

-- Allow Unify-originated in-app notifications (booking, etc.)
alter table public.notifications drop constraint if exists notifications_provider_check;
alter table public.notifications
  add constraint notifications_provider_check
  check (provider is null or provider in ('GOOGLE', 'MICROSOFT', 'UNIFY'));

-- Latency probe: when local event rows change, stamp for availability freshness
create table if not exists public.availability_invalidations (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  connected_calendar_id uuid references public.connected_calendars (id) on delete set null,
  source text not null default 'sync',
  created_at timestamptz not null default now()
);
create index if not exists availability_invalidations_user_idx
  on public.availability_invalidations (user_id, created_at desc);
grant all on public.availability_invalidations to service_role;
