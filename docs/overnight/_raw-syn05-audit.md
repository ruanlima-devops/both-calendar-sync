## Veredito

Root auditado: `/Users/ruan/Documents/work12-overnight-sprint`. Estado conhecido **confirmado no código/docs**: watchdog/observer remotos OFF, C3-D schedule OFF, Delivery/Recovery OFF, PAT não provisionado, `COLLECTOR_SECRET_STORAGE` **BLOCKED** (só design), SYN-05 **NO-GO**.

---

## Evidência de estado (OFFLINE)

| Superfície | Evidência | Estado |
|---|---|---|
| Watchdog GHA | `.github/workflows/both-stage-watchdog.yml` — schedule comentado; `NETWORK/WRITE/DRY_RUN` forçados | remoto **NO** |
| Self-monitor | `both-stage-watchdog-self.yml` | design / OFF |
| Delivery | `both-stage-watchdog-delivery.yml` — só `OFF` | **OFF** |
| Recovery | `both-stage-watchdog-recovery.yml` — só `OFF` | **OFF** |
| CF Observer | `scripts/syn05-watchdog/observer-worker/wrangler.toml` — `crons=[]`, gate `OFF` | Worker **OFF** |
| Logs identity | `logs-read-identity.ts` → `provisioned: false`, `live_reads_authorized: false` | PAT **não emitido** |
| Deploy safety | `deploy-stage.yml` — classify + `DEPLOY_SAFETY_ALLOW_CANDIDATE` default OFF | release gate **OFF** |
| SEC-07 | `sync-calendar/index.ts` + `config.toml` `verify_jwt=true` | tombstone **presente** |
| Wrangler app web | `/Users/ruan/Documents/work12/wrangler.jsonc` | **não** é o observer (Expo web stage) |

---

## Opções comparativas: isolamento do secret do Collector  
**(sem criar environments/secrets)**

O contrato oficial de isolamento já existe em OF-03: Collector **sim**; evaluator/delivery/Issues **não**. Storage planejado: `ci_environment_secret_or_vault_future` — ainda **não aplicado**.

| # | Opção | Isolamento | Prós | Contras | Recomendação agora |
|---|---|---|---|---|---|
| **A** | **Status quo BLOCKED** — só fakes + `assertLogsReadReady` fail-closed | Máximo (zero secret) | Zero blast radius; alinhado a NO-GO | Sem canary live | **Manter** até auth PO |
| **B** | **Contrato de nome dedicado** `SUPABASE_LOGS_READ_TOKEN` (só design/código) | Alto (quando provisionar) | OF-03 já usa esse nome; CF rejeita se presente no Observer | `run.ts` ainda lê `SUPABASE_ACCESS_TOKEN` — **mismatch** | **Fazer offline** (alinhamento) |
| **C** | **Reusar** `SUPABASE_ACCESS_TOKEN` do deploy (`environment: staging`) | Fraco | Zero setup novo | Mistura deploy CLI + Logs Read; viola least privilege | **Rejeitar** |
| **D** | **Isolamento lógico por workflow** (YAML: collector job referencia secret; delivery/observer/CF proíbem `SUPABASE_*`) | Médio–alto | Já parcialmente codificado (CF `supabase_pat_forbidden_on_observer`; delivery sem secrets) | Sem secret criado = só paper+testes | **Preparar**; não provisionar |
| **E** | **Ephemeral local** (C3-A.1): token só em shell/sessão, nunca GH | Alto (temporário) | Docs C3-A.0.1 apontam isso | Ainda exige emitir PAT | Só com auth PO live |
| **F** | **Vault externo futuro** (1Password/Doppler) | Alto | `LOGS_READ_IDENTITY_DESIGN.storage` já prevê | Cria superfície nova | Deferir |
| **G** | **OIDC / machine identity** Management API | Ideal | Evita PAT user-bound | Não disponível no desenho atual; residual user-bound PAT documentado | **Indisponível** |

**Ranking offline (sem criar nada):** A (manter BLOCKED) → B+D (alinhar contrato + asserts YAML/código) → E (só depois) → F → rejeitar C → G N/A.

**Gap crítico de isolamento:** GitHub App (observer) **PASS** como identidade separada; Collector precisa de PAT **distinto** e **nunca** no Worker (`cloudflare-scheduled-adapter.ts` rejeita `SUPABASE_ACCESS_TOKEN` / `SUPABASE_LOGS_READ_TOKEN`). Better Stack fica no observer (heartbeat), não no Collector.

---

## Deploy-safety: comandos local-safe

Rodar em `work12-overnight-sprint` (ou work12 se tiver o mesmo `scripts/deploy-safety/`):

