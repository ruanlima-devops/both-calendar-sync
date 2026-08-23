-- Billing: plans, subscriptions, webhook idempotency, trial auto-start
-- Trial duration is configured in billing_settings (default 14 days).

create table if not exists public.billing_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.billing_settings (key, value)
values ('trial_days', '14')
on conflict (key) do nothing;

create table if not exists public.billing_plans (
  id text primary key,
  name text not null,
  billing_interval text not null check (billing_interval in ('month', 'year')),
  stripe_price_id text,
  amount_cents int,
  currency text not null default 'brl',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.billing_plans (id, name, billing_interval, currency)
values ('unify_pro', 'Unify Pro', 'month', 'brl')
on conflict (id) do nothing;

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  plan_id text not null references public.billing_plans (id) default 'unify_pro',
  billing_provider text not null default 'internal' check (billing_provider in ('internal', 'stripe', 'apple', 'google')),
  billing_customer_id text,
  billing_subscription_id text,
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'grace_period', 'canceled', 'expired', 'incomplete')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  grace_period_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_subscriptions_status_idx on public.user_subscriptions (status);
create index if not exists user_subscriptions_billing_sub_idx on public.user_subscriptions (billing_subscription_id)
  where billing_subscription_id is not null;

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  user_id uuid references public.profiles (id) on delete set null,
  payload jsonb,
  processed_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists billing_events_user_id_idx on public.billing_events (user_id);

alter table public.calendar_connections
  add column if not exists paused_by_entitlement boolean not null default false;

-- Auto-start trial once per account (idempotent via unique user_id)
create or replace function public.initialize_user_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  trial_days int;
  started timestamptz := now();
  ends timestamptz;
begin
  select coalesce(nullif(value, '')::int, 14)
  into trial_days
  from public.billing_settings
  where key = 'trial_days';

  if trial_days is null or trial_days < 1 then
    trial_days := 14;
  end if;

  ends := started + (trial_days || ' days')::interval;

  insert into public.user_subscriptions (
    user_id,
    plan_id,
    billing_provider,
    status,
    trial_started_at,
    trial_ends_at
  )
  values (
    new.id,
    'unify_pro',
    'internal',
    'trialing',
    started,
    ends
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_profile_subscription_trial on public.profiles;
create trigger on_profile_subscription_trial
  after insert on public.profiles
  for each row execute function public.initialize_user_subscription();

-- Backfill trial for existing profiles without subscription
insert into public.user_subscriptions (
  user_id, plan_id, billing_provider, status, trial_started_at, trial_ends_at
)
select
  p.id,
  'unify_pro',
  'internal',
  'trialing',
  coalesce(p.created_at, now()),
  coalesce(p.created_at, now()) + (
    coalesce(
      (select nullif(value, '')::int from public.billing_settings where key = 'trial_days'),
      14
    ) || ' days'
  )::interval
from public.profiles p
where not exists (
  select 1 from public.user_subscriptions s where s.user_id = p.id
);

create trigger user_subscriptions_updated_at before update on public.user_subscriptions
  for each row execute function public.set_updated_at();

alter table public.billing_settings enable row level security;
alter table public.billing_plans enable row level security;
alter table public.user_subscriptions enable row level security;
alter table public.billing_events enable row level security;

revoke all on public.billing_settings from anon, authenticated;
grant select on public.billing_settings to authenticated;
grant all on public.billing_settings to service_role;

create policy billing_plans_select_all on public.billing_plans
  for select to authenticated using (active = true);

revoke insert, update, delete on public.billing_plans from anon, authenticated;
grant all on public.billing_plans to service_role;

create policy user_subscriptions_select_own on public.user_subscriptions
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.user_subscriptions from anon, authenticated;
grant all on public.user_subscriptions to service_role;

revoke all on public.billing_events from anon, authenticated;
grant all on public.billing_events to service_role;

alter publication supabase_realtime add table public.user_subscriptions;
