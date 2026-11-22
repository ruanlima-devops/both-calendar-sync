# STG-07 / SYN-05 — C3-B.4.1 Delivery Identity & Isolation

**Report UTC:** 2026-11-21T23:16:00Z  
**Branch (local only):** `feat/syn-05-c3-b41-delivery-isolation`  
**Worktree:** `/Users/ruan/Documents/work12-syn05-c3-b41`  
**Base SHA:** `26663e9f27a188d8c3defbae3a2336b4a8ead458`  
**Status:** LOCAL / **NOT committed** / **NOT pushed** / **NO PR**

---

## A. PO authorization

Authorized: local worktree/branch; Collector/Evaluator/Delivery split; versioned artifact; integrity; disabled Delivery workflow; write gate; concurrency protections; offline tests; typecheck; Deploy Safety classify; local doc; STOP.

**Not executed:** commit, push, PR, Issues live, NETWORK/WRITE, schedule, secrets, deploy, classifier mutation.

---

## B. Preflight / base SHA

| Item | Result |
| --- | --- |
| `origin/develop` | `26663e9f27a188d8c3defbae3a2336b4a8ead458` (lock OK) |
| PR #15 | OPEN / `78979549…` |
| PR #17–#21 | MERGED |
| Prior B41 worktree/branch | absent → created |

`C3_B_4_1_PREFLIGHT`: **PASS**  
`C3_B_4_1_WORKTREE`: **PASS**

---

## C. Branch / worktree

- Branch: `feat/syn-05-c3-b41-delivery-isolation`
- Worktree: `/Users/ruan/Documents/work12-syn05-c3-b41`
- No commit / push / PR

---

## D. Files changed (uncommitted)

| Path | Role |
| --- | --- |
| `scripts/syn05-watchdog/collector.ts` | Collector boundary |
| `scripts/syn05-watchdog/evaluator.ts` | Evaluator → artifacts |
| `scripts/syn05-watchdog/delivery.ts` | Delivery attempt (inert) |
| `scripts/syn05-watchdog/delivery-artifact.ts` | Schema v1 + hash + path safety |
| `scripts/syn05-watchdog/write-gate.ts` | Fail-closed WRITE_AUTHORIZED |
| `scripts/syn05-watchdog/delivery-isolation.test.ts` | Offline isolation suite |
| `.github/workflows/both-stage-watchdog-delivery.yml` | Disabled Delivery scaffold |
| `docs/STG-07-SYN-05-C3-B41-DELIVERY-ISOLATION.md` | This document |

**Not modified:** existing watchdog workflows, `deploy-stage.yml`, Edge Functions, migrations, PR #15, `run.ts` wiring (HttpGithubIssues still unwired).

---

## E. Architecture / split

- **Collector:** injected signals path for C0; optional `collectStageLogs` never called by C0; forbids Issues.
- **Evaluator:** pure `evaluateAll` + artifact emission; no HTTP / no GitHub / no Supabase token.
- **Delivery:** validates artifact + provenance + write gate; **never** calls real Issues API; `DELIVERY_REAL_ADAPTER_WIRED=false`.

`C3_B_4_1_ARCHITECTURE`: **PASS**  
`C3_B_4_1_IDENTITY_ISOLATION`: **PASS** (code + disabled YAML design)

---

## F–G. Artifact schema / integrity

Schema: `both-syn05-delivery-artifact:v1`

Derived fields only; `additionalProperties` rejected; STAGE project/env fixed; alert allowlist; ISO windows; SHA256 of canonical JSON; provenance bind to run_id + commit; path allowlist under `artifacts/syn05-delivery/`.

**Documented:** hash ≠ authenticity; future producer identity / run provenance still required before live.

Incomplete / UNKNOWN → `mayMutateIssuesFromArtifact=false`.

`C3_B_4_1_ARTIFACT_SCHEMA`: **PASS**  
`C3_B_4_1_INTEGRITY`: **PASS**

