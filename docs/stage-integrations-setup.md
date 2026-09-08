# Both STAGE Integrations Setup

Manual checklist for Google Cloud, Microsoft Entra, and Supabase Auth.
No secrets belong in this file.

## Supabase

```text
Project:
Both STAGE

Project Ref:
qszggrrjhcwltnmxpxcy

Region:
sa-east-1

API URL:
https://qszggrrjhcwltnmxpxcy.supabase.co
```

Do not use the legacy project `unify-dev` (`sknpqjodttkpttaytdut`).

---

## Two Google flows (do not mix)

### Google Authentication (login)

```text
App
→ Supabase Auth
→ Google
→ https://qszggrrjhcwltnmxpxcy.supabase.co/auth/v1/callback
→ app
```

This uses a **Google Cloud OAuth client configured in Supabase Auth**.
It is **not** the calendar Edge Function client.

Login scopes from `lib/auth/google.ts`:

```text
openid
email
profile
```

### Google Calendar Integration

```text
App
→ google-oauth Edge Function
→ Google OAuth
→ google-oauth Edge Function
→ app both-stg://oauth  (preview)
```

This uses **separate** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` Edge secrets.

---

## Microsoft Calendar (no Microsoft login)

Microsoft is **not** enabled on Supabase Auth.

```text
App
→ microsoft-oauth Edge Function
→ Microsoft
→ microsoft-oauth Edge Function
→ app both-stg://oauth  (preview)
```

---

## Supabase Auth — Google

Provider: **Google**  
Microsoft Auth: **disabled**  
Apple Auth: **pending**

### Google authorized redirect URI

Exact value for the Google Cloud client used **only** by Supabase Auth:

```text
https://qszggrrjhcwltnmxpxcy.supabase.co/auth/v1/callback
```

### Supabase Auth → Redirect URLs

STAGE may list only environments that actually use this project:

```text
both-stg://auth/callback
both-dev://auth/callback
http://localhost:8081/auth/callback
```

Do **not** add:

```text
both://auth/callback
```

`unify://auth/callback` is not generated anymore. Add it only if you still need to test a legacy binary against Both STAGE (not recommended). Prefer removing it.

Derived from `getAuthRedirectUri()` → `makeRedirectUri({ scheme: APP_SCHEME, path: 'auth/callback' })`.

| Surface | Generated Auth callback |
|---|---|
| WEB local | `http://localhost:8081/auth/callback` |
| DEV native | `both-dev://auth/callback` |
| STAGE native | `both-stg://auth/callback` |
| PROD native | `both://auth/callback` (do not register on STAGE) |

---

## Google Calendar OAuth

```text
Application:
Both STAGE Calendar

Client:
Both STAGE Calendar (created; secret values never in Git)

Authorized redirect URI:
https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/google-oauth

Native app return:
both-stg://oauth
```

Also used by local DEV against this STAGE:

```text
both-dev://oauth
http://localhost:8081/oauth
```

Do not reuse the Unify-dev Calendar client secret.

Same Google Cloud **project** as Auth is fine if the **OAuth clients are separate**.

### Scopes (from `supabase/functions/_shared/providers/google.ts`)

```text
openid
email
profile
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/calendar.calendarlist.readonly
```

### Google webhook URL

```text
https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/google-webhook
```

Watches are created at calendar connect time on Both STAGE. Do not reuse Legacy channel IDs.

---

## Microsoft Calendar OAuth

```text
Application:
Both STAGE Calendar

App registration:
Both STAGE Calendar (created; secret values never in Git)

Redirect URI (Web):
https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/microsoft-oauth

Native return:
both-stg://oauth
```

Tenant in code defaults to `common` (`MICROSOFT_TENANT`).

### Permissions / scopes (from `supabase/functions/_shared/providers/microsoft.ts`)

```text
offline_access
User.Read
Calendars.ReadWrite
```

### Microsoft webhook URL

```text
https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/microsoft-webhook
```

Graph subscriptions are created at calendar connect time on Both STAGE. Do not reuse Legacy subscription IDs.
Do not enable Microsoft on Supabase Auth.

---

## Generated calendar OAuth returns