```bash
# Suite C0.5 (sem rede / sem Supabase)
npx vitest run --config scripts/deploy-safety/vitest.config.ts

# SEC-07 tombstone assert (local FS)
node --experimental-strip-types scripts/deploy-safety/classify-deploy-changes.ts --sec07-check .

# Classificar paths sintéticos (SAFE_SKIP esperado)
printf '%s\n' 'scripts/syn05-watchdog/run.ts' 'docs/STG-07-SYN-05-C0-5-DEPLOY-SAFETY-INTEGRATION.md' > /tmp/syn05-paths.txt
node --experimental-strip-types scripts/deploy-safety/classify-deploy-changes.ts /tmp/syn05-paths.txt > /tmp/classify.json
GITHUB_OUTPUT=/tmp/gh-out.txt node --experimental-strip-types scripts/deploy-safety/assert-deploy-decision.ts /tmp/classify.json

# SEC-07 legacy unit + OF-03 identity (offline)
npx vitest run supabase/functions/_shared/sync/sync-calendar-legacy.test.ts
npx vitest run scripts/syn05-watchdog/logs-read-identity.test.ts

# Dry-run watchdog (NETWORK=0 implícito no workflow; não setar ENABLE_NETWORK=1)
BOTH_WATCHDOG_DRY_RUN=1 BOTH_WATCHDOG_GITHUB_WRITE=0 BOTH_WATCHDOG_ENABLE_NETWORK=0 \
  node --experimental-strip-types scripts/syn05-watchdog/run.ts
```

**Não local-safe / não executar agora:** `workflow_dispatch` em `deploy-stage.yml`, `DEPLOY_SAFETY_ALLOW_CANDIDATE=1`, `supabase` CLI deploy, criação de secrets/envs, Cron CF, Better Stack live.

**c0-4:** `/Users/ruan/Documents/work12/c0-4-deploy-safety/` é precursor **local-only**; C0.5 em `scripts/deploy-safety/` o supersede (SEC-07 + release gate + SHAs pinados). Preferir C0.5.

---

## Recomendações acionáveis (só OFFLINE)

1. **Manter `COLLECTOR_SECRET_STORAGE = BLOCKED`** — não criar GH Environment/secret até gate PO explícito (C3-A.1 / collector storage).
2. **Alinhar contrato B offline:** `run.ts` usa `SUPABASE_ACCESS_TOKEN`; OF-03 documenta `SUPABASE_LOGS_READ_TOKEN` — corrigir/ler o nome dedicado **antes** de qualquer provisionamento (evita opção C por acidente).
3. **Preservar barreira Observer:** nunca colocar PAT Supabase no Worker; GitHub App + Better Stack ficam no CF; Collector fica só no GHA.
4. **Rodar a bateria deploy-safety + SEC-07** acima em toda mudança SYN-05 (changeset deve continuar `SAFE_SKIP`).
5. **Não mergear** mudanças que toquem `deploy-stage.yml` / functions / migrations sem Gate D; bootstrap ainda `BOOTSTRAP_REVIEW`.
6. Próximo PO (quando autorizado): emitir PAT scoped `analytics_logs_read` STAGE-only → secret **Actions dedicado ao job Collector** → canary NETWORK=1 supervisionado; schedule/delivery/observer Cron continuam OFF.

---

## Índice de ficheiros

- Workflows: `/Users/ruan/Documents/work12-overnight-sprint/.github/workflows/{deploy-stage,both-stage-watchdog,both-stage-watchdog-self,both-stage-watchdog-delivery,both-stage-watchdog-recovery,ci}.yml`
- Collector / identity: `.../scripts/syn05-watchdog/{collector,logs-read-identity,run,cloudflare-scheduled-adapter}.ts`
- CF inert: `.../scripts/syn05-watchdog/observer-worker/wrangler.toml`
- Deploy-safety: `.../scripts/deploy-safety/{classify-deploy-changes,assert-deploy-decision,list-changed-paths,*}.ts`
- c0-4 legado: `/Users/ruan/Documents/work12/c0-4-deploy-safety/`
- SEC-07: `.../supabase/functions/sync-calendar/index.ts`, `.../_shared/sync/sync-calendar-legacy.ts`, `.../supabase/config.toml`
- Docs: `docs/STG-07-SYN-05-{GATE-B-WATCHDOG-SECURITY,C0-5-DEPLOY-SAFETY-INTEGRATION,C3-A0-1-LOG-READER-HARDENING,C3-B41-DELIVERY-ISOLATION,OPERATIONAL-FOUNDATIONS-E2E,INERT-INFRASTRUCTURE-PROVISIONING-E2E}.md`
- Identidade PAT (evidência externa): `/Users/ruan/Documents/work12-syn05-external-observer-readiness/docs/STG-07-SYN-05-SUPABASE-LOGS-READ-IDENTITY.md`