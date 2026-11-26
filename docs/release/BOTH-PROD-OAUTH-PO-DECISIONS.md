# Both — PROD OAuth PO Decisions

**Authorizations locked:** BETA_EXTERNAL_ACCESS=NO · PUBLIC_LAUNCH=NO · STRIPE_LIVE=NO

| Gate | Value |
|------|-------|
| LEGAL_ENTITY_DECISION | **PASS** — RUAN FELIPE SERAFIM DE LIMA LTDA |
| LEGAL_DOCUMENT_VERIFICATION | **PENDING** |
| PROVIDER_VERIFICATION | **PENDING** |

Canonical record: `BOTH-LEGAL-ENTITY-DECISION.md`

## Decisions requiring PO

| # | Decision | Status / notes | Blocks |
|---|----------|----------------|--------|
| 1 | Legal entity for publishers | **APPROVED** — RUAN FELIPE SERAFIM DE LIMA LTDA; brand Both | — |
| 2 | Support / privacy / developer emails | Must be @bothcalendar.com | Consent screen |
| 3 | Approve Privacy + Terms for public host | DRAFT until legal text + RFB data confirmed | Verification submit |
| 4 | Confirm CNPJ/address set for public + provider forms | BrasilAPI candidate recorded; **PENDING RFB confirm** | Provider forms |
| 5 | Upgrade Supabase org to **Pro** (~$25/mo) | Required for Custom Domains | Branded Auth URL |
| 6 | Approve Custom Domain add-on (~$10/mo) for `auth.bothcalendar.com` | Official Supabase only | Enterprise branding |
| 7 | Approve public DNS for `app.` / `auth.` | Zero $ DNS; public exposure risk | FE + Auth routing |
| 8 | Authorize Google verification **submission** | Agent prepares only | Multiweek refresh tokens |
| 9 | Provide Both-owned Entra admin + Partner ID path | az CLI was EAF (wrong) | MS PROD + verified publisher |
| 10 | When to re-enable PROD signup | Keep disabled until invite + EXTERNAL=YES | External users |

## Safe actions already taken

- PROD ref `djxulqyuafhihmuyzvvk`; signup disabled; Google/Azure Auth off  
- GCP `both-production` created  
- Legal entity decision recorded; Privacy/Terms drafts name LTDA as operator  
- Cost assessment: `docs/finance/BOTH-SUPABASE-COST-ASSESSMENT-2026.md`

## Do not do without PO

- Submit Google/Microsoft verification  
- Publish Privacy/Terms as final with unverified CNPJ  
- Enable Supabase Custom Domain / Pro without cost approval  
- Public DNS cutover · Stripe Live · External invites · Copy STAGE tokens  
