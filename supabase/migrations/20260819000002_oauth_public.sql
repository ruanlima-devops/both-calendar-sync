-- PostgREST only exposes `public`. OAuth state/secrets in `private` were invisible
-- to Edge Functions, which caused invalid_state on Google callback.

create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('GOOGLE', 'MICROSOFT')),
  state text not null unique,
  code_verifier text not null,
  redirect_to text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_secrets (
  connection_id uuid primary key references public.calendar_connections (id) on delete cascade,
  encrypted_refresh_token text not null,
  encrypted_access_token text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.oauth_states (id, user_id, provider, state, code_verifier, redirect_to, expires_at, created_at)
select id, user_id, provider, state, code_verifier, redirect_to, expires_at, created_at
from private.oauth_states
on conflict (state) do nothing;

insert into public.calendar_secrets (connection_id, encrypted_refresh_token, encrypted_access_token, token_expires_at, created_at, updated_at)
select connection_id, encrypted_refresh_token, encrypted_access_token, token_expires_at, created_at, updated_at
from private.calendar_secrets
on conflict (connection_id) do nothing;

alter table public.oauth_states enable row level security;
alter table public.calendar_secrets enable row level security;

revoke all on public.oauth_states from anon, authenticated;
revoke all on public.calendar_secrets from anon, authenticated;
grant all on public.oauth_states to service_role;
grant all on public.calendar_secrets to service_role;
