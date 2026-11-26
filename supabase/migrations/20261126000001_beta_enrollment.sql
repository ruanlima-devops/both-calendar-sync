-- Closed-beta invitation control (disabled by default).
-- When billing_settings.beta_enrollment_required = 'true', only allowlisted
-- emails may receive product access (server-side). Invite codes are stored hashed.

insert into public.billing_settings (key, value)
values ('beta_enrollment_required', 'false')
on conflict (key) do nothing;

-- Recommended beta entitlement policy key (PO chooses later):
-- 'trial' = normal 14d trial for invited users
-- 'beta_grant' = server-side beta access without Stripe Live
insert into public.billing_settings (key, value)
values ('beta_entitlement_policy', 'trial')
on conflict (key) do nothing;

create table if not exists public.beta_invites (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  note text
);

create unique index if not exists beta_invites_open_email_idx
  on public.beta_invites (email_normalized)
  where consumed_at is null and revoked_at is null;

create index if not exists beta_invites_code_hash_idx on public.beta_invites (code_hash);

alter table public.beta_invites enable row level security;

-- No direct client access to invite rows (service role / security definer only).
revoke all on public.beta_invites from anon, authenticated;

create or replace function public.beta_enrollment_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value from public.billing_settings where key = 'beta_enrollment_required'),
    'false'
  ) = 'true';
$$;

revoke all on function public.beta_enrollment_required() from public;
grant execute on function public.beta_enrollment_required() to authenticated, anon, service_role;

create or replace function public.user_has_beta_enrollment(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  email_norm text;
begin
  if not public.beta_enrollment_required() then
    return true;
  end if;
  select lower(trim(email)) into email_norm from auth.users where id = p_user_id;
  if email_norm is null or email_norm = '' then
    return false;
  end if;
  return exists (
    select 1
    from public.beta_invites i
    where i.email_normalized = email_norm
      and i.revoked_at is null
      and i.expires_at > now()
      and (
        i.consumed_at is null
        or i.consumed_by = p_user_id
      )
  );
end;
$$;

revoke all on function public.user_has_beta_enrollment(uuid) from public;
grant execute on function public.user_has_beta_enrollment(uuid) to authenticated, service_role;

-- Redeem invite for the authenticated user (single-use when previously unused).
create or replace function public.redeem_beta_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  email_norm text;
  code_norm text := lower(trim(coalesce(p_code, '')));
  code_digest text;
  invite public.beta_invites%rowtype;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if code_norm = '' or char_length(code_norm) < 16 then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  select lower(trim(email)) into email_norm from auth.users where id = uid;
  if email_norm is null or email_norm = '' then
    return jsonb_build_object('ok', false, 'error', 'email_missing');
  end if;

  -- Cast algorithm explicitly for pgcrypto digest(bytea, text) resolution under db lint.
  code_digest := encode(extensions.digest(convert_to(code_norm, 'utf8'), 'sha256'::text), 'hex');

  select * into invite
  from public.beta_invites i
  where i.code_hash = code_digest
    and i.email_normalized = email_norm
    and i.revoked_at is null
    and i.expires_at > now()
    and (i.consumed_at is null or i.consumed_by = uid)
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invite_not_found');
  end if;

  if invite.consumed_at is null then
    update public.beta_invites
    set consumed_at = now(), consumed_by = uid
    where id = invite.id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.redeem_beta_invite(text) from public;
grant execute on function public.redeem_beta_invite(text) to authenticated;

-- stage deploy re-touch marker: 2026-11-26T04:05Z
