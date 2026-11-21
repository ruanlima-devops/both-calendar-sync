# STG-07 / SYN-05 — C3-B.1 Issues Delivery Hardening

**Timestamp UTC:** 2026-11-21T14:06:04Z  
**Branch (local only):** `feat/syn-05-c3-b1-issues-hardening`  
**Worktree:** `/Users/ruan/Documents/work12-syn05-c3-b1`  
**Base SHA (lock):** `1c55aed88e07989c667561867439245e47648c42`  
**Document status:** local / **not committed**

---

## A. PO authorization

Authorized exclusively:

- Local preflight, isolated branch/worktree, HttpGithubIssues hardening, offline deterministic tests, typecheck, Deploy Safety SAFE_SKIP, local documentation, final report — then STOP.

**Not authorized:** commit, push, PR, undraft/merge, workflow_dispatch, GHA rerun, real GitHub Issues, real watchdog HTTP, `NETWORK=1`, `WRITE=1`, `issues:write`, schedule, PAT/secrets, live Supabase log reads, STAGE/PROD deploy, remote SQL, Stripe, PR #15 / `deploy-stage.yml` changes.

Preserved C0: `DRY_RUN=1`, `WRITE=0`, `NETWORK=0`, schedule OFF, no `issues:write`.

---

## B. Preflight / base SHA

| Check | Result |
| --- | --- |
| Repo / origin | `ruanlima-devops/both-calendar-sync` |
| Worktree HEAD | `1c55aed88e07989c667561867439245e47648c42` |
| `origin/develop` lock | **exact match** |
| PR #15 | OPEN / intocado |
| PR #17 / #18 / #19 / #20 | MERGED (prior certification) |
| Deploy Safety on develop | present (`scripts/deploy-safety/**`) |
| Other worktrees | not modified |
| In-progress git ops | none |

`C3_B_1_PREFLIGHT`: **PASS**

---

## C. Branch / worktree

- Branch: `feat/syn-05-c3-b1-issues-hardening` (local only)
- Worktree: `/Users/ruan/Documents/work12-syn05-c3-b1`
- No commit / no push / no PR

---

## D. Files changed (uncommitted)

| Path | Change |
| --- | --- |
| `scripts/syn05-watchdog/github-http.ts` | Host pin helpers, Link pagination parse, Fake pagination / ambiguous-create flags |
| `scripts/syn05-watchdog/http-github-issues.ts` | Paginated search, incompleteness errors, ambiguous create, safe reopen |
| `scripts/syn05-watchdog/github-issues.ts` | Port + Memory/DryRun reopen + close guards; re-export BOT_* |
| `scripts/syn05-watchdog/reconcile.ts` | FIRING path prefers `findClosed` + `reopenIncident` |
| `scripts/syn05-watchdog/http-github-issues.test.ts` | Offline suite (host pin, pagination, ambiguous create, reopen, C0) |
| `docs/STG-07-SYN-05-C3-B1-ISSUES-HARDENING.md` | This document |

Not touched: `deploy-stage.yml`, watchdog workflow permissions/schedule, Edge Functions, migrations, billing, PR #15, secrets.

---

## E. Host pin

- Origin fixed: `https://api.github.com`
- HTTPS / hostname / port / URL credentials validated (`assertGithubApiUrl`)
- Paths allowlisted to `ruanlima-devops/both-calendar-sync/issues[/:n]`
- Owner/repo allowlisted at `HttpGithubIssues` construct
- Pinned transport uses `redirect: 'error'`; never rebuilds host from input
- Authorization redacted in Fake call log; no requests on import
- Methods limited to GET/POST/PATCH
- Injectable Fake transport preserved for all tests

`C3_B_1_HOST_PIN`: **PASS**

---

## F. Pagination / completeness

- Client requests `per_page=100` and follows `Link: rel="next"` only when next URL is api.github.com + allowlisted path
- Caps: `maxPages` (default 10), `maxIssues` (default 1000)
- Incomplete → `SearchIncompleteError`; create / reopen / close paths fail-closed
- Pull Request items (`pull_request` field) filtered out
- Empty page = complete; invalid link / page cap / truncated = incomplete
- No claim of unbounded pagination

`C3_B_1_PAGINATION`: **PASS**

---

## G. Ambiguous create (timeout after POST)

- POST 5xx / timeout / 429: **no blind POST retry**
- Record sanitized `lastAmbiguousCreate` metadata (fingerprint + UTC)
- Re-search open by fingerprint:
  - found → return canonical
  - incomplete search → `SearchIncompleteError`
  - complete empty → `AmbiguousCreateError` (do **not** assume create failed; no second POST)
- Exactly-once **not** claimed

`C3_B_1_AMBIGUOUS_CREATE`: **PASS**

---

## H. Safe reopen

Preconditions (fail-closed): bot ownership, FIRING only, trusted state block, STAGE `project_ref` + `environment`, fingerprint match, issue closed, no stale sample window, no ambiguous multi-closed (`ReconcileRequiredError`).

On success: PATCH `state=open`, streak reset to 0, transition timestamp updated; body rebuilt via controlled block upsert.

Human / unmarked / corrupt state → refuse. Manual human close policy: **conservative — no automatic reopen of non-bot issues**; future auto-reopen of human-closed bot issues remains supervised (documented residual).

`C3_B_1_SAFE_REOPEN`: **PASS**

---

## I. Concurrency / idempotency

Covered offline:

