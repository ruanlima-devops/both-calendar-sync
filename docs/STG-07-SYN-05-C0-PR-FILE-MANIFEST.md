# STG-07 / SYN-05 — C0.1 PR File Manifest

**Data:** 2026-11-18  
**Branch:** `feat/syn-05-watchdog-c0`  
**Base:** `develop` @ `344a4b74b047fe0cf98d0477a981aec63e1f1300`  
**Source worktree (não commitado neste PR):** `/Users/ruan/Documents/work12`  
**Isolated worktree:** `/Users/ruan/Documents/work12-syn05-watchdog`

---

## Allowlist incluída

| Path | Motivo | Dependência | Origem | Novo/Mod | Secret? | Prod fora watchdog? |
|------|--------|-------------|--------|----------|---------|---------------------|
| `.github/workflows/both-stage-watchdog.yml` | Workflow dry-run STAGE | — | local C0 + SHA pin | Novo | NÃO | NÃO |
| `.github/workflows/both-stage-watchdog-self.yml` | Self-monitor design | — | local C0 + SHA pin | Novo | NÃO | NÃO |
| `scripts/syn05-watchdog/*` | Client/normalize/eval/reconcile/self/tests | `alert-evaluator.ts` | work12 local | Novo | NÃO | NÃO |
| `supabase/functions/_shared/observability/alert-evaluator.ts` | Avaliador ALERT-01/02/03 | nenhuma externa | work12 local | Novo | NÃO | NÃO (lib de avaliação) |
| `supabase/functions/_shared/observability/alert-evaluator.test.ts` | Testes do avaliador | vitest | work12 local | Novo | NÃO | NÃO |
| `vitest.config.ts` | Include `scripts/syn05-watchdog/**/*.test.ts` | vitest | develop + delta | Mod | NÃO | NÃO |
| `docs/STG-07-SYN-05-C0-PR-FILE-MANIFEST.md` | Este manifesto | — | C0.1 | Novo | NÃO | NÃO |
| `docs/STG-07-SYN-05-C0-RELEASE-READINESS.md` | Auditoria C0 | — | work12 | Novo | NÃO | NÃO |
| `docs/STG-07-SYN-05-C0-PUBLICATION-PLAN.md` | Plano publish isolado | — | work12 | Novo | NÃO | NÃO |
| `docs/STG-07-SYN-05-C0-1-PR-RESULT.md` | Evidência C0.1 | — | C0.1 | Novo | NÃO | NÃO |
| `docs/STG-07-SYN-05-GATE-B-WATCHDOG-IMPLEMENTATION.md` | Impl Gate B | — | work12 | Novo | NÃO | NÃO |
| `docs/STG-07-SYN-05-GATE-B-WATCHDOG-SECURITY.md` | Segurança | — | work12 | Novo | NÃO | NÃO |
| `docs/STG-07-SYN-05-GATE-B-WATCHDOG-CERTIFICATION.md` | Gates cert | — | work12 | Novo | NÃO | NÃO |

## Explicitamente excluído

- PR #15 / OAuth / billing / delete / frontend / migrations
- `observability.ts` (envelope Edge) — não importado pelo watchdog CLI
- Roadmap/risk/matrix canônicos dirty do work12 (evita findings não relacionados)
- `.env*`, fixtures QA, secrets
- Alterações em `ci.yml` / `deploy-stage.yml`
- `package.json` / lockfile (sem delta necessário)

## Action SHA pins (verificados)

| Action | Release | Commit SHA |
|--------|---------|------------|
| `actions/checkout` | v6.1.0 | `d23441a48e516b6c34aea4fa41551a30e30af803` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |

Fontes: GitHub Releases + `git/ref/tags` API (2026-11-18).
