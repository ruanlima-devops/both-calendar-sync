create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  provider text check (provider in ('GOOGLE', 'MICROSOFT')),
  connection_id uuid references public.calendar_connections (id) on delete set null,
  entity_type text not null default 'calendar_event',
  entity_id uuid,
  title text not null,
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.notifications from authenticated, anon;
grant select on public.notifications to authenticated;

create or replace function public.mark_notifications_read(target_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if target_ids is null then
    update public.notifications
      set read_at = now()
      where user_id = auth.uid() and read_at is null;
  else
    update public.notifications
      set read_at = now()
      where user_id = auth.uid()
        and read_at is null
        and id = any(target_ids);
  end if;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

alter table public.notifications replica identity full;
alter publication supabase_realtime add table public.notifications;
