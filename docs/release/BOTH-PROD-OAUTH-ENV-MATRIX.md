# Both — STAGE vs PROD OAuth Environment Matrix

**Secrets omitted.** Client IDs filled when created.

| Item | STAGE | PROD |
|------|-------|------|
| Supabase project | `qszggrrjhcwltnmxpxcy` Both STAGE | `djxulqyuafhihmuyzvvk` Both PROD |
| Org / plan | Both Calendar Sync / Free | Same org / Free |
| Custom domain | none (uses `*.supabase.co`) | Proposed `auth.bothcalendar.com` — **COST_APPROVAL_REQUIRED** (Pro + ~$10/mo) |
| Frontend canonical | `https://stage.bothcalendar.com` | Proposed `https://app.bothcalendar.com` (**no DNS**) |
| Auth Site URL | STAGE configured | Was localhost; configure after FE/DNS |
| Auth redirect allowlist | STAGE FE + schemes | empty at discovery |
| Google Cloud project | `both-stage` | `both-production` (created) |
| Google Sign-In client | Both STAGE Auth (existing) | Both PROD — Sign In (**pending client create**) |
| Google Calendar client | Both STAGE Calendar | Both PROD — Calendar Sync (**pending**) |
| Google audience / publishing | External / Testing (historical) | External / prepare In production + verification |
| Google Sign-In redirect | `https://qszg…/auth/v1/callback` | `https://djxul…/auth/v1/callback` or `https://auth.bothcalendar.com/auth/v1/callback` |
| Google Calendar redirect | `https://qszg…/functions/v1/google-oauth` | `https://djxul…/functions/v1/google-oauth` (or custom domain) |
| Microsoft tenant | STAGE Entra (docs) | Both-owned tenant **not accessible** from current `az` (EAF) |
| Microsoft Sign-In app | STAGE | Both PROD — Sign In (**pending**) |
| Microsoft Calendar app | STAGE | Both PROD — Calendar Sync (**pending**) |
| MS account types | per STAGE config | Prefer `common` (personal + work) |
| MS publisher domain | STAGE | `bothcalendar.com` (**pending verification**) |
| Calendar Google scopes | calendar.events + calendarlist.readonly | same (code) |
| Calendar MS scopes | offline_access User.Read Calendars.ReadWrite | same (code) |
| Edge secret names | GOOGLE_* / MICROSOFT_* on STAGE | **same names, PROD values only** |
| SMTP | STAGE provider | PROD sender TBD |
| Verification | STAGE QA only | Google/MS **PENDING** |

## Redirect inventory (PROD technical host)

```
https://djxulqyuafhihmuyzvvk.supabase.co/auth/v1/callback
https://djxulqyuafhihmuyzvvk.supabase.co/functions/v1/google-oauth
https://djxulqyuafhihmuyzvvk.supabase.co/functions/v1/microsoft-oauth
```

## Redirect inventory (PROD branded — after custom domain)

```
https://auth.bothcalendar.com/auth/v1/callback
https://auth.bothcalendar.com/functions/v1/google-oauth
https://auth.bothcalendar.com/functions/v1/microsoft-oauth
```
