# STG-07 / SYN-05 — C0.5 Deploy Safety Integration

**Checkpoint:** C0.5  
**UTC evidence window:** 2026-11-18  
**Authorization:** Gates A/B yes; Gate C if push/PR safety PASS; Gates D/E/F **NO**.

## A. PRECHECK

| Check | Result |
|-------|--------|
| Origin | `ruanlima-devops/both-calendar-sync` |
| develop HEAD | `344a4b74b047fe0cf98d0477a981aec63e1f1300` |
| main HEAD | `6b2ba10e2d744bbdeb537db27846504fc82059a1` |
| PR #15 | OPEN, head `78979549…`, **intocado** |
| PR #17 | DRAFT, head `69beb59…`, **intocado** |
| Worktree original | `/Users/ruan/Documents/work12` — dirty local, preserved |
| Worktree watchdog | `/Users/ruan/Documents/work12-syn05-watchdog` — preserved |
| Worktree C0.5 | `/Users/ruan/Documents/work12-deploy-safety` @ `feat/syn-05-deploy-safety-c0-5` |
| Branch protection develop | required checks: Application, Supabase; enforce_admins; no force push |
| Deploy trigger | `deploy-stage.yml` on `push: develop` + `workflow_dispatch` only |
| CI trigger | `ci.yml` on PR + push develop/main — `contents: read` |
| Opt-ins network write | OFF for this checkpoint |
| Secrets printed | none |

## B. C0.4 PATCH REVIEW

Reused ideas from `c0-4-deploy-safety/`; **not** blind copy.

| Item | C0.4 | C0.5 change |
|------|------|-------------|
| Decisions | SAFE_SKIP / DB_REQUIRED / … / PIPELINE_REQUIRED / UNKNOWN | Renamed to SAFE_SKIP / DEPLOY_CANDIDATE_* / BOOTSTRAP_REVIEW / REQUIRES_REVIEW / UNKNOWN_BLOCKED |
| Path | `c0-4-deploy-safety/` (local only) | `scripts/deploy-safety/` (repo allowlist) |
| config.toml | FUNCTIONS_REQUIRED | REQUIRES_REVIEW (alone) |
| Candidate auto-run | Yes when classified | **No** until `DEPLOY_SAFETY_ALLOW_CANDIDATE=1` |
| SEC-07 veto | Absent | Present before functions |
| Action pins | checkout+setup-node SHA; setup-cli `@v1` | All three pinned to verified SHAs |
| Assert/tamper | Implicit | Explicit `assert-deploy-decision.ts` |

## C. DEPLOY WORKFLOW BASELINE (develop)

Unguarded: every develop push → link → `db push` → `functions deploy` **all**. No paths-filter. Drift SEC-07 confirmed.

## D–F. BOOTSTRAP

See `docs/STG-07-SYN-05-C0-5-BOOTSTRAP-SAFETY.md`. Selected: First Deploy Guard + path classifier + merge BLOCKED until certified.

## G. LOCAL INTEGRATION

Files:

- `.github/workflows/deploy-stage.yml` — classify → assert → conditional deploy
- `scripts/deploy-safety/classify-deploy-changes.ts`
- `scripts/deploy-safety/assert-deploy-decision.ts`
- `scripts/deploy-safety/list-changed-paths.ts`
- tests + vitest config under `scripts/deploy-safety/`
- docs C0.5

Guarantees:

1. Classification before Supabase credentials use in deploy job.
2. `db push` / `functions deploy` gated by `env.RUN_* == 'true'`.
3. Deploy job `if` requires `assert_ok` and a run flag.
4. Invalid config / missing decision / tamper → no deploy.
5. CI (`ci.yml`) unchanged — protection INV-19.
6. Project-ref hard-coded expect `qszggrrjhcwltnmxpxcy` (INV-20).

## H. CLASSIFIER INVARIANTS

