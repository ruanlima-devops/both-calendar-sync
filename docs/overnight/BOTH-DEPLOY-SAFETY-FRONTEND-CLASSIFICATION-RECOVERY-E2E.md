# BOTH — Deploy Safety Frontend Classification Recovery E2E

**UTC start:** 2026-11-22T14:13:45Z  
**Authorization:** Product Owner — express recovery of UNKNOWN_BLOCKED / unclassified_paths  
**Mode:** fail-closed; no deploy; no PROD; no merge of #43/#46/#15

## A. Autorização PO

Correção mínima do classificador para reconhecer paths frontend **exatos** auditados (#42/#43) como SAFE_SKIP de **deploy Supabase**, sem allowlist genérica `app/**` | `components/**` | `lib/**`.

## B. Preflight

| Check | Result |
| --- | --- |
| origin | `git@github.com:ruanlima-devops/both-calendar-sync.git` |
| origin/develop | `6a0897bd2cbc7a3af6ca90ca2289d3789851ad61` |
| #42 merge in develop | YES (`6abd4b4`) |
| #42 | MERGED |
| #43 | OPEN Draft MERGEABLE head `cfce3a0` |
| #46 | OPEN Draft (blocked) |
| #15 | OPEN head `7897954` intact |
| #26/#30 | intact (OPEN/CLOSED) |
| diagnostic `c1156b5` | exists (not cherry-picked blindly) |
| release gate | OFF (`vars.DEPLOY_SAFETY_ALLOW_CANDIDATE` not forced to 1) |
| SEC-07 | `sec07_tombstone_ok` |
| required checks | Application, Supabase (strict) |
| CI on PR | Application+Supabase only — **no deploy** |
| Deploy STAGE | `push` to `develop` only |
| PREFLIGHT | **PASS** |

## C. Incident baseline

Run https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45030676921  
`UNKNOWN_BLOCKED` / `unclassified_paths` / Classify exit 2 / Supabase STAGE skipped / `DEPLOY_COMMAND_EXECUTED=NO`.

## D. PR #42 semantic audit

| Field | Value |
| --- | --- |
| MERGE_SHA | `6abd4b46c0c511686e65515401482aa8d607f176` |
| PARENT_SHAS | `ffd9f34` + `94d4ab1` |
| CHANGED_PATHS | 16 (auth screens, auth UI, lib/auth client) |
| TARGET_RUNTIME | Expo Router / React Native Web client |
| Edge Function imports | **NONE** (grep empty for `@/lib/auth` under `supabase/functions`) |
| DEPLOY_RELEVANCE | No migrations / no functions / no config.toml |
| APPLICATION_SECURITY_REVIEW | Auth client still security-sensitive for **app** review |
| DEPLOY_TARGET_CLASSIFICATION | SAFE_SKIP eligible after exact allowlist |

## E. PR #43 semantic audit

| Field | Value |
| --- | --- |
| HEAD | `cfce3a02b3753a1c42035ce48ddb789289c887cf` |
| BASE | `6abd4b4` (#42 merge) |
| PATHS | 7 (onboarding screen + pure helpers) |
| Edge Function imports | **NONE** |
| DEPLOY_RELEVANCE | None |
| PR43_MERGED | **NO** (remains Draft) |

## F. Classifier architecture

Entrypoint: `scripts/deploy-safety/classify-deploy-changes.ts`  
Inputs: path list file. Empty / unsafe shape / unclassified → `UNKNOWN_BLOCKED` exit 2.  
Assert: `assert-deploy-decision.ts` — SAFE_SKIP → skip_remote; UNKNOWN still exit 2.  
Deploy job requires `assert_ok` + `run_db|run_functions`.

## G. Threat model (selected)

| Threat | Mitigation |
| --- | --- |
| Generic `app/**` allowlist | **Not implemented** — exact Set size 23 |
| Rename SQL onto allowlisted path | Content sniff rejects CREATE/ALTER/DROP TABLE etc. |
| Path traversal | `isUnsafePathShape` → other → UNKNOWN |
| Mixed safe+unknown | UNKNOWN_BLOCKED |
| Mixed safe+db/fn | DEPLOY_CANDIDATE_* (not SAFE_SKIP) |
| Case mismatch | Exact string match only |
| Sibling new file under app/(auth)/ | UNKNOWN until audited |
| Classifier self-change | Pre-existing `scripts/deploy-safety/` SAFE_SKIP prefix (C0.5); independent negatives remain |

## H. Minimal classification rules

New: `FRONTEND_CLIENT_SAFE_SKIP_EXACT` — 23 exact relative paths from #42+#43 audits.  
No directory wildcards. Content reject for non-client markers. Unsafe shapes blocked first.

## I. Positive tests

T11b PR42 → SAFE_SKIP; T11c PR43 → SAFE_SKIP; T11m deletion allowlisted → SAFE_SKIP.

## J. Negative tests

T11d–T11l: sibling, generic prefixes, mixed diffs, traversal, SQL-on-allowlist, case, lockfile, package.json, config, workflow.

## K. T11b incorporation

Diagnostic `c1156b5` expected UNKNOWN pre-fix. Recovery **replaces expectation** with SAFE_SKIP for the same path set; keeps incident citation. Worktree diagnóstica **não** modificada.

## L. Typecheck

`npm run typecheck` → PASS (exit 0).

## M. SEC-07

`--sec07-check` → `{ok:true, reason:sec07_tombstone_ok}`.

## N. Deploy Safety

Local suite: **103 PASS** (was 91; +12 frontend recovery tests).

Historical replay PR42/PR43 offline: SAFE_SKIP, run_db=false, run_functions=false.

## O. Bootstrap gate

Self-diff classifies as SAFE_SKIP via **pre-existing** prefixes `scripts/deploy-safety/` + `docs/` (C0.5 policy).  
Not a new self-authorization. Negatives prove fail-closed intact.  
Feature-branch push does **not** trigger Deploy STAGE.  
`BOOTSTRAP_GATE=PASS` under existing formal path.

## P. PR and CI

Filled after push/PR.

## Q. Merge status

Filled after conditional merge.

## R. STAGE PRE/POST

Filled after read-only inventory attempt.

## S. Historical diff replay

| Diff | Classification | run_db | run_functions |
| --- | --- | --- | --- |
| PR42 | SAFE_SKIP | false | false |
| PR43 | SAFE_SKIP | false | false |
| Self (classifier+tests+doc) | SAFE_SKIP | false | false |

## T. Final gates

See certification section in final report update.

## U. Risks

- Exact allowlist requires future audited additions for new frontend files.
- Content sniff is heuristic (not full AST).
- APPLICATION_SECURITY_REVIEW of Auth/Onboarding ≠ deploy skip.

## V. Required next PO decision

After this recovery merges (if certified):

1. Whether to undraft/merge **#43** (now would SAFE_SKIP Deploy STAGE) — **separate authorization**.
2. #46 remains DEPLOY_CANDIDATE — still blocked until release gate.
3. #15 untouched.
