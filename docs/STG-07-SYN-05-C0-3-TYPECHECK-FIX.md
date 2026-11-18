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

## Merge

Continua **BLOCKED** pelo risco Deploy STAGE em merge→develop (C0.2).