| INV | Status |
|-----|--------|
| INV-01/02 watchdog-only no db/functions | PASS (T01) |
| INV-03 docs-only SAFE_SKIP | PASS (T02) |
| INV-04/05 migration/function → candidate | PASS (T03/T04) |
| INV-06 _shared candidate | PASS (T05) |
| INV-07 config REVIEW | PASS (T06) |
| INV-08 deploy-stage BOOTSTRAP_REVIEW | PASS (T07) |
| INV-09/10 UNKNOWN_BLOCKED | PASS (T10/T11/T16) |
| INV-11/12 multi/merge range via caller+classify | PASS (T08/T09) |
| INV-13 rename/delete path | PASS (T14) |
| INV-14/15 mixed not SKIP | PASS (T15/T30) |
| INV-16 UNKNOWN never deploys | PASS (assert) |
| INV-17 SEC-07 veto | PASS (T23/T24 + develop tip fail) |
| INV-18 SKIP auditável | PASS (outputs + skip-notice) |
| INV-19 CI intact | PASS (ci.yml not modified) |
| INV-20 no PROD / fixed ref | PASS |

Decision vocabulary: `SAFE_SKIP` | `DEPLOY_CANDIDATE_*` | `BOOTSTRAP_REVIEW` | `REQUIRES_REVIEW` | `UNKNOWN_BLOCKED`.  
**DEPLOY_CANDIDATE ≠ authorization.**

## I. TEST RESULTS

```text
npx vitest run --config scripts/deploy-safety/vitest.config.ts
Test Files  2 passed (2)
Tests  40 passed (40)
```

Local only. No Supabase. No remote SQL. No workflow_dispatch.

## J. SECURITY AUDIT

| Topic | Finding |
|-------|---------|
| permissions | `contents: read` only |
| checkout | `d23441a48e516b6c34aea4fa41551a30e30af803` verified |
| setup-node | `949feb2413d6458794dcd2491c4babbbce0c15c1` verified |
| setup-cli | `1dedf2c611547ede7232d26866dd3c56ab903bbb` verified |
| secrets | only in deploy job after gates; not logged |
| GITHUB_TOKEN | default; no write scopes requested |
| PR trust | workflow **not** on pull_request |
| forks | N/A for develop push path |
| shell | env-injected SHAs; no untrusted interpolation of paths into shell eval |
| fail-closed | default; candidate release opt-in |
| concurrency | `both-stage-deployment`, cancel-in-progress false |
| schedule | none |
| required checks | Application, Supabase — unchanged |

## K. FILE DELTA AUDIT

Allowlist only (see PR manifest). No Edge Functions / OAuth / billing / migrations / frontend / secrets / PR #15/#17 content.

## L. PUSH/PR SAFETY GATE

| Event | Workflows | Stage mutate? |
|-------|-----------|---------------|
| Push `feat/syn-05-deploy-safety-c0-5` | CI if branch listed? **ci.yml** only develop/main + PR | **No** Deploy STAGE (not develop) |
| Open DRAFT PR → develop | **CI** Application/Supabase (`contents: read`) | **No** Deploy STAGE (no pull_request trigger) |
| Future merge → develop | Deploy STAGE @ tip + CI | Guarded — still **DO NOT MERGE** this checkpoint |

**Gate C authorization criteria:** PASS for branch push + new DRAFT PR only.

## P. C0.5 VERDICT

| Verdict | Result |
|---------|--------|
| **C0.5 LOCAL** | **PASS** |
| **C0.5 PR PUBLICATION** | Proceed Gate C (draft only) |
| **BOOTSTRAP_CERTIFIED** | **BLOCKED** |
| **SAFE_TO_MERGE** | **BLOCKED** |
| **PR #17 MERGE READINESS** | Still **BLOCKED** (needs this guard on develop first + Gate D) |

## Q. NEXT PO AUTHORIZATION (not executed)

D1 review → D2 bootstrap certify → D3 PO integrate → D4 controlled integrate → D5 verify → D6 reassess #17 → D7 PO #17 → D8–D10 watchdog remote / Issues write.

**NENHUM MERGE. NENHUM DEPLOY. NENHUM SQL REMOTO. NENHUM PROD.**
