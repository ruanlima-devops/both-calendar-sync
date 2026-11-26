# Both — PO Launch Decisions Checklist

**As of:** 2026-11-26T04:00:00Z  
**Authorizations locked until PO changes them:**

| Gate | Value |
|------|-------|
| CLOSED_BETA_EXTERNAL_ACCESS_AUTHORIZED | **NO** |
| PUBLIC_SIGNUP_AUTHORIZED | **NO** |
| STRIPE_LIVE_AUTHORIZED | **NO** |

## Decisions needed from PO (blocking external beta)

1. **Supabase org create permission** — grant token/role so `Both PROD` can be created (or create manually and share ref).  
2. **Cost** — Free tier OK? Or approve Pro (~$25/mo) if Free limits block Auth/SMTP/backups.  
3. **Hostname** — Approve `app.bothcalendar.com` (or other) + DNS cutover plan; until then Access-gated workers.dev only.  
4. **Google** — Approve External audience path + Publishing “In production” / verification submission (agent must **not** submit without approval). Business docs / privacy URLs.  
5. **Microsoft** — Confirm Entra app for Both PROD, account types (personal vs work), publisher verification if needed.  
6. **Legal** — Approve Privacy + Terms; company identity; support/privacy/incident contacts.  
7. **Beta billing** — Choose A/B/C (see BOTH-CLOSED-BETA-PROD-LAUNCH-PLAN.md).  
8. **Ops owner** — Named on-call for closed beta; alert destination (email/Slack) without SYN-05 paid if possible.  
9. **SMTP** — Production sender domain + credentials (not personal Gmail).  
10. **First cohort** — Explicit list of 5–10 emails when ready to invite (separate approval).  

## Safe to proceed without PO (already done / in PR)

- Beta invite schema + server enforcement (flag default **false**)  
- Deploy PROD Internal workflow guards  
- Architecture / matrix / bootstrap / security docs  
- STAGE remains internal QA  

## Must remain false until later PO flip

- External invites  
- Public signup  
- Stripe Live  
- Disabling beta allowlist after go-live without pause plan  
