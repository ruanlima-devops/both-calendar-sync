-- Calendar Firewall / Smart Availability: directional privacy rules

create table if not exists public.calendar_firewall_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source_calendar_id uuid not null references public.connected_calendars (id) on delete cascade,
  destination_calendar_id uuid not null references public.connected_calendars (id) on delete cascade,
  enabled boolean not null default true,
  privacy_preset text not null default 'availability'
    check (privacy_preset in ('availability', 'limited', 'full', 'custom')),
  sync_title boolean not null default false,
  sync_description boolean not null default false,
  sync_location boolean not null default false,
  sync_attendees boolean not null default false,
  sync_conference boolean not null default false,
  ignore_free boolean not null default true,
  ignore_cancelled boolean not null default true,
  placeholder_title text not null default 'Horário reservado · Unify',
  busy_status text not null default 'busy'
    check (busy_status in ('busy', 'tentative', 'oof')),
  health_status text not null default 'active'
    check (health_status in ('active', 'degraded', 'error')),
  last_processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_calendar_id, destination_calendar_id),
  check (source_calendar_id <> destination_calendar_id)
);

create index if not exists calendar_firewall_rules_user_idx
  on public.calendar_firewall_rules (user_id);
create index if not exists calendar_firewall_rules_source_idx
  on public.calendar_firewall_rules (source_calendar_id)
  where enabled = true;
create index if not exists calendar_firewall_rules_dest_idx
  on public.calendar_firewall_rules (destination_calendar_id);

alter table public.calendar_events
  add column if not exists firewall_rule_id uuid references public.calendar_firewall_rules (id) on delete set null;

create index if not exists calendar_events_firewall_rule_idx
  on public.calendar_events (firewall_rule_id)
  where firewall_rule_id is not null;

create trigger calendar_firewall_rules_updated_at
  before update on public.calendar_firewall_rules
  for each row execute function public.set_updated_at();

alter table public.calendar_firewall_rules enable row level security;

create policy calendar_firewall_rules_select_own on public.calendar_firewall_rules
  for select to authenticated
  using (user_id = auth.uid());

create policy calendar_firewall_rules_insert_own on public.calendar_firewall_rules
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.connected_calendars s
      where s.id = source_calendar_id and s.user_id = auth.uid()
    )
    and exists (
      select 1 from public.connected_calendars d
      where d.id = destination_calendar_id and d.user_id = auth.uid()
    )
  );

create policy calendar_firewall_rules_update_own on public.calendar_firewall_rules
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy calendar_firewall_rules_delete_own on public.calendar_firewall_rules
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.calendar_firewall_rules to authenticated;
grant all on public.calendar_firewall_rules to service_role;

-- Seed directional BUSY_ONLY rules from legacy auto_block_others calendars
insert into public.calendar_firewall_rules (
  user_id,
  source_calendar_id,
  destination_calendar_id,
  enabled,
  privacy_preset,
  sync_title,
  sync_description,
  sync_location,
  sync_attendees,
  sync_conference
)
select
  src.user_id,
  src.id,
  dst.id,
  true,
  'availability',
  false,
  false,
  false,
  false,
  false
from public.connected_calendars src
join public.connected_calendars dst
  on dst.user_id = src.user_id
 and dst.id <> src.id
 and dst.enabled = true
 and lower(dst.access_role) in ('owner', 'writer', 'editor')
where src.auto_block_others = true
  and src.enabled = true
on conflict (source_calendar_id, destination_calendar_id) do nothing;
