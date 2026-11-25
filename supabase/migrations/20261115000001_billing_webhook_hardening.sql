-- STG-05B/STG-05D: billing webhook hardening.
-- Already applied on STAGE qszggrrjhcwltnmxpxcy (history sync into develop).
-- Idempotent; adds processing state for claim→apply→complete and safer Stripe id lookups.

-- 1) billing_events processing lifecycle
alter table public.billing_events
  add column if not exists status text not null default 'processed';

alter table public.billing_events
  drop constraint if exists billing_events_status_check;

alter table public.billing_events
  add constraint billing_events_status_check
  check (status in ('received', 'processing', 'processed', 'failed'));

alter table public.billing_events
  add column if not exists attempt_count int not null default 1;

alter table public.billing_events
  add column if not exists last_error text;

alter table public.billing_events
  add column if not exists updated_at timestamptz not null default now();

-- Allow in-flight rows without processed_at; backfill existing rows as processed.
alter table public.billing_events
  alter column processed_at drop not null;

update public.billing_events
set status = 'processed',
    processed_at = coalesce(processed_at, now()),
    updated_at = coalesce(updated_at, processed_at, now())
where status is null or status = 'processed';

drop trigger if exists billing_events_updated_at on public.billing_events;
create trigger billing_events_updated_at before update on public.billing_events
  for each row execute function public.set_updated_at();

create index if not exists billing_events_status_idx
  on public.billing_events (status)
  where status in ('processing', 'failed', 'received');

-- 2) Out-of-order Stripe event guard on subscriptions
alter table public.user_subscriptions
  add column if not exists last_stripe_event_at timestamptz;

-- 3) Unambiguous Stripe id → user mapping (reject duplicates at DB layer when possible)
drop index if exists public.user_subscriptions_billing_sub_idx;
create unique index if not exists user_subscriptions_billing_sub_uidx
  on public.user_subscriptions (billing_subscription_id)
  where billing_subscription_id is not null;

create unique index if not exists user_subscriptions_billing_customer_uidx
  on public.user_subscriptions (billing_customer_id)
  where billing_customer_id is not null
    and billing_provider = 'stripe';
