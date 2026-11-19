# STG-07 / SYN-05 — C0.5 PR File Manifest

**Branch:** `feat/syn-05-deploy-safety-c0-5`  
**Base:** `origin/develop` @ `344a4b7`  
**PR:** [#18](https://github.com/ruanlima-devops/both-calendar-sync/pull/18) — **DRAFT** — head `69e404a`  
**Allowlist policy:** deploy-safety only  
**Post-publish UTC:** 2026-11-19T00:03:37Z — develop/main unchanged; Deploy STAGE not triggered; PR #15/#17 intocados

## Manifest (expected commit paths)

| Path | Role |
|------|------|
| `.github/workflows/deploy-stage.yml` | Fail-closed deploy workflow |
| `scripts/deploy-safety/classify-deploy-changes.ts` | Classifier + SEC-07 check |
| `scripts/deploy-safety/assert-deploy-decision.ts` | Decision assert / GITHUB_OUTPUT |
| `scripts/deploy-safety/list-changed-paths.ts` | Local git path helper |
| `scripts/deploy-safety/classify-deploy-changes.test.ts` | T01–T30 + YAML invariants |
| `scripts/deploy-safety/list-changed-paths.test.ts` | Fail-closed list tests |
| `scripts/deploy-safety/vitest.config.ts` | Isolated test config |
| `docs/STG-07-SYN-05-C0-5-DEPLOY-SAFETY-INTEGRATION.md` | Integration report |
| `docs/STG-07-SYN-05-C0-5-BOOTSTRAP-SAFETY.md` | Bootstrap analysis |
| `docs/STG-07-SYN-05-C0-5-PR-MANIFEST.md` | This file |

## Explicitly excluded

- Edge Functions / OAuth / billing / sync runtime / migrations / frontend
- Secrets, QA fixtures, `.env*`
- PR #15 / PR #17 trees
- Other workflows (`ci.yml`, watchdog YAMLs) — not modified
- `c0-4-deploy-safety/` local sandbox (not shipped)

## Related PRs (informational only — DO NOT ALTER)

- PR #15 — OAuth lifecycle — OPEN — intocado
- PR #17 — Watchdog C0 — DRAFT @ `69beb59` — intocado

## DO NOT MERGE

This PR is **DRAFT**. Opening it does **not** authorize:

- undraft / merge
- Stage deploy
- setting `DEPLOY_SAFETY_ALLOW_CANDIDATE`
- SQL remoto / functions deploy
- PR #17 merge
