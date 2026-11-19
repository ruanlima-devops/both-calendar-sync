# STG-07 / SYN-05 — C3-PREP Implementation

**UTC:** `2026-11-19T04:59:04Z`–`2026-11-19T05:02:30Z`  
**Branch (local only):** `feat/syn-05-c3-prep` @ base `146f9a41253afacce01056c16d6e8d13c77d508c`  
**Worktree:** `/Users/ruan/Documents/work12-syn05-c3-prep`  
**No commit / push / PR / network / schedule / issues:write**

---

## Verdicts

| Gate | Value |
|------|--------|
| **C3_PREP_IMPLEMENTATION** | **PASS** |
| **C3_PREP_SECURITY** | **PASS** (C0 flags unchanged) |
| **C3_PREP_OFFLINE_TESTS** | **PASS** (65 watchdog + 40 deploy-safety) |
| **C3_PREP_READY_FOR_REVIEW** | **YES** (local) |
| C3_A / B / C / D / E | **NOT AUTHORIZED / OFF** |
| WATCHDOG_REMOTE / ALERT_DELIVERY | **NO** |
| SYN-05 / STG-07 / PROD | **NO-GO** |

---

## Architecture

```
GithubIssuesPort
├── MemoryGithubIssues      (durable state in body; offline)
├── DryRunGithubIssues      (plans + delegates)
└── HttpGithubIssues        (transport-injected; NOT used by C0 run.ts)

incident-state.ts           schema v1 block <!-- both-syn05-state:v1 ... -->
github-http.ts              FakeGithubIssuesTransport + types
reconcile.ts                search-before-create + streak from hydrated body
```

`run.ts` still constructs `DryRunGithubIssues(MemoryGithubIssues)` only.  
`isRealGithubIssuesEnabled` requires HTTP+WRITE+DRY_RUN=0 — all off in C0.

---

## Durable state schema (v1)

Fields: `schema_version`, `project_ref`, `environment`, `alert_id`, `fingerprint`, `first_seen_at`, `last_seen_at`, `consecutive_healthy`, `alert_status`, `last_transition_at`, `last_sample_window_end`.

Fail-closed: missing/corrupt/unknown schema → `consecutive_healthy=0` (no premature close).  
Same-window HEALTHY deduped; out-of-order windows ignored; FIRING resets streak.

---

## Dedup / recovery / races

- Fingerprint + bot marker + label filter.  
- `findOpenByFingerprint` / canonical lowest issue number.  
- Duplicates reported in `reconcileIncidents.duplicateFingerprints` — not auto-deleted.  
- **Limit:** GitHub search+create is not atomic; concurrency group reduces overlap; exactly-once not claimed.

---

## Security

DRY_RUN=1 · WRITE=0 · NETWORK=0 · schedule OFF · no `issues:write` · STAGE allowlist · repo allowlist `ruanlima-devops/both-calendar-sync` · redact secrets · no real `fetch` in Http adapter without injected transport.

---

## Tests

| Suite | Count |
|-------|--------|
| scripts/syn05-watchdog | **65 PASS** / 7 files |
| scripts/deploy-safety | **40 PASS** |
| dry-run CLI | OK |
| classify vs develop | **SAFE_SKIP** · run_db/run_functions false |

Coverage includes: search-before-create, restart persistence, 2×HEALTHY close, 403/404/409/422/429/5xx, flaky create, legacy body, same-window, sanitization, workflow invariants, corrupt schema.

---

## Files changed (uncommitted)

- `scripts/syn05-watchdog/incident-state.ts` (+test)
- `scripts/syn05-watchdog/github-http.ts`
- `scripts/syn05-watchdog/http-github-issues.ts` (+test)
- `scripts/syn05-watchdog/github-issues.ts`
- `scripts/syn05-watchdog/reconcile.ts` (+test tweak)
- this doc

---

## Next gates

| Gate | Requires |
|------|----------|
| Review/commit/PR | separate PO auth |
| C3-A | STAGE logs secret + NETWORK |
| C3-B | `issues:write` + WRITE + Http wired |
| C3-C | live recovery certify |
| C3-D | schedule |
| C3-E | external self-monitor |
