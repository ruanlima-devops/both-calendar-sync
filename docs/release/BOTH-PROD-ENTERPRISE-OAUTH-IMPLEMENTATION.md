# Both — PROD Enterprise OAuth Implementation Prep

**Captured (UTC):** 2026-11-26T05:25:00Z  
**Scenario C selected.** Cost now **USD 0**.  
Related: `BOTH-PROD-ORG-SEPARATION-PLAN.md`, `BOTH-GOOGLE-PROD-CLIENTS.md`, `BOTH-MICROSOFT-PROD-APP-REGISTRATIONS.md`, `BOTH-PROD-DNS-CUSTOM-DOMAIN-CUTOVER.md`, `BOTH-PROD-IDENTITY-PO-CHECKPOINTS.md`, `BOTH-LEGAL-ENTITY-DECISION.md`

---

## Live PROD Auth state (Dashboard)

| Setting | Value |
|---------|-------|
| Project | Both PROD `djxulqyuafhihmuyzvvk` |
| Org (current) | Both Calendar Sync Free |
| Google provider | **Disabled** |
| Azure provider | **Disabled** |
| Allow new users to sign up | **OFF** (switch unchecked) |
| Custom domains | Pro add-on — blocked |

---

## Sign-In vs Calendar (code-backed)

| Flow | Entry | Callback builder | Scopes |
|------|-------|------------------|--------|
| Google Sign-In | `supabase.auth.signInWithOAuth({ provider: 'google' })` | Auth `/auth/v1/callback` | openid email profile |
| Microsoft Sign-In | `provider: 'azure'` | Auth `/auth/v1/callback` | Auth defaults |
| Google Calendar | `google-oauth` function | `GOOGLE_REDIRECT_URI` or `{SUPABASE_URL}/functions/v1/google-oauth` | calendar.events + calendar.calendarlist.readonly |
| Microsoft Calendar | `microsoft-oauth` function | `MICROSOFT_REDIRECT_URI` or function URL | offline_access User.Read Calendars.ReadWrite |

Inventory helper: `lib/oauth/prod-redirects.ts` (+ tests).

**OAUTH_CALLBACK_MATRIX = PASS** for technical URLs · branded URLs **planned** until CD.

---

## Secret / environment inventory (names only)

| Variable | STAGE | PROD | Source | Required for | Current |
|----------|-------|------|--------|--------------|---------|
| `SUPABASE_PROD_PROJECT_REF` | n/a | `djxulqyuafhihmuyzvvk` | GitHub `production` | Deploy guard | Expect set |
| Supabase URL / anon / service_role | STAGE ref | PROD ref only | Dashboard | FE + Edge | PROD keys exist; FE not public |
| Auth Google client id/secret | STAGE | PROD Sign-In client | GCP | Enable Google Auth | **Missing PROD** |
| Auth Azure client id/secret | STAGE | PROD Sign-In app | Entra Both | Enable Azure Auth | **Missing PROD** |
| `GOOGLE_CLIENT_ID/SECRET` | STAGE | Calendar client | GCP | Edge sync | **Missing PROD** |
| `GOOGLE_REDIRECT_URI` | STAGE URL | PROD function URL | Config | Exact match | **Missing PROD** |
| `MICROSOFT_CLIENT_ID/SECRET` | STAGE | Calendar app | Entra Both | Edge sync | **Missing PROD** |
| `MICROSOFT_REDIRECT_URI` | STAGE URL | PROD function URL | Config | Exact match | **Missing PROD** |
| Stripe Live keys | — | — | — | Billing Live | **Forbidden** |
| SMTP PROD | — | TBD | Provider | Auth email | **Missing** |
| `EXPO_PUBLIC_SUPABASE_URL` FE PROD | stage host | `app` + PROD API/CD | CF Worker secrets | FE | Not released |

**PROD_SECRET_ISOLATION_DESIGN = PASS** (design) · values not created.  
Never copy STAGE secrets into PROD.

---

## Activation order (authorized later)

See org separation plan § cutover, then:

1. Create Google/MS clients with technical redirects.  
2. Optionally pre-add branded redirects.  
3. After Pro + CD activate: verify SSL on `auth.bothcalendar.com`.  
4. Set PROD Auth provider credentials; keep providers **Disabled** until internal smoke approved.  
5. Deploy Edge Functions + migrations under PROD_INTERNAL gate.  
6. Internal OAuth smoke only.  
7. Provider verification / external beta = separate PO gates.

---

## Code / CI this sprint

- Docs + legal entity alignment + Scenario C org IDs in redirect module.  
- No PROD deploy.  
- Deploy PROD Internal workflow already refuses STAGE/legacy refs.
