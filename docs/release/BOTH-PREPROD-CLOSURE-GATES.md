# Both — Pre-Production Closure + PROD Bootstrap Gates

**Captured:** 2026-11-26T04:05:00Z  
**develop baseline:** `daaba11` (+ feat/preprod-closure)  
**STAGE FE:** `entry-be471b8fe43b0f42a2b24aa3bb89b9b2.js`  
**Authorizations:** EXTERNAL=NO · PUBLIC_SIGNUP=NO · STRIPE_LIVE=NO

---

## Phase A readiness

| Gate | Value | Evidence |
|------|-------|----------|
| STAGE_MVP_P0 | **PASS** | BOTH-STAGE-P0-FINAL-CLOSURE-E2E.md |
| STAGE_SYNC_CORE | **PASS** | BOTHQA20261126022819 bidirectional |
| STAGE_REGRESSION | **PASS** | Vitest prior 848; this PR adds beta tests |
| GOOGLE_EXTERNAL_AUDIENCE | **PARTIAL** | STAGE client External/Testing; PROD client not created |
| GOOGLE_PUBLISHING_STATUS | **TESTING** | Observed for STAGE Calendar app |
| GOOGLE_PROVIDER_VERIFICATION | **PENDING** | Calendar scopes → verification; PO must approve submission |
| GOOGLE_REFRESH_TOKEN_POLICY | **BLOCKED** | Testing + calendar scopes ≈ 7-day refresh — multiweek beta risk |
| MICROSOFT_EXTERNAL_ACCOUNT_READINESS | **PARTIAL** | Personal/MSA path used in STAGE QA; corp tenants may block consent |
| MICROSOFT_PUBLISHER_VERIFICATION | **PENDING** | Not verified in accessible az tenant (`Both apps []`) |
| PRIVACY_DRAFTS | **PARTIAL** | In-app Privacy/Terms marked DRAFT |
| LEGAL_APPROVAL | **PENDING** | PO/legal |
| MINIMUM_OPERATIONS | **PARTIAL** | Manual logs + last_sync_error; SYN-05 OFF |
| INCIDENT_RESPONSE | **PARTIAL** | Runbook drafted; no automated page |
| BACKUP_RECOVERY | **PARTIAL** | STAGE uses Supabase defaults; PROD N/A |
| BETA_INVITATION_CONTROL | **PARTIAL** | Code+migration ready; flag default false; not live on STAGE until deploy |
| BETA_BILLING_POLICY | **PENDING_PO** | Keys `trial` vs `beta_grant`; default trial |

## Phase B / PROD

| Gate | Value |
|------|-------|
| PROD_ARCHITECTURE | **PASS** (documented) |
| PROD_COST_APPROVAL | **PENDING** (Free create Forbidden; Pro needs PO) |
| PROD_PROVISIONING_GATE | **BLOCKED** |
| PROD_SUPABASE | **NOT_STARTED** (create Forbidden) |
| PROD_DATABASE_MIGRATIONS | **NOT_EXECUTED** |
| PROD_EDGE_FUNCTIONS | **NOT_EXECUTED** |
| PROD_FRONTEND | **NOT_EXECUTED** |
| PROD_OAUTH_CONFIGURATION | **BLOCKED** |
| PROD_SMTP | **BLOCKED** |
| PROD_SECRET_ISOLATION | **BLOCKED** (no PROD yet) |
| PROD_ACCESS_RESTRICTION | **BLOCKED** (no deploy) |
| PROD_CI_CD_PROTECTION | **PASS** (workflow + guards coded; env approval required) |
| PROD_INTERNAL_SMOKE | **BLOCKED** |
| PROD_SECURITY_AUDIT | **PARTIAL** |
| PROD_TECHNICAL_READY | **BLOCKED** |
| CLOSED_BETA_LAUNCH_READY | **BLOCKED** |
| CLOSED_BETA_EXTERNAL_ACCESS_AUTHORIZED | **NO** |
| PUBLIC_SIGNUP_AUTHORIZED | **NO** |
| STRIPE_LIVE_AUTHORIZED | **NO** |
| NO_EXTERNAL_USERS | **PASS** |
| NO_UNAPPROVED_CHARGES | **PASS** |
| NO_UNAPPROVED_PUBLIC_LAUNCH | **PASS** |

## Google OAuth launch blockers (summary)

- Publishing remains Testing → refresh token lifetime risk for closed beta weeks.  
- Restricted/sensitive Calendar scopes → verification HUMAN_CHECKPOINT.  
- PROD credential isolation not provisioned.  
- Do not submit verification without PO.

## Microsoft launch blockers (summary)

- Publisher verification / admin consent risk for work tenants undocumented for PROD app.  
- PROD app registration not created.  
- Consumer accounts may work; corporate consent not guaranteed.

## Why PROD was not created

`supabase projects create` → **Forbidden** (org token cannot create). Zero-cost path blocked by permissions, not by cost refusal alone.
