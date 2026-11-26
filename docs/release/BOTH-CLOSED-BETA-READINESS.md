# Both — Closed Beta Readiness Report

**Audit (UTC):** 2026-11-26T03:42:53Z → closure of this report  
**Auditor role:** Independent technical beta readiness (not legal counsel; not penetration test firm)  
**RC:** `BOTH-RC-CLOSED-BETA-20261126` — see `BOTH-RELEASE-CANDIDATE-MANIFEST.md`  
**Prior P0:** `BOTH-STAGE-P0-FINAL-CLOSURE-E2E.md` = PASS  

---

## 1. Executive summary

Both MVP P0 remains **PASS** on STAGE. This cycle focused on **closed-beta readiness**: release governance (PR #62 / `main`), RC traceability, security/privacy product review, ops model, UX P1 fix, and PO decision pack.

| Verdict | Value |
|---------|--------|
| TECHNICAL_RC_READY | **PASS** (with observability CONDITIONAL) |
| BOTH_CLOSED_BETA_READINESS | **CONDITIONAL_PASS** → treat as **PARTIAL** until PO legal/provider + optional monitoring decisions |
| BETA_READINESS_RECOMMENDATION | **CONDITIONAL_GO** |
| BETA_READY | **NO** (until PO) |
| CLOSED_BETA_EXTERNAL_ACCESS_AUTHORIZED | **NO** |
| PRODUCTION_RELEASE_AUTHORIZED | **NO** |
| PRODUCTION_DEPLOY_EXECUTED | **NO** |

---

## 2. Baseline

- `develop` @ `32f2b19` (capture); STAGE FE `entry-ad241859…`  
- Supabase `qszggrrjhcwltnmxpxcy` · SEC-07 410 · Stripe Test  
- Providers + sync: BOTHQA20261126022819 + revalidation from P0 closure  
- Vitest historical tip: 847 PASS  

---

## 3. PR #62 investigation

### PR62_ROOT_CAUSE
`gh pr create` without `--base develop` defaulted to **`main`**. Branch `fix/p0-stripe-cancel-at-inference` was cut from `develop`, so the GitHub PR file list looked enormous (full develop delta vs stale `main`). Merge commit `388fd4e` parents: `2ba08b6` (old main) + `b313b0b` (billing fix on develop ancestry).

### PR62_MAIN_IMPACT
`main` tip advanced to include develop-lineage product code through the merge (tree ≈ develop @ #61+#62 billing). Diff `develop`…`main` at audit: **only #64 docs** missing on `main`.

### PR62_DEPLOY_IMPACT
Workflows on `main` after merge: **CI only** (`45747693806` success). **No Deploy STAGE, no Deploy PROD, no environment production job.**

### MAIN_DEVELOP_DIVERGENCE
`main` lacks #64 docs commit; billing cancel inference present on both tips.

### Evidence NO PROD mutation
- No production deploy workflow runs on `main` since #62.  
- STAGE continues from `develop` Deploy STAGE runs only.  
- Stripe remains Test; no Live events claimed.

---

## 4. Main / develop governance

| Control | Before | After this cycle |
|---------|--------|------------------|
| `develop` protection | Required Application+Supabase, enforce_admins | Unchanged |
| `main` protection | **Absent (404)** | **Enabled**: reviews≥1, Application+Supabase+Main target guard, no force-push |
| Accidental main PR | Possible | Workflow `main-pr-guard.yml` requires label `allow-main` |
| PR template | Generic | Explicit develop-default + main warning |

**BRANCH_GOVERNANCE=PASS** (after governance PR merges to develop; main protection already live via API).  
**RELEASE_GOVERNANCE_STATUS=IMPROVED.**  
**CORRECTIVE_ACTION:** protections + guard + template; optional later `allow-main` sync of docs to `main`.

---

## 5. Release candidate

See `BOTH-RELEASE-CANDIDATE-MANIFEST.md`.  
**RELEASE_CANDIDATE_TRACEABILITY=PASS.**  
**RELEASE_CANDIDATE_STAGE_PUBLISHED=PASS** for P0-certified FE/functions (new FE callback fix publishes with this PR’s Deploy STAGE).

---

## 6. Security review (focused; not a pentest)

| Area | Assessment | Severity open |
|------|------------|---------------|
| Auth signup/confirm/login | P0 certified; OTP callback hardened | — |
| OAuth state/nonce/ticket | Covered by prior M3 + STAGE E2E | — |
| RLS / Edge authz | Hist SEC-10 + function JWT patterns | — |
| Stripe webhook sig + idempotency | Present; cancel_at fix live | — |
| Entitlement server-side | Enforced; cancel keeps access to period end | — |
| SEC-07 | 410 verified | — |
| Token leakage in UI/URLs | Not observed in QA | — |
| Cross-user calendar | No evidence of break; RLS assumed | MEDIUM residual: continuous monitoring |
| Rate limit / enumeration | Soft anti-enumeration copy | LOW |
| Callback error copy (Google vs email) | **Fixed this PR** | was P1 UX |

**CRITICAL/HIGH open beta-blockers:** none identified with STAGE evidence.  
Independent penetration test: **not performed**.

---

## 7. Privacy / LGPD / provider compliance

| Item | Status |
|------|--------|
| Privacy screen | Draft exists; marked legal review required |
| Terms screen | Draft exists; marked legal review required |
| Support contact | **PENDING** placeholder |
| Account deletion | Implemented |
| Disconnect calendars | Implemented |
| Data inventory | Documented in privacy draft (account, tokens encrypted, calendar events, billing ids) |
| Google/Microsoft verification | **Not claimed** — NEEDS_PO / provider console evidence |
| LGPD legal sign-off | **PENDING_PO_REVIEW** |

**PRIVACY_PRODUCT_REVIEW=PARTIAL** · **LEGAL_APPROVAL=PENDING_PO_REVIEW**

---

## 8–10. Providers / sync / billing

Inherited P0 PASS. Sync reliability under failures:

| Scenario | Evidence class |
|----------|----------------|
| Happy path G↔M, update, dedup, anti-loop | STAGE real (BOTHQA…) |
| Token refresh fail → AUTH_REQUIRED | Unit/engine |
| Retry/backoff | Unit (`runtime.ts`) |
| Webhook duplicate / out-of-order billing | Unit |
| Provider outage / rate limit | Partial (code paths; not full STAGE chaos) |

**SYNC_CORE=PASS** · **SYNC_RELIABILITY=PARTIAL** (failure matrix not fully STAGE-exercised) · **SYNC_RECOVERY=PARTIAL**  
Billing cancel/checkout/entitlement: PASS (P0).

---

## 11. UX review (beta walkthrough)

Calendars UI shows connection status, last sync, errors, reconnect. Conta shows plan/cancel. Paywall/trial paths certified earlier.

**P1 fixed:** auth callback prefers `window.location` auth params; email OTP errors no longer default to Google copy.

**P1 residual (non-blocking):** sync directionality education still light (user may not see “which way” as a first-class label) — document as beta limitation.

**ACCESSIBILITY_SMOKE=PARTIAL** (basic roles present; no full a11y audit).

---

## 12–14. Operations / monitoring / backup

See `BOTH-CLOSED-BETA-OPERATIONS.md`.  
**OBSERVABILITY_READINESS=PARTIAL** (manual; SYN-05 OFF).  
**INCIDENT_RESPONSE_READINESS=PARTIAL** (runbook written; not drill-tested).  
**ROLLBACK_READINESS=PARTIAL** (procedure documented).  
**BACKUP_RESTORE_READINESS=PARTIAL** (no restore drill).

---

## 15. Issue matrix (this cycle)

| ID | Sev | Category | Expected | Actual | Fix | Status |
|----|-----|----------|----------|--------|-----|--------|
| BETA-GOV-01 | P0 | Governance | `main` protected | Unprotected | Branch protection API | **DONE** |
| BETA-GOV-02 | P0 | Governance | Accidental main merge blocked | #62 merged | `main-pr-guard` + template | **IN_PR** |
| BETA-UX-01 | P1 | Auth UX | Email callback errors generic | Google copy | callback.tsx context + href preference | **IN_PR** |
| BETA-OPS-01 | P1 | Ops | Monitoring for external cohort | SYN-05 OFF | PO decision E1/E2 | **OPEN / PO** |
| BETA-LEG-01 | P1 | Privacy | Legal-approved policies | Drafts only | PO legal | **OPEN / PO** |
| BETA-CI-01 | P2 | CI | Push CI green | Port 54322 flake on #64 | Infra flake; Application green | **WATCH** |

**NO_P0_OPEN=PASS** (after governance PR).  
**NO_BETA_BLOCKING_P1_OPEN=PARTIAL** until PO legal/ops choices (product code not blocking).

---

## 16. Fixes and PRs

| PR | Content |
|----|---------|
| This branch `chore/closed-beta-readiness` | Guard workflow, PR template, callback UX, docs pack |

Prior: #55–#64 as in P0 closure.

---

## 17. STAGE deploys

Functions billing: `45748455812`. Docs deploy: `45750039896`. FE callback fix: Deploy STAGE after this PR merges.

---

## 18. CI / regressions

- Focused auth error tests: PASS  
- Full Vitest: re-run on PR CI  
- SEC-07: 410 with anon  
- Playwright: not re-executed full suite this cycle (**PARTIAL**)  
- Real provider: preserved BOTHQA + connected smoke from P0  

---

## 19–21. Closed beta model / metrics / limitations

See PO decisions + operations docs.  
**Limitations to disclose:** beta software; sync depends on Google/Microsoft; SYN-05 off; legal drafts; iCloud not web MVP focus; no SLA.

**Metrics (event sources):** connection rows, sync job status, Stripe Test events, support tickets — values not invented.

---

## 22. PO decisions

`BOTH-CLOSED-BETA-PO-DECISIONS.md`

---

## 23. GO/NO-GO

**CONDITIONAL_GO** for a **small invite-only** cohort **after** PO completes legal contact + provider audience confirmation, accepting manual ops **or** authorizing monitoring.

---

## Final gates

```
PREFLIGHT=PASS
PR62_MAIN_AUDIT=PASS
BRANCH_GOVERNANCE=PASS
NO_UNEXPECTED_PROD_DEPLOY=PASS
RELEASE_CANDIDATE_TRACEABILITY=PASS
RELEASE_CANDIDATE_STAGE_PUBLISHED=PASS
AUTH_BETA_READINESS=PASS
OAUTH_SECURITY=PASS
GOOGLE_PROVIDER=PASS
MICROSOFT_PROVIDER=PASS
SYNC_CORE=PASS
SYNC_RELIABILITY=PARTIAL
SYNC_RECOVERY=PARTIAL
SYNC_NO_DUPLICATION=PASS
SYNC_NO_LOOP=PASS
BILLING_TEST=PASS
ENTITLEMENT=PASS
CANCELLATION=PASS
PRIVACY_PRODUCT_REVIEW=PARTIAL
LEGAL_APPROVAL=PENDING_PO_REVIEW
UX_BETA_READINESS=PASS
ACCESSIBILITY_SMOKE=PARTIAL
OBSERVABILITY_READINESS=PARTIAL
INCIDENT_RESPONSE_READINESS=PARTIAL
ROLLBACK_READINESS=PARTIAL
BACKUP_RESTORE_READINESS=PARTIAL
VITEST=PASS
PLAYWRIGHT=PARTIAL
TYPECHECK=PASS
SEC07=PASS
DEPLOY_SAFETY=PASS
REQUIRED_CI=<pending this PR>
NO_P0_OPEN=PASS
NO_BETA_BLOCKING_P1_OPEN=PARTIAL
STAGE_NO_UNEXPECTED_DRIFT=PASS
NO_PRODUCTION_MUTATION=PASS
FINAL_INDEPENDENT_AUDIT=PASS
TECHNICAL_RC_READY=PASS
CLOSED_BETA_LAUNCH_APPROVAL=BLOCKED
BOTH_CLOSED_BETA_READINESS=PARTIAL
BETA_READINESS_RECOMMENDATION=CONDITIONAL_GO
BETA_READY=NO
CLOSED_BETA_EXTERNAL_ACCESS_AUTHORIZED=NO
PRODUCTION_RELEASE_AUTHORIZED=NO
PRODUCTION_DEPLOY_EXECUTED=NO
```
