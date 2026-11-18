# STG-07 / SYN-05 — C0 Publication Plan (PLAN ONLY)

**Data:** 2026-11-18  
**Status:** plano local · **NÃO executar** commit/push/merge/cherry-pick nesta fase  
**Objetivo:** publicar watchdog **sem** mergear PR #15 (OAuth/Billing/M3-003)

---

## 1. Premissas

- Arquivos watchdog hoje: **somente locais** (`LOCAL_FILE_EXISTS`).
- **Não** estão no PR #15 · **não** em `develop` · **não** em `main`.
- Default branch: **`main`** (schedule futuro depende de `main`).
- PR #15 base: `develop` — acoplar watchdog ao merge do #15 arrasta OAuth lifecycle não necessário para C0.
- Branch protection em `main`: **ausente** → publicação exige disciplina/PO extra.

C0 LOCAL PASS **≠** autorização de publish. Publish = autorização PO **separada** (ainda “C0 remote” / pós-C0).

---

## 2. Arquivos necessários (conjunto mínimo)

### Obrigatórios

| Path | Motivo |
|------|--------|
| `.github/workflows/both-stage-watchdog.yml` | Workflow dry-run |
| `.github/workflows/both-stage-watchdog-self.yml` | Self-monitor design |
| `scripts/syn05-watchdog/**` | Client, evaluate, reconcile, tests |
| `supabase/functions/_shared/observability/alert-evaluator.ts` | Dependência de `evaluation.ts` / `normalize.ts` |
| `supabase/functions/_shared/observability/alert-evaluator.test.ts` | Testes do evaluator |
| `vitest.config.ts` (delta `scripts/syn05-watchdog/**/*.test.ts`) | Include de testes |

### Documentação (recomendado no mesmo PR)

| Path |
|------|
| `docs/STG-07-SYN-05-GATE-B-WATCHDOG-*.md` |
| `docs/STG-07-SYN-05-C0-*.md` |
| Atualizações canônicas risk/matrix/roadmap **somente** se o PR for isolado de SYN-05 |

### Explicitamente **fora** do pacote

- Qualquer arquivo de `app/`, `lib/auth/*` OAuth, billing deploy, migrations BIL/SEC, `deploy-stage.yml` changes, QA fixtures, `.env*`, Stripe, delete-account flows do PR #15.

### Transitivas

- `package.json` / `package-lock.json`: **só** se o delta for necessário para vitest já existente; evitar carregar mudanças não relacionadas do worktree dirty.
- `observability.ts` (envelope Edge): **não** obrigatório para o watchdog CLI se o import for só `alert-evaluator.ts`.

---

## 3. Opções avaliadas

### OPÇÃO A — PR separado só observabilidade/watchdog (**recomendada**)

1. Branch limpa a partir de `develop` **ou** `main` (ver §4).
2. Copiar **somente** o conjunto mínimo (acima) — sem checkout destrutivo do worktree atual; usar worktree/export seletivo quando autorizado.
3. Rodar `npm test` na branch limpa.
4. Abrir PR → base escolhida · reviewers · **sem** schedule enable · **sem** secrets.
5. Merge só com auth PO de **publish dry-run**.

| Prós | Contras |
|------|---------|
| Isola M3-003 | Exige disciplina de file set |
| Rollback fácil (reverter 1 PR) | Precisa escolher base `main` vs `develop` |
| Não bloqueia/contamina #15 | Docs canônicos podem divergir temporariamente |

**Risco transportar alterações não autorizadas:** médio se copiar do worktree dirty sem allowlist — mitigar com lista fixa + `git diff --stat` review.

### OPÇÃO B — Branch limpa do default (`main`)

Igual A com base `main`.  
**Prós:** schedule futuro e `workflow_dispatch` no default alinhados.  
**Contras:** `develop` é a linha STAGE/CD (`deploy-stage.yml`); pode exigir backport para `develop` se o time trabalha só lá.

### OPÇÃO C — Cherry-pick seletivo do branch atual

**Não executar agora.**  
Impraticável: watchdog está **untracked** (não há commits só-watchdog para cherry-pick). Exigiria commits intermediários no #15 ou stash parcial — alto risco de misturar OAuth/billing.

### OPÇÃO D — Anexar ao PR #15

**Não recomendado.** Acopla publish de watchdog ao merge OAuth lifecycle; aumenta superfície de review e atrasa/força merge indesejado.

---

## 4. Base de branch recomendada

| Destino | Quando |
|---------|--------|
| **`develop` primeiro** | Alinha com CD STAGE e hábitos do time; depois promover `develop`→`main` via processo existente (#16 pattern) **só** quando PO quiser schedule no default |
| **`main` direto** | Se o único objetivo for registrar workflow no default para dispatch/schedule futuro |

**Recomendação C0→publish dry-run:** **OPÇÃO A → base `develop`**, sem secrets, sem schedule.  
Promoção a `main` = passo separado (necessário antes de schedule útil).

---

## 5. Efeito futuro no GitHub Actions

| Evento | Efeito |
|--------|--------|
| Commit YAML em branch não-default | Arquivo versionado; schedule **não** roda |
| Merge em `main` com schedule comentado | Workflow **registrado**; dispatch manual possível; schedule **ainda off** |
| Descomentar cron em `main` | Schedule **ACTIVE** — exige auth PO **além** de C0 |
| Configurar `SUPABASE_ACCESS_TOKEN` | Habilita risco de C1 se flags network ligadas — **não** nesta fase |
| `issues: write` | Delivery — C3+ |

---

## 6. Rollback

1. Reverter PR do watchdog (revert commit).
2. Ou deletar/renomear workflows no follow-up.
3. Sem secrets = nada a rotacionar se nunca provisionados.
4. Issues: N/A até C3.

---

## 7. Certificação pós-publish (ainda BLOCKED)

Ordem: publish dry-run → C1 network RO → C2 thresholds → C3 Issues write → … (ver `GATE-B-WATCHDOG-CERTIFICATION.md`).

---

## 8. Próxima autorização PO (necessária para sair de C0 REMOTE BLOCKED)

1. Autorizar **criação de branch/PR isolado** (Opção A) **ou** equivalente.  
2. Autorizar **commit/push** do file set mínimo.  
3. Autorizar **merge** do PR watchdog (não #15).  
4. Explicitamente **não** autorizar schedule/secrets/Issues write nesse mesmo ato, salvo texto claro.

**Esta rodada C0 não executa nenhum desses passos.**
