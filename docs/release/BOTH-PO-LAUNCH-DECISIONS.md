# Both — PO Launch Decisions Checklist

**As of:** 2026-11-26T04:00:00Z  
**Authorizations locked until PO changes them:**

| Gate | Value |
|------|-------|
| CLOSED_BETA_EXTERNAL_ACCESS_AUTHORIZED | **NO** |
| PUBLIC_SIGNUP_AUTHORIZED | **NO** |
| STRIPE_LIVE_AUTHORIZED | **NO** |
| LEGAL_ENTITY_DECISION | **PASS** — RUAN FELIPE SERAFIM DE LIMA LTDA |
| LEGAL_DOCUMENT_VERIFICATION | **PENDING** |
| PROVIDER_VERIFICATION | **PENDING** |

## Decisions needed from PO (blocking external beta)

1. **Cost** — Stay Free vs Pro (~$25/mo) + Custom Domain (~$10) — see `docs/finance/BOTH-SUPABASE-COST-ASSESSMENT-2026.md`.  
2. **Hostname** — Approve `app.bothcalendar.com` / `auth.bothcalendar.com` + DNS.  
3. **Confirm CNPJ/address** for public policies + Google/MS forms (candidate in `BOTH-LEGAL-ENTITY-DECISION.md`; RFB confirm).  
4. **Privacy + Terms** — Approve final text + institutional contacts (@bothcalendar.com).  
5. **Google** — Authorize verification **submission** only after docs live.  
6. **Microsoft** — Entra Both tenant + Partner Center under LTDA; authorize publisher verification.  
7. **Beta billing** — Choose A/B/C (see BOTH-CLOSED-BETA-PROD-LAUNCH-PLAN.md).  
8. **Ops owner** — On-call + alert destination.  
9. **SMTP** — Production sender on bothcalendar.com.  
10. **First cohort** — 5–10 emails when EXTERNAL=YES.  

## Safe / already done

- Legal entity decision recorded (LTDA; brand Both)  
- PROD Supabase `djxulqyuafhihmuyzvvk`; signup off  
- Beta invite gate (default false) · Deploy PROD Internal guards  
- STAGE = internal QA only  

## Must remain false until later PO flip

- External invites  
- Public signup  
- Stripe Live  
- Disabling beta allowlist after go-live without pause plan  
