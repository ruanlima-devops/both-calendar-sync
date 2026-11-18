# STG-07 / SYN-05 — C0.1 Isolated PR Result

**Data:** 2026-11-18  
**Escopo:** branch isolada + UM PR · **sem merge** · **sem** schedule/secrets/`issues:write` · **sem** execução remota do watchdog

---

## Seleção de base

| Item | Valor |
|------|-------|
| Default branch | `main` |
| Base do PR | **`develop`** @ `344a4b7` |
| Justificativa | Branch oficial de integração STAGE; proteção com checks; `deploy-stage` só em **push** a `develop` (PR não faz deploy); PR #15 também usa `develop` mas **não** é alterado |
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

Preenchido após push/PR:

- Commit SHA: _(após commit)_
- PR URL/number: _(após create)_
- PR #15: intacto
- Schedule: OFF
- Watchdog workflows no default: ainda ausentes até merge

## Vereditos

| Veredito | Estado |
|----------|--------|
| C0.1 (branch+PR) | PASS se push/PR OK |
| Watchdog ativo | **NÃO** |
| ALERT DELIVERY | **BLOCKED** |
| STG-07 / PROD | **NO-GO** |
