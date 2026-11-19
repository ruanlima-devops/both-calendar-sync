# STG-07 / SYN-05 — C0.5 Bootstrap Safety

**UTC:** 2026-11-18T23:59:30Z (preflight) / local Gate B completed same session  
**Repo:** `ruanlima-devops/both-calendar-sync`  
**Worktree:** `/Users/ruan/Documents/work12-deploy-safety`  
**Branch:** `feat/syn-05-deploy-safety-c0-5`  
**Base develop:** `344a4b74b047fe0cf98d0477a981aec63e1f1300`

## A–G answers (bootstrap semantics)

| Q | Answer | Evidence |
|---|--------|----------|
| **A** Which workflow revision evaluates a push that changes the YAML? | The workflow file at the **event commit SHA (tip)**. | [GitHub Docs — Workflows](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows): GitHub searches `.github/workflows` at the associated commit SHA; each run uses that version. |
| **B** Tip, previous, or other? | **Tip / resulting commit** of the push/ref. Not the previous develop tip. | Same docs: “version of the workflow that is present in the associated commit SHA”. |
| **C** Is `deploy-stage.yml` classified DEPLOY_REQUIRED? | Classified **`BOOTSTRAP_REVIEW`** (special control). Not SAFE_SKIP. Not auto-deploy. | Classifier + T07/T13/T22. |
| **D** Does that force full deploy on mitigation merge? | **No**, under the tip-SHA workflow: `run_db=false`, `run_functions=false`; assert fail-closed. | Simulated C0.5 path set → `BOOTSTRAP_REVIEW`. |
| **E** Fail-closed first-deploy guard without weakening future checks? | **Yes (selected):** (1) pipeline self-change → BOOTSTRAP_REVIEW; (2) `DEPLOY_SAFETY_ALLOW_CANDIDATE` default unset → candidates do not auto-deploy; (3) SEC-07 tombstone veto before functions. | Workflow + assert + SEC-07 check on develop tip → `sync_calendar_not_tombstone_legacy_code`. |
| **F** Local tests + indispensable external evidence? | Local: T01–T30 + YAML invariants. External (for Gate D later): tip-SHA docs citation; post-merge Actions run must show classify BOOTSTRAP_REVIEW and **no** `db push` / `functions deploy`. | Test run 40 PASS; docs URL above. |
| **G** If undemonstrable? | Merge/activation stays **BLOCKED** (Option 5 / Gate D). | This checkpoint does **not** merge. |

## Critical Stage drift (SEC-07)

On `origin/develop` @ `344a4b7`:

- `supabase/functions/sync-calendar/index.ts` = **legacy runtime** (not tombstone).
- `supabase/config.toml` `[functions.sync-calendar] verify_jwt = false`.
- STAGE remote certified: sync-calendar **v22** tombstone.

Any unguarded `supabase functions deploy` from develop tip would republish legacy code and **revert SEC-07**.

Local check:

```text
{"ok":false,"reason":"sync_calendar_not_tombstone_legacy_code"}
```

## Options matrix

| OPÇÃO | REQUISITOS | RISCO | EVIDÊNCIA | BENEFÍCIO | LIMITAÇÃO | RECOMENDAÇÃO |
|-------|------------|-------|-----------|-----------|-----------|--------------|
| **1 First Deploy Guard** | Tip-SHA semantics + BOOTSTRAP_REVIEW + release var OFF | Residual: if tip-SHA docs wrong, old workflow could deploy | GH docs + local classify | Blocks bootstrap deploy without remote config | Needs Gate D certify after first develop push | **ADOPT (primary)** |
| **2 Controlled Release Approval** | GitHub Environment required reviewers | staging env exists but only branch_policy; no reviewers configured | `gh api .../environments/staging` | Strong human gate | Requires remote Environment config (**not authorized** now) | Defer to Gate D2 |
| **3 Separate CI/CD** | Split validate vs deploy workflows | Larger migration | Current: Deploy STAGE push develop; CI PR+push | Clean trust boundary | Bigger change surface | Future hardening |
| **4 Watchdog-only exception** | Path classifier allowlist (not PR name/label) | Allowlist drift | SAFE_SKIP prefixes/exact | Enables PR #17 merge later without STAGE mutate | Must not widen to deploy-stage.yml | **ADOPT (classifier)** |
| **5 Explicitly BLOCKED bootstrap** | No merge until certified procedure | Blocks STG-07 progress | Valid if tip-SHA uncertain | Zero Stage risk | Blocks integration | **SAFE_TO_MERGE = BLOCKED** until Gate D |

## Selected strategy

**Option 1 + Option 4 classifier + Option 5 for merge readiness.**

1. Publish isolated DRAFT PR (Gate C) containing guarded `deploy-stage.yml` + classifier.
2. Do **not** undraft/merge (Gate D unauthorized).
3. On a future authorized merge into develop, tip workflow must classify the merge as `BOOTSTRAP_REVIEW` → no Stage mutate.
4. Keep `DEPLOY_SAFETY_ALLOW_CANDIDATE` unset until separate PO release authorization **and** SEC-07 tombstone lands on develop.
5. Certify bootstrap only after observing the post-merge Actions run (read-only).

## Verdicts

| Verdict | Status |
|---------|--------|
| BOOTSTRAP design (local) | **PASS** |
| BOOTSTRAP_CERTIFIED (remote observed) | **BLOCKED** — no merge/run on develop authorized |
| SAFE_TO_MERGE | **BLOCKED** — awaiting Gate D1–D5 |
