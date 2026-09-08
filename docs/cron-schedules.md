# Cron schedules (M1-010 / M1-011)

Versioned via migration `20260908000001_cron_renew_reconcile.sql`.

## Jobs

| Job name | Edge Function | Schedule | Purpose |
| --- | --- | --- | --- |
| `both-renew-subscriptions` | `renew-subscriptions` | `0 * * * *` (hourly) | Renew Google/Microsoft webhook watches expiring within ~48h; ensure enabled calendars have watches |
| `both-reconcile-sync` | `reconcile-sync` | `*/15 * * * *` (every 15m) | Expire expired trials; drain pending jobs; enqueue hourly reconcile for non-iCloud enabled calendars |

**Not scheduled here:** `icloud-poll`, `send-email-digest` (later milestones).

## Cadence rationale

- **Renew hourly** — matches `README.md`. Watches are renewed when `expires_at` is within 48 hours (`renew-subscriptions`).
- **Reconcile every 15 minutes** — matches `README.md`. `dedupe_key` is `reconcile:<calendarId>:<YYYY-MM-DDTHH>`, so multiple runs in the same hour do not duplicate work.

## Architecture

```text
pg_cron
  → public.both_invoke_cron_function(name)
  → Vault (project_url, cron_secret, anon_key)
  → pg_net.http_post
  → Edge Function
  → CRON_SECRET via x-cron-secret
```

No secrets are stored in Git or in the migration SQL.

## Vault secrets (required per environment)

Seed **once** after the migration is applied (Dashboard SQL or `supabase db query --linked`). Values must match the Edge Function runtime:

| Vault name | Value source |
| --- | --- |
| `project_url` | `https://<project-ref>.supabase.co` |
| `cron_secret` | Same value as Edge secret `CRON_SECRET` |
| `anon_key` | Project anon/publishable key (API gateway) |

Example (replace placeholders; never commit real values):

```sql
select vault.create_secret('https://YOUR_REF.supabase.co', 'project_url');
select vault.create_secret('YOUR_CRON_SECRET', 'cron_secret');
select vault.create_secret('YOUR_ANON_KEY', 'anon_key');
```

If a name already exists, create a new secret row or update via Vault UI; the helper reads the latest `created_at` for that name.

## Validate

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname in ('both-renew-subscriptions', 'both-reconcile-sync')
order by jobname;
```

Expect exactly two active rows.

Manual invoke (same path as cron):

```sql
select public.both_invoke_cron_function('renew-subscriptions');
select public.both_invoke_cron_function('reconcile-sync');
```

Inspect recent runs (redact any sensitive return text):

```sql
select j.jobname, d.status, d.start_time, d.end_time, d.return_message
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname in ('both-renew-subscriptions', 'both-reconcile-sync')
order by d.start_time desc
limit 20;
```

## Failure investigation

1. Job missing → migration not applied.
2. `vault secret missing` in return_message → seed Vault.
3. HTTP 401 from Edge → `cron_secret` ≠ Edge `CRON_SECRET`.
4. HTTP 401/404 gateway → wrong `project_url` or `anon_key`.
5. Subscriptions still expired after renew → check Edge logs / provider token `AUTH_REQUIRED`.

## Dependencies

- Extensions: `pg_cron`, `pg_net`, Vault (`supabase_vault`)
- Edge Functions deployed: `renew-subscriptions`, `reconcile-sync` (`verify_jwt = false`)
- Edge secret: `CRON_SECRET`
