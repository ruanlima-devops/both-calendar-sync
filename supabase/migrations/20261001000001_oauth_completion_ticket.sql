-- M3-003: app-mediated OAuth finalization.
-- The provider callback no longer completes the connection: it turns the state into a short-lived,
-- single-use completion ticket. The authenticated app finalizes with the ticket plus the browser's
-- client nonce. Only hashes and the encrypted authorization code are stored.

alter table public.oauth_states
  add column if not exists client_nonce_hash text,
  add column if not exists ticket_hash text,
  add column if not exists encrypted_code text,
  add column if not exists ticket_expires_at timestamptz;

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

comment on column public.oauth_states.client_nonce_hash is
  'SHA-256 (hex) of the client nonce held by the browser/app that started the flow. Never the nonce.';
comment on column public.oauth_states.ticket_hash is
  'SHA-256 (hex) of the completion ticket issued by the provider callback. Never the ticket.';
comment on column public.oauth_states.encrypted_code is
  'Provider authorization code, AES-GCM encrypted with TOKEN_ENCRYPTION_KEY, until finalize.';

-- Rows live at most 10 minutes (state) / 5 minutes (ticket); sweep leftovers every 15 minutes.
do $$
declare
  existing_id bigint;
begin
  select j.jobid into existing_id from cron.job j where j.jobname = 'both-oauth-states-cleanup' limit 1;
  if existing_id is not null then
    perform cron.unschedule(existing_id);
  end if;

  perform cron.schedule(
    'both-oauth-states-cleanup',
    '*/15 * * * *',
    $cron$delete from public.oauth_states where expires_at < now() - interval '5 minutes';$cron$
  );
end;
$$;
