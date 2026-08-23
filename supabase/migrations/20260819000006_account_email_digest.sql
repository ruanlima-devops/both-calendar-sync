-- Profile preferences (account, notifications, email digests, appearance)
alter table public.profiles
  add column if not exists color_scheme text not null default 'system'
    check (color_scheme in ('system', 'light', 'dark')),
  add column if not exists avatar_url text,
  add column if not exists notify_event_created boolean not null default true,
  add column if not exists notify_event_updated boolean not null default true,
  add column if not exists notify_event_cancelled boolean not null default true,
  add column if not exists email_weekly_digest boolean not null default true,
  add column if not exists email_monthly_digest boolean not null default true;

-- Idempotent email digest delivery log
create table if not exists public.email_digest_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  digest_type text not null check (digest_type in ('weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  sent_at timestamptz not null default now()
);

create unique index if not exists email_digest_log_idempotency_idx
  on public.email_digest_log (user_id, digest_type, period_start, period_end);

create index if not exists email_digest_log_user_id_idx on public.email_digest_log (user_id);

alter table public.email_digest_log enable row level security;

create policy email_digest_log_select_own on public.email_digest_log
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.email_digest_log from anon, authenticated;
grant all on public.email_digest_log to service_role;
