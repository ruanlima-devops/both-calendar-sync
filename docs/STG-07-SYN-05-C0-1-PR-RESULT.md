# STG-07 / SYN-05 — C0.1 Isolated PR Result

**Data:** 2026-11-18  
**Escopo:** branch isolada + UM PR · **sem merge** · **sem** schedule/secrets/`issues:write` · **sem** execução remota do watchdog

---

## Seleção de base

| Item | Valor |
|------|-------|
| Default branch | `main` |
| Base do PR | **`develop`** @ `344a4b7` |
| Justificativa | Branch oficial de integração STAGE; proteção com checks; `deploy-stage` só em **push** a `develop` (abrir PR não faz deploy); PR #15 também usa `develop` mas **não** é alterado |
| Alternativa | `main` (2 commits à frente via #16) — útil depois para schedule no default |

## Isolamento

| Item | Valor |
|------|-------|
| Worktree | `/Users/ruan/Documents/work12-syn05-watchdog` |
| Branch | `feat/syn-05-watchdog-c0` |
| Worktree original | `/Users/ruan/Documents/work12` permanece em `feat/m3-003-oauth-lifecycle` @ `f2cf6c1` |

## Testes (base isolada)

| Suite | Resultado |
|-------|-----------|
| `npm test` em develop+watchdog | **239 PASS / 32 files** |
| Baseline work12 (com #15 local) | 608 PASS — diferença = testes do PR #15 / worktree dirty **não** transportados (esperado) |

## Action pins

- `actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803` (v6.1.0)
- `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1` (v7.1.0)

## Publicação

| Item | Valor |
|------|-------|
| Commit | `702c5220eea965bc378b00c863f9537b3d8ec999` |
| Branch remota | `origin/feat/syn-05-watchdog-c0` |
| PR | **#17** DRAFT — https://github.com/ruanlima-devops/both-calendar-sync/pull/17 |
| Base/Head | `develop` ← `feat/syn-05-watchdog-c0` |
| PR #15 | OPEN · intacto (`updatedAt` 2026-10-02) |
| `main` / `develop` tips | inalterados por push direto |
| Schedule | OFF |
| Watchdog no default | **ausente** (`ci.yml`, `deploy-stage.yml` only) |
| Watchdog workflow runs | **nenhum** (workflow não registrado no default) |
| CI pré-existente no PR | `Application` + `Supabase` QUEUED/in_progress (esperado; `contents: read`) |
| Deploy STAGE | **não** disparado (só push a `develop`) |

## Vereditos

| Veredito | Estado |
|----------|--------|
| **C0.1** (branch+PR) | **PASS** |
| Watchdog ativo / registrado default | **NÃO** |
| ALERT DELIVERY | **BLOCKED** |
| STG-07 / PROD | **NO-GO** |

## Next PO

Autorizar review/merge do **#17** (ainda dry-run/schedule off). Secrets/network/schedule/`issues:write` = gates separados. Não mergear #15 neste gate.
