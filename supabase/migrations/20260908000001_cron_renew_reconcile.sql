-- M1-010 / M1-011: versioned schedules for renew-subscriptions + reconcile-sync
-- Secrets live in Vault per environment (never in Git):
--   project_url  — e.g. https://<project-ref>.supabase.co
--   cron_secret  — must match Edge Function secret CRON_SECRET
--   anon_key     — publishable/anon key for API gateway (apikey / Authorization)

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- ---------------------------------------------------------------------------
-- Invoke an Edge Function as the cron runner (Vault-backed, no hardcoded secrets)
-- ---------------------------------------------------------------------------
create or replace function public.both_invoke_cron_function(function_name text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault, net, pg_temp
as $$
declare
  base_url text;
  cron_secret text;
  anon_key text;
  request_id bigint;
  allowed text[] := array['renew-subscriptions', 'reconcile-sync'];
begin
  if function_name is null or function_name <> all (allowed) then
    raise exception 'both_invoke_cron_function: function not allowlisted: %', function_name;
  end if;

  select ds.decrypted_secret
    into base_url
  from vault.decrypted_secrets ds
  where ds.name = 'project_url'
  order by ds.created_at desc
  limit 1;

  select ds.decrypted_secret
    into cron_secret
  from vault.decrypted_secrets ds
  where ds.name = 'cron_secret'
  order by ds.created_at desc
  limit 1;

  select ds.decrypted_secret
    into anon_key
  from vault.decrypted_secrets ds
  where ds.name = 'anon_key'
  order by ds.created_at desc
  limit 1;

  if base_url is null or btrim(base_url) = '' then
    raise exception 'both cron vault secret missing: project_url';
  end if;
  if cron_secret is null or btrim(cron_secret) = '' then
    raise exception 'both cron vault secret missing: cron_secret';
  end if;
  if anon_key is null or btrim(anon_key) = '' then
    raise exception 'both cron vault secret missing: anon_key';
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/' || function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', anon_key,
      'Authorization', 'Bearer ' || anon_key,
      'x-cron-secret', cron_secret
    ),
    body := '{}'::jsonb
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function public.both_invoke_cron_function(text) from public, anon, authenticated;
grant execute on function public.both_invoke_cron_function(text) to postgres;

comment on function public.both_invoke_cron_function(text) is
  'M1 cron helper: POST Edge Function using Vault secrets project_url, cron_secret, anon_key.';

-- ---------------------------------------------------------------------------
-- Idempotent schedule upsert (one job per name)
-- ---------------------------------------------------------------------------
do $$
declare
  existing_id bigint;
begin
  -- renew-subscriptions: hourly (README + Google/MS watch expiry window)
  select j.jobid into existing_id from cron.job j where j.jobname = 'both-renew-subscriptions' limit 1;
  if existing_id is not null then
    perform cron.unschedule(existing_id);
  end if;

  perform cron.schedule(
    'both-renew-subscriptions',
    '0 * * * *',
    $cron$select public.both_invoke_cron_function('renew-subscriptions');$cron$
  );

  -- reconcile-sync: every 15 minutes (dedupe_key is hourly → safe / idempotent)
  existing_id := null;
  select j.jobid into existing_id from cron.job j where j.jobname = 'both-reconcile-sync' limit 1;
  if existing_id is not null then
    perform cron.unschedule(existing_id);
  end if;

  perform cron.schedule(
    'both-reconcile-sync',
    '*/15 * * * *',
    $cron$select public.both_invoke_cron_function('reconcile-sync');$cron$
  );
end;
$$;