From `Linking.createURL('oauth', { scheme: APP_SCHEME })`:

| Variant | Generated return |
|---|---|
| development | `both-dev://oauth` |
| preview / STAGE | `both-stg://oauth` |
| production | `both://oauth` |

`unify://oauth` is accepted as an **incoming** URL only. It is not generated.

---

## Edge secrets after you create the clients

Set these **names** on Both STAGE (values never in Git):

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
GOOGLE_WEBHOOK_URL

MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MICROSOFT_TENANT
MICROSOFT_REDIRECT_URI
MICROSOFT_WEBHOOK_URL
```

Suggested values once clients exist:

```text
GOOGLE_REDIRECT_URI=https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/google-oauth
GOOGLE_WEBHOOK_URL=https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/google-webhook
MICROSOFT_REDIRECT_URI=https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/microsoft-oauth
MICROSOFT_WEBHOOK_URL=https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/microsoft-webhook
MICROSOFT_TENANT=common
```

Already configured internally (do not reuse legacy values):

```text
TOKEN_ENCRYPTION_KEY
CRON_SECRET
```

Leave **unset** on purpose:

```text
APP_URL
APP_REDIRECT_ALLOWLIST
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_ID
REVENUECAT_WEBHOOK_SECRET
RESEND_API_KEY
RESEND_FROM_EMAIL
```

`APP_REDIRECT_ALLOWLIST` is only for extra **https origins**. Native `both-stg://oauth` and `both-dev://oauth` are already allowlisted in code. Do not add `*`. Do not add `unify://oauth` unless a legacy binary must complete OAuth against this STAGE.

`APP_URL` is required by email/billing helpers. Those integrations stay PENDING — do not invent a public STAGE web domain.

---

## Frontend cutover (local)

Local `.env` (gitignored) now targets Both STAGE:

```text
EXPO_PUBLIC_SUPABASE_URL=https://qszggrrjhcwltnmxpxcy.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<Both STAGE publishable/anon key>
APP_VARIANT=preview
```

Do not put `service_role` in the client.
Do not commit `.env`.

Check without printing keys:

```bash
npm run check:environment
```

Expected:

```text
Project Ref: qszggrrjhcwltnmxpxcy
Legacy: no
```

---

## Intentionally pending

- Apple Auth
- Stripe
- RevenueCat secrets / dashboard webhook
- Resend
- Cron schedules ainda não versionados: `icloud-poll`, `send-email-digest`
- Both PROD project

## Cron (M1-010 / M1-011)

Migration versionada cria:

- `both-renew-subscriptions` (hourly)
- `both-reconcile-sync` (every 15 minutes)

Após `db push` no STAGE, seed Vault (`project_url`, `cron_secret`, `anon_key`) conforme `docs/cron-schedules.md`.
Jobs só invocam Edge com sucesso depois do seed.

---

## Troubleshooting

### Google Calendar — `redirect_uri_mismatch`

Login Google (Supabase Auth) and Google Calendar use **different OAuth clients**.

| Flow | OAuth client | Redirect URI |
|---|---|---|
| Login | Both STAGE **Auth** | `https://qszggrrjhcwltnmxpxcy.supabase.co/auth/v1/callback` |
| Calendar | Both STAGE **Calendar** | `https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/google-oauth` |

If login works but calendar connect fails with `redirect_uri_mismatch`:

1. Google Cloud Console → **Credentials** → open **Both STAGE Calendar** (not Auth).
2. Under **Authorized redirect URIs**, add exactly:
   `https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/google-oauth`
3. Confirm Supabase Edge secret `GOOGLE_CLIENT_ID` is the **Calendar** client ID (same client as step 2).
4. Click **Save** in Google Cloud and wait ~1 minute before retrying.

On the Google error screen, open **error details** to see the exact `redirect_uri` sent.

### Microsoft Calendar — web popup closes but nothing connects

On web, the callback lands on `http://localhost:8081/oauth`. The app must notify the opener window.

After pulling the latest code, restart `npm run web --clear` and retry.

If it still fails, confirm Entra redirect URI is exactly:
`https://qszggrrjhcwltnmxpxcy.supabase.co/functions/v1/microsoft-oauth`
