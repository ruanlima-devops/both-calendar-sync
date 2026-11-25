-- SEC-10: RLS on internal scheduling tables + protect profiles.plan_tier
-- Already applied on STAGE qszggrrjhcwltnmxpxcy (history sync into develop).
-- Idempotent / safe to re-run.

-- ---------------------------------------------------------------------------
-- 1) api_rate_buckets — internal rate-limit store (Edge Functions / service_role)
-- ---------------------------------------------------------------------------
alter table if exists public.api_rate_buckets enable row level security;

revoke all on table public.api_rate_buckets from public, anon, authenticated;
grant all on table public.api_rate_buckets to service_role;

-- No policies for anon/authenticated: with RLS enabled, PostgREST clients cannot
-- read or mutate rate-limit state. service_role bypasses RLS (Supabase default).

-- ---------------------------------------------------------------------------
-- 2) availability_invalidations — internal freshness probe (service_role writes)
-- ---------------------------------------------------------------------------
alter table if exists public.availability_invalidations enable row level security;

revoke all on table public.availability_invalidations from public, anon, authenticated;
grant all on table public.availability_invalidations to service_role;

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'S'
      and c.relname = 'availability_invalidations_id_seq'
  ) then
    execute 'revoke all on sequence public.availability_invalidations_id_seq from public, anon, authenticated';
    execute 'grant all on sequence public.availability_invalidations_id_seq to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) profiles — column privileges: users may edit preference fields only
-- ---------------------------------------------------------------------------
-- RLS policy profiles_update_own remains (own row only). Column grants prevent
-- authenticated clients from changing privileged columns even on their own row.
-- Entitlement continues to be sourced from user_subscriptions (BIL-02), not plan_tier;
-- plan_tier is still treated as a privileged attribute and must not be client-writable.

revoke update on table public.profiles from anon;
revoke update on table public.profiles from authenticated;

-- Re-grant UPDATE only on user-editable columns (explicit allow-list).
grant update (
  display_name,
  timezone,
  locale,
  visual_theme,
  color_scheme,
  avatar_url,
  notify_event_created,
  notify_event_updated,
  notify_event_cancelled,
  email_weekly_digest,
  email_monthly_digest,
  onboarding_completed_at,
  booking_username
) on table public.profiles to authenticated;

-- Ensure SELECT own profile still works for authenticated (idempotent).
grant select on table public.profiles to authenticated;

-- service_role retains full control for admin/edge paths.
grant all on table public.profiles to service_role;

-- ---------------------------------------------------------------------------
-- 4) Defense in depth — block plan_tier mutation outside service/admin roles
-- ---------------------------------------------------------------------------
create or replace function public.profiles_protect_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  jwt_role text := coalesce(auth.role(), '');
  actor text := current_user;
begin
  -- INSERT is unrestricted here (signup/bootstrap paths). Only UPDATE of plan_tier is gated.
  if tg_op = 'UPDATE' and new.plan_tier is distinct from old.plan_tier then
    -- Allow: PostgREST service_role JWT, DB role service_role, or superuser/admin.
    -- BYPASSRLS does not skip triggers — must allow service_role explicitly.
    if jwt_role is not distinct from 'service_role'
       or actor in ('service_role', 'postgres', 'supabase_admin')
       or pg_has_role(actor, 'service_role', 'member') then
      return new;
    end if;
    raise exception 'SEC-10: plan_tier is not user-mutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_privileged_columns on public.profiles;
create trigger profiles_protect_privileged_columns
  before update on public.profiles
  for each row
  execute function public.profiles_protect_privileged_columns();

revoke all on function public.profiles_protect_privileged_columns() from public, anon, authenticated;

comment on function public.profiles_protect_privileged_columns() is
  'SEC-10: reject authenticated/anon attempts to change profiles.plan_tier';

comment on table public.api_rate_buckets is
  'SEC-10: RLS enabled; service_role only; no anon/authenticated policies';

comment on table public.availability_invalidations is
  'SEC-10: RLS enabled; service_role only; no anon/authenticated policies';
