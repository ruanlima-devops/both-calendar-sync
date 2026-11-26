# Both — PROD Enterprise OAuth Architecture

**Captured (UTC):** 2026-11-26T04:40:00Z  
**develop HEAD baseline:** `25a1a07` (+ this PR)  
**External access / public signup / Stripe Live:** **NO**

---

## Verified PROD Supabase

| Field | Observed |
|-------|----------|
| Name | **Both PROD** |
| Project ref | **`djxulqyuafhihmuyzvvk`** |
| Organization | Both Calendar Sync (`otaqdspnjsewiymnqbmr`) |
| Org plan | **Free** (dashboard label) |
| Region | `sa-east-1` |
| Compute | nano |
| Owner/member | `bothcalendarsync@gmail.com` |
| Isolation vs STAGE | **PASS** — ≠ `qszggrrjhcwltnmxpxcy` |
| Isolation vs legacy | **PASS** — ≠ `sknpqjodttkpttaytdut` |
| Default Site URL | `http://localhost:3000` (stock) |
| Redirect allowlist | empty at discovery |
| Google / Azure Auth providers | **Disabled** |
| Allow new user signup | Disabled during this session (was ON at discovery) |
| Custom domains UI | “Pro Plan add-on” — **not eligible on Free** |
| Edge Functions | not deployed yet (empty PROD) |
| Migrations | not applied yet |

`PROD_PROJECT_FOUND=PASS`  
`PROD_PROJECT_REF=djxulqyuafhihmuyzvvk`  
`PROD_ORGANIZATION=Both Calendar Sync / otaqdspnjsewiymnqbmr`  
`PROD_PLAN=Free`  
`PROD_COST_BASELINE=$0 org Free (2 active projects: STAGE+PROD)`

CLI PAT used earlier only listed STAGE; Dashboard (owner session) is authoritative for PROD discovery.

---

## Two OAuth purposes (must stay separate)

```
A) SOCIAL SIGN-IN (Supabase Auth)
   FE → supabase.auth.signInWithOAuth({ provider: 'google'|'azure' })
   scopes: openid email profile (Google Sign-In code)
   callback: https://<AUTH_HOST>/auth/v1/callback

B) CALENDAR CONNECTION (Edge Functions)
   FE → google-oauth / microsoft-oauth
   Google scopes: calendar.events + calendar.calendarlist.readonly (+ openid/email/profile)
   Microsoft scopes: offline_access User.Read Calendars.ReadWrite
   callback: https://<API_HOST>/functions/v1/google-oauth
              https://<API_HOST>/functions/v1/microsoft-oauth
```

Source of truth for Calendar redirect construction:

- Google: `env('GOOGLE_REDIRECT_URI')` in `supabase/functions/google-oauth/index.ts`
- Microsoft: `functionPublicUrl('microsoft-oauth', envOptional('MICROSOFT_REDIRECT_URI'))` in `microsoft-oauth/index.ts`
- Shared helper: `functionPublicUrl` → `{SUPABASE_URL}/functions/v1/{name}`

**Do not** put STAGE callbacks on PROD clients.  
**Do not** reuse STAGE client IDs/secrets on PROD.

---

## Branded domain target (proposed; DNS not live)

| Role | Hostname | Status 2026-11-26 |
|------|----------|-------------------|
| Marketing / legal | `https://bothcalendar.com` | Apex resolves Cloudflare Free |
| App FE | `https://app.bothcalendar.com` | **No DNS records** |
| Supabase Auth/API custom domain | `https://auth.bothcalendar.com` | **No DNS records** |
| STAGE FE | `https://stage.bothcalendar.com` | Live |

Official Supabase Custom Domains require:

1. Paid org plan (Pro+)
2. Add-on **~$10/domain/month/project**
3. CNAME `auth` → `djxulqyuafhihmuyzvvk.supabase.co`
4. ACME TXT verification
5. `supabase domains create/reverify/activate`

Until approved: consent screens will show `*.supabase.co` technical host if social login is enabled — **do not claim branded Auth URL is live**.

Interim (zero-cost) option for internal smoke only: use `https://djxulqyuafhihmuyzvvk.supabase.co/auth/v1/callback` and document UX as non-branded.

Vanity subdomain (`*.supabase.co`) is free on Pro but **not** available on Free.

---

## Credential isolation model

| Secret name (PROD only) | Purpose |
|-------------------------|---------|
| Supabase Auth Google client | Sign-In |
| Supabase Auth Azure client | Sign-In |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Calendar Sync Edge |
| `GOOGLE_REDIRECT_URI` | Exact Calendar callback |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Calendar Sync Edge |
| `MICROSOFT_REDIRECT_URI` | Exact Calendar callback |
| `SUPABASE_URL` / service_role / anon | PROD project only |

Never store secrets in Git. Prefer GitHub Environment `production` + Supabase Edge secrets.

---

## Legal publisher identity (PO decision)

Operational account observed for Supabase/GCP: personal/company mix under **Ruan Felipe Serafim De Lima** / `ruan.lima406@gmail.com` / org email `bothcalendarsync@gmail.com`.

Historical legal entity referenced: **RUAN FELIPE SERAFIM DE LIMA LTDA**.  
**Both LTDA** does **not** exist — do not invent.

Recommendation: use one consistent legal entity for Google Cloud, Microsoft Partner verification, Stripe, Privacy, and Terms until a dedicated Both company is incorporated; plan a publisher migration if entity changes.
