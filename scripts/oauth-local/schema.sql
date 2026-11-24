-- Disposable local schema for M3-003 OAuth Postgres integration.
-- NOT for STAGE/PROD. No remote hosts. No pg_cron (cron block omitted).

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('GOOGLE', 'MICROSOFT')),
  state text not null unique,
  code_verifier text not null,
  redirect_to text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  client_nonce_hash text,
  ticket_hash text,
  encrypted_code text,
  ticket_expires_at timestamptz
);

create unique index if not exists oauth_states_ticket_hash_key
  on public.oauth_states (ticket_hash)
  where ticket_hash is not null;

create index if not exists oauth_states_expires_at_idx
  on public.oauth_states (expires_at);

alter table public.oauth_states
  drop constraint if exists oauth_states_ticket_complete;
alter table public.oauth_states
  add constraint oauth_states_ticket_complete check (
    ticket_hash is null
    or (encrypted_code is not null and ticket_expires_at is not null and client_nonce_hash is not null)
  );

create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null,
  status text not null default 'CONNECTED',
  account_email text
);

alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from public;
-- Local harness connects as the DB owner (superuser/owner), matching service_role privilege model.
