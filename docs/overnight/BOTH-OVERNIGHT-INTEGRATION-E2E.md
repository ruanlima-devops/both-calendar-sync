# BOTH Overnight Integration E2E — 2026-11-22

**Baseline UTC:** 2026-11-22T13:52:42Z  
**Repo:** `ruanlima-devops/both-calendar-sync`  
**Overnight:** `/Users/ruan/Documents/work12-overnight-sprint` @ `3543958` (15 commits preserved)  
**Develop start:** `99e71b7` → **after merges:** `6abd4b4`

## A. Preflight

| Check | Result |
| --- | --- |
| origin | `git@github.com:ruanlima-devops/both-calendar-sync.git` |
| develop vs historical | identical `99e71b7` at start |
| Overnight clean + 15 commits | PASS |
| PR #15 | OPEN, CONFLICTING, head `7897954` |
| PR #15 worktree | `/Users/ruan/Documents/work12` @ `f2cf6c1` **untouched** |
| gh auth | PASS |
| Branch protection | Application + Supabase required; `strict=true`; no force-push |
| Release gate `DEPLOY_SAFETY_ALLOW_CANDIDATE` | absent → OFF |
| SEC-07 | PASS |

## B–D. Commit inventory & split

15 overnight commits audited and restructured into **6 integration branches** (overnight branch kept as backup).

| PR | Branch | Domain | Deploy Safety | Merge? |
| --- | --- | --- | --- | --- |
| [#41](https://github.com/ruanlima-devops/both-calendar-sync/pull/41) | `integration/overnight-syn05-docs` | SYN05 docs/policy | **SAFE_SKIP** | **MERGED** `ffd9f34` |
| [#42](https://github.com/ruanlima-devops/both-calendar-sync/pull/42) | `integration/overnight-auth-web` | Auth web | UNKNOWN_BLOCKED (run_*=false) | **MERGED** `6abd4b4` — Deploy STAGE job **failed classify** (fail-closed, no Supabase job) |
| [#43](https://github.com/ruanlima-devops/both-calendar-sync/pull/43) | `integration/overnight-onboarding` | Onboarding | UNKNOWN_BLOCKED | **DRAFT frozen** (stop after #42 Deploy STAGE failure pattern) |
| [#44](https://github.com/ruanlima-devops/both-calendar-sync/pull/44) | `integration/overnight-calendar-ux` | Calendar UX | UNKNOWN_BLOCKED | **DRAFT** |
| [#45](https://github.com/ruanlima-devops/both-calendar-sync/pull/45) | `integration/overnight-paywall` | Paywall | UNKNOWN_BLOCKED | **DRAFT** |
| [#46](https://github.com/ruanlima-devops/both-calendar-sync/pull/46) | `integration/overnight-billing-functions` | Billing/webhooks/migration | **DEPLOY_CANDIDATE_BOTH** | **DRAFT — DO NOT MERGE** |

## E. Why further frontend merges stopped

Official classifier treats `app/**` and `lib/**` (non-syn05) as `UNKNOWN_BLOCKED` and exits classify with code 2 → Deploy STAGE workflow **failure**.

Evidence after #42 (`run 45030676921`):
- Classify job: **failure**
- Supabase STAGE: **skipped**
- Record SAFE_SKIP: **skipped**
- **No db push / no functions deploy**

Per authorization (“Deploy Safety seguro” + prefer SAFE_SKIP), additional UNKNOWN_BLOCKED merges were **halted**. PO decision needed: either (a) accept fail-closed Actions failure as inert, or (b) authorize SAFE_SKIP allowlist for app/lib (classifier change — separate gate).

## F. CI observed

Required checks **Application** + **Supabase** PASS on PRs 41–46 before merge decisions.  
Non-required: Workers Builds / Supabase Preview (legacy project id in preview URL — skipped).

## G. STAGE PRE/POST

| Item | Result |
| --- | --- |
| After #41 | Deploy STAGE **success**, Supabase STAGE **skipped**, SAFE_SKIP recorded |
| After #42 | Deploy STAGE **failure** (UNKNOWN_BLOCKED classify), Supabase STAGE **skipped** |
| Functions/db remote mutate | **NONE observed** |
| STAGE_REMOTE_INTEGRITY | **NOT_VERIFIED** (no live inventory API); operationally **no deploy executed** |

## H. PR #15 reconciliation (local only)

| Field | Value |
| --- | --- |
| Worktree | `/Users/ruan/Documents/work12-int-oauth-recon` |
| Branch | `integration/oauth-pr15-reconciliation` @ `e6442db` |
| Pushed? | **NO** |
| Hard conflict vs develop | `.github/workflows/deploy-stage.yml` only |
| Resolution | Kept **develop** deploy-stage (do not adopt PR15 pipeline edits) |
| OAuth tests | **59 PASS** (oauth, finalize, disconnect, oauth-complete, routing, watch-policy) |
| Typecheck | PASS |
| Recommendation | **Option A+C hybrid:** reconcile original PR #15 onto current develop in a future authorized session; keep deploy-stage from develop; after overnight frontend PRs land, re-resolve calendars/onboarding overlaps. Do **not** auto-replace PR #15. |

### Conflict matrix (high level)

| File | Type | Develop | PR15 | Recommendation |
| --- | --- | --- | --- | --- |
| deploy-stage.yml | content conflict | C0.5 classifier | PR15 edits | **Keep develop** |
| calendars.tsx | both change | overnight Alert fix pending in #44 | OAuth UX | Manual merge later |
| onboarding/index.tsx | both change | overnight UX in #43 | small PR15 | Manual merge later |
| oauth.ts / google-oauth / microsoft-oauth | PR15 adds | legacy callback-complete | ticket/finalize | **Take PR15** |
| oauth migration ticket | PR15 adds | absent | required | **Take PR15** |
| delete-user / disconnect | overlap risk | overnight billing cancel in #46 (unmerged) | revoke path | Serialize with #46 |

## I. What is on develop now

- Overnight SYN-05 docs + collector fail-closed policy (`#41`)
- Web email/password auth + recovery UI (`#42`)

Still Draft/local: onboarding, calendar UX, paywall, billing functions, oauth recon.

## J. STAGE live gates (prepared, NOT executed)

See prior overnight docs. Still required before beta: SMTP auth, OAuth both providers, Stripe webhook live, delete account live, sync entitlement live — all need PO + secrets + deploy of #46.

## K. Residual blockers

1. Classifier does not SAFE_SKIP app/lib → Deploy STAGE red on frontend merges  
2. `#46` DEPLOY_CANDIDATE_BOTH needs release gate + STAGE deploy auth  
3. PR #15 still CONFLICTING / unmerged  
4. SYN-05 / STG-07 / PROD remain NO-GO  

## L. STRICT STATE

- No PR #15 mutation / no force-push / no PAT / no Cron / Better Stack PAUSED  
- No live Stripe/OAuth/SMTP/Logs API  
- Issues #26/#30 untouched  
