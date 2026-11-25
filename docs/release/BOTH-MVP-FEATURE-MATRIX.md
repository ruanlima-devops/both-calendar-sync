# Both — MVP Feature Matrix (STAGE)

**Audit date:** 2026-11-25  
**Develop HEAD (at matrix write):** `f2e92230b6e23525c092552d6c2959b073277d03`  
**STAGE web:** https://stage.bothcalendar.com  
**Supabase STAGE:** `qszggrrjhcwltnmxpxcy`  
**PROD:** forbidden / not audited for mutation

Legend: `DONE_LIVE_STAGE` · `DONE_CODE_ONLY` · `PARTIAL` · `NOT_IMPLEMENTED` · `BLOCKED` · `NOT_IN_MVP`

| FEATURE | IMPLEMENTED | MERGED | DEPLOYED_STAGE | STAGE_TESTED | LIVE_PROVIDER_TESTED | TEST_COVERAGE | SECURITY_STATUS | BUGS | REMAINING_WORK | PRIORITY | OWNER | NEXT_ACTION | CLASS |
|--------|-------------|--------|----------------|--------------|----------------------|---------------|-----------------|------|----------------|----------|-------|-------------|-------|
| Signup (email/password) | YES | #42 | YES (FE `64b2e988…`) | YES → confirm-email | N/A | unit+browser | OK | — | email confirm inbox path | P0 | Auth | Confirm QA mailbox | DONE_LIVE_STAGE |
| Login | YES | #42 | YES | YES (UI) | N/A | unit+browser | OK | — | login with confirmed user | P0 | Auth | Confirm synthetic user | DONE_LIVE_STAGE |
| Password recovery | YES | #42 | YES | YES (UI) | N/A | unit+browser | OK | — | deliverability check | P0 | Auth | Send recovery to QA | DONE_LIVE_STAGE |
| Sessions | YES | develop | YES | PARTIAL | N/A | unit | OK | — | expiry E2E | P0 | Auth | Session refresh E2E | PARTIAL |
| Profile | YES | develop | YES | NOT_EXECUTED | N/A | unit | OK | — | STAGE profile smoke | P1 | Web | Smoke logged-in | DONE_CODE_ONLY |
| Onboarding | YES | #43 | YES (FE) | PARTIAL (routes) | N/A | unit | OK | — | full journey w/ OAuth | P0 | Product | Complete after live OAuth | PARTIAL |
| Google OAuth connect | YES | #50 | YES (fn v25) | SECURITY smoke 401 | BLOCKED (QA consent) | 27 local OAuth + unit | PASS local CSRF/ticket | — | live Google QA | P0 | OAuth | QA Google connect | PARTIAL |
| Microsoft OAuth connect | YES | #50 | YES (fn v24) | SECURITY smoke 401 | BLOCKED | same | PASS local | — | live MS QA | P0 | OAuth | QA MS connect | PARTIAL |
| Connect calendars UI | YES | #44/#50 | YES FE | PARTIAL | BLOCKED | unit | OK | — | live connect | P0 | Web | After provider QA | PARTIAL |
| List/select calendars | YES | #44 | YES FE | NOT_EXECUTED | BLOCKED | unit | OK | — | STAGE select E2E | P0 | Web | Logged-in calendar page | PARTIAL |
| Disconnect | YES | #50 | YES (fn v20) | 401 unauth | BLOCKED | unit+local | OK | — | live disconnect | P0 | OAuth | QA cycle | PARTIAL |
| Reconnect | YES | #50 | YES | NOT_EXECUTED | BLOCKED | local | OK | — | live reconnect | P0 | OAuth | QA cycle | PARTIAL |
| Refresh token | YES | develop | YES (shared) | NOT_EXECUTED | BLOCKED | unit | OK | — | expired token recovery live | P1 | Sync | Fixture | PARTIAL |
| Sync G→M | YES (engine) | M1 hist | functions live | NOT_EXECUTED this run | BLOCKED | unit hist | OK | — | deliberate STAGE sync | P0 | Sync | QA calendars | DONE_CODE_ONLY |
| Sync M→G | YES | M1 hist | functions live | NOT_EXECUTED | BLOCKED | unit hist | OK | — | deliberate STAGE sync | P0 | Sync | QA calendars | DONE_CODE_ONLY |
| Event update/delete | YES | M1 | YES | NOT_EXECUTED | BLOCKED | unit | OK | — | live CRUD | P0 | Sync | QA | DONE_CODE_ONLY |
| Dedup / anti-loop | YES | M1/M2 | YES | NOT_EXECUTED | BLOCKED | unit | OK | — | live certify | P0 | Sync | QA | DONE_CODE_ONLY |
| Conflicts / retries | YES | M2 | YES | NOT_EXECUTED | BLOCKED | unit | OK | — | live certify | P1 | Sync | QA | DONE_CODE_ONLY |
| Trial 14d | YES hist | billing | STAGE hist | NOT_EXECUTED this run | N/A Stripe Test | unit+hist E2E | OK | — | revalidate signup→trial | P0 | Billing | Confirm after auth | PARTIAL |
| Checkout Stripe Test | YES | hist/#46 recon | billing-checkout live | NOT_EXECUTED | NOT_EXECUTED | unit | OK | — | Test Mode checkout | P0 | Billing | After #53 deploy | PARTIAL |
| Paywall UX | YES | #45 | YES FE | UI route 200 | N/A | unit | OK server entitlement | — | entitlement live | P0 | Billing | Logged-in paywall | PARTIAL |
| Active subscription | YES | hist | YES | NOT_EXECUTED | NOT_EXECUTED | unit | OK | — | Stripe Test | P0 | Billing | #53 + Test | PARTIAL |
| Payment failed / grace | YES | #46 recon | migration STAGE | NOT_EXECUTED | NOT_EXECUTED | unit (webhook) | OK | — | Stripe fixtures | P1 | Billing | After #53 | DONE_CODE_ONLY |
| Cancelation | YES | hist/#46 | YES | NOT_EXECUTED | NOT_EXECUTED | unit | OK | — | portal cancel Test | P1 | Billing | Stripe Test | PARTIAL |
| Account deletion | YES | M3-001 | YES | hist STG-06F | N/A | unit | OK | — | disposable re-run | P1 | Account | Disposable QA | DONE_CODE_ONLY |
| Revocation | PARTIAL | #50 | YES | local | MS skip known | unit | OK | MS app-scoped skip | MS revoke product decision | P1 | OAuth | NEEDS_PO if change | PARTIAL |
| RLS / SEC-10 | YES | hist | `20261117000001` | hist PASS | N/A | hist | PASS | — | preserve | P0 | Security | Monitor | DONE_LIVE_STAGE |
| Observability SYN-05 | PARTIAL | #38–#41 | inert | OFF | N/A | unit | fail-closed | Observer OFF | Gate for activation | P2 | Ops | Do not auto-enable | BLOCKED |
| Performance / a11y / responsive | PARTIAL | FE | YES | PARTIAL viewport | N/A | limited | OK | — | a11y audit | P1 | Web | Keyboard pass | PARTIAL |
| Beta prep | NO | — | — | — | — | — | — | ops+live OAuth+billing | Certify after P0 live | P0 | PO | See launch blockers | BLOCKED |

## Classification totals (honest)

| Class | Count (approx) |
|-------|----------------|
| DONE_LIVE_STAGE | Auth UI paths, RLS, FE publish, OAuth/Billing function presence |
| PARTIAL | OAuth/Billing/Sync product loops pending live QA |
| DONE_CODE_ONLY | Sync engine / many billing paths without this-run STAGE E2E |
| BLOCKED | Live providers, SYN-05 remote, Beta |

**Not invented:** iCloud remains out of MVP web launch path unless roadmap says otherwise (`NOT_IN_MVP` for web P0).
