# STG-07 / SYN-05 — C0.3 Application Typecheck Fix

**Data UTC:** 2026-11-18  
**Branch:** `feat/syn-05-watchdog-c0` · **PR:** #17 (DRAFT)  
**Escopo:** typecheck only · sem merge · sem deploy-stage change

## Root cause

| Erro | Causa |
|------|-------|
| TS5097 | Imports `*.ts` + tsc sem `allowImportingTsExtensions` (necessário para Node `--experimental-strip-types`) |
| ProcessEnv | `isGithubWriteEnabled(NodeJS.ProcessEnv)` rejeitava fakes parciais nos testes |
| TS1117 | `seedHumanIssue` com `number` duplicado (`...partial` + override) |
| Extra | Parameter property em `DryRunGithubIssues` quebrava strip-only Node; mock `calls[0]` tipagem vazia |

## Patch

- `tsconfig.json`: `allowImportingTsExtensions: true` (compatível com `noEmit` do Expo base)
- `github-issues.ts`: `WatchdogEnv`; seed sem duplicate key; constructor sem parameter property
- `supabase-logs-client.test.ts`: cast seguro de `mock.calls`

## Local evidence

- `npm run typecheck` → **PASS**
- `npm test` → **239 PASS / 32 files**
- `node --experimental-strip-types scripts/syn05-watchdog/run.ts` → dry-run JSON OK

## Push Safety Gate

- `deploy-stage.yml`: só `push` → `develop` / dispatch — **não** na branch isolada
- Push atualiza PR #17 → CI `pull_request` Application+Supabase (local) · contents:read
- Watchdog workflows: só `workflow_dispatch` — não disparam no push

## Remote evidence (post-push)

| Item | Valor |
|------|-------|
| Commit | `8f71828f71734b1f6b9ee78bbe02dfa151e03fbd` |
| PR #17 | DRAFT · head atualizado |
| Application | **SUCCESS** (run `44401336419`) |
| Supabase | **SUCCESS** |
| Workers Builds | FAILURE (externo, não obrigatório) |
| Deploy STAGE | **não** disparado |
| Watchdog workflow runs | **nenhum** |
| mergeStateStatus | `UNSTABLE` (Workers Builds) · merge ainda bloqueado por DRAFT + Deploy STAGE risk |

## Merge

Continua **BLOCKED** pelo risco Deploy STAGE em merge→develop (C0.2) + DRAFT.