---

## H. Workflow disabled

`.github/workflows/both-stage-watchdog-delivery.yml`:

- `on: {}` — no executable triggers
- permissions: `contents: read` only
- no uncommented `issues:write`
- no Supabase secrets
- `cancel-in-progress: false`
- job `if: false` refuse step
- offline YAML parse OK

`C3_B_4_1_WORKFLOW_DISABLED`: **PASS**

---

## I–K. Write gate / concurrency / security tests

Write gate separates `PERMISSION_AVAILABLE` vs `WRITE_AUTHORIZED`; C0 defaults + C3-B.4.1 hard block refuse all writes.

Concurrency: delivery attempts remain noop/idempotent under C0; residual GitHub race documented from C3-B.1 (unchanged).

Offline suite covers schema/hash/provenance/path/PII/injection/flags/YAML/C0.

`C3_B_4_1_WRITE_GATE`: **PASS**  
`C3_B_4_1_CONCURRENCY`: **PASS**  
`C3_B_4_1_SECURITY_TESTS`: **PASS**

---

## L–M. Tests / typecheck

| Suite | Result |
| --- | --- |
| Watchdog vitest | **9 files / 143 passed** (was 111; +32 isolation) |
| Deploy-safety vitest | **2 files / 40 passed** |
| `tsc --noEmit` | **exit 0** |
| C0 CLI | `dry_run:true` |

`C3_B_4_1_TYPECHECK`: **PASS**

---

## N. Deploy Safety / C0

**Full local delta (including new workflow):**

```json
{
  "decision": "UNKNOWN_BLOCKED",
  "reasons": ["unclassified_paths", ".github/workflows/both-stage-watchdog-delivery.yml"],
  "run_db": false,
  "run_functions": false,
  "may_skip_remote_deploy": false
}
```

**Scripts + docs only (excluding workflow):** `SAFE_SKIP` / run_db=false / run_functions=false.

Classifier **not** modified (PO rule).

`C3_B_4_1_DEPLOY_SAFETY`: **BLOCKED**

**Proposed next gate:** allowlist `.github/workflows/both-stage-watchdog-delivery.yml` as SAFE_SKIP exact (or equivalent) under separate PO auth **before** any commit/PR of this branch — or stage commit without workflow until classifier updated.

C0 invariants preserved: DRY_RUN=1, WRITE=0, NETWORK=0, schedule OFF, no issues:write, adapter unwired.

---

## O. Residual risks / gaps

1. Deploy Safety blocks publication of new workflow until classifier allowlist gate.
2. Hash integrity ≠ cryptographic authenticity of producer.
3. GHA concurrency still not a distributed mutex.
4. Search+create race residual (from C3-B.1).
5. `on: {}` workflows may be ignored by GitHub UI; still must not add triggers without auth.
6. Collector network path exists but unused — must stay gated by NETWORK flag + future auth.

---

## P. Final gates

| Gate | Verdict |
| --- | --- |
| `C3_B_4_1_IMPLEMENTATION` | **BLOCKED** (Deploy Safety) |
| `C3_B_4_1_READY_FOR_REVIEW` | **NO** |
| `C3_B_LIVE_DELIVERY` | **NOT AUTHORIZED** |
| `WATCHDOG_REMOTE_ENABLED` | **NO** |
| `ALERT_DELIVERY_CERTIFIED` | **NO** |
| `C3_D_SCHEDULE` | **OFF** |
| `SYN-05` / `STG-07` / `PROD` | **NO-GO** |

---

## Q. Next PO decision (C3-B.4.2 blocked until)

1. **Classifier allowlist gate** for disabled delivery workflow → SAFE_SKIP, **or**
2. Defer workflow file to a later PR after classifier update; ship scripts/docs first under SAFE_SKIP.
3. Only then authorize C3-B.4.2 commit + DRAFT PR.

**STOP** — no commit / push / PR / live delivery.