- Search-before-create + fingerprint dedupe
- Timeout-after-create → single POST + re-read
- Duplicate open fingerprints reported by reconcile
- Canonical pick = lowest issue number
- 429 on list (retry then success); 409/422 without blind create loop
- Same-window HEALTHY does not double-count
- UNKNOWN / incomplete does not close
- Recovery closes after 2× HEALTHY across runs (Memory + DryRun)
- Reopen vs create race simulated via Fake

Residual: GitHub search+create is **not atomic**; concurrent runners can still create duplicates → reconcile + canonical pick + reopen path mitigate but do not eliminate.

`C3_B_1_CONCURRENCY`: **PASS** (with residual race documented)

---

## J. Rate limits / HTTP safety

| Case | Behavior |
| --- | --- |
| 401/403 | `unauthorized` fail-closed |
| 404 | `not_found`; no repo fallback |
| 409/422 | `conflict`; no blind create retry |
| 429 | Retry-After capped (≤15s), limited attempts |
| 5xx GET/PATCH | bounded retry |
| 5xx/timeout POST | ambiguous path (no POST retry) |
| Invalid JSON / schema | fail-closed |
| Incomplete pagination | fail-closed |
| Redirect / bad host | blocked at pin |

---

## K. PII / payload safety

Issue body fields remain derived/sanitized: alert_id, STAGE project_ref, environment, fingerprint, status, aggregates, UTC windows, versioned state block. Evidence goes through `redactText`. No bearer/JWT/cookies/raw logs/SQL/Authorization in payloads. Exception messages redacted via `GithubHttpError` / `redactText`.

`C3_B_1_PII_SAFETY`: **PASS**

---

## L. Tests + typecheck

Commands (offline, C0 flags):

```bash
BOTH_WATCHDOG_DRY_RUN=1 BOTH_WATCHDOG_GITHUB_WRITE=0 BOTH_WATCHDOG_ENABLE_NETWORK=0 \
  ./node_modules/.bin/vitest run scripts/syn05-watchdog
# → 8 files / 111 tests passed

BOTH_WATCHDOG_DRY_RUN=1 BOTH_WATCHDOG_GITHUB_WRITE=0 BOTH_WATCHDOG_ENABLE_NETWORK=0 \
  ./node_modules/.bin/vitest run --config scripts/deploy-safety/vitest.config.ts
# → 2 files / 40 tests passed

./node_modules/.bin/tsc --noEmit
# → exit 0

BOTH_WATCHDOG_DRY_RUN=1 BOTH_WATCHDOG_GITHUB_WRITE=0 BOTH_WATCHDOG_ENABLE_NETWORK=0 \
  node --experimental-strip-types scripts/syn05-watchdog/run.ts
# → dry_run:true JSON summary
```

No real network in tests (Fake transport only).

`C3_B_1_OFFLINE_TESTS`: **PASS**  
`C3_B_1_TYPECHECK`: **PASS**

---

## M. SAFE_SKIP / C0

Classifier on intended paths:

```json
{
  "decision": "SAFE_SKIP",
  "may_skip_remote_deploy": true,
  "run_db": false,
  "run_functions": false
}
```

C0 flags remain OFF for live delivery. Workflow still: dry-run 1, write 0, network 0, schedule commented, no `issues:write`.

`C3_B_1_DEPLOY_SAFETY`: **PASS**

---

## N. Limitations / residual risks

1. Search-before-create is not atomic under concurrent runners.
2. Ambiguous create with complete empty re-search blocks create but cannot prove remote non-existence (eventual consistency).
3. Human-closed bot issues: auto-reopen only when bot markers + trusted state remain; no reopen of unmarked human issues.
4. Pagination caps may yield incomplete → safe block (no silent miss → create).
5. Live GitHub Issues delivery still **NOT AUTHORIZED**.

---

## O. Final gates

| Gate | Verdict |
| --- | --- |
| `C3_B_1_PREFLIGHT` | PASS |
| `C3_B_1_HOST_PIN` | PASS |
| `C3_B_1_PAGINATION` | PASS |
| `C3_B_1_AMBIGUOUS_CREATE` | PASS |
| `C3_B_1_SAFE_REOPEN` | PASS |
| `C3_B_1_CONCURRENCY` | PASS |
| `C3_B_1_PII_SAFETY` | PASS |
| `C3_B_1_OFFLINE_TESTS` | PASS |
| `C3_B_1_TYPECHECK` | PASS |
| `C3_B_1_DEPLOY_SAFETY` | PASS |
| `C3_B_1_IMPLEMENTATION` | **PASS** |
| `C3_B_1_READY_FOR_REVIEW` | **YES** (local; no commit/PR yet) |
| `C3_B_LIVE_DELIVERY` | **NOT AUTHORIZED** |
| `C3_C_LIVE_RECOVERY` | **NOT CERTIFIED** |
| `C3_D_SCHEDULE` | **OFF** |
| `C3_E_EXTERNAL_SELF_MONITOR` | **NOT IMPLEMENTED** |
| `WATCHDOG_REMOTE_ENABLED` | **NO** |
| `ALERT_DELIVERY_CERTIFIED` | **NO** |
| `SYN-05` / `STG-07` / `PROD` | **NO-GO** |

---

## P. Next PO decision (C3-B.2)

Suggested next gate (requires new explicit PO auth):

1. Review local diff + this report.
2. Authorize commit + PR for C3-B.1 only (still no live Issues).
3. C3-B.2: supervised dry-run of delivery wiring without `issues:write` / or staged read-only validation plan.
4. Keep `C3_B_LIVE_DELIVERY` blocked until separate authorization.

**STOP** — no commit, push, PR, workflow, or live Issues executed in this phase.
