# STG-07 / SYN-05 — Operational Foundations E2E

**Timestamp UTC (preflight):** 2026-11-22T03:07:49Z  
**SHA LOCK:** `0374f864b917ac1c11f3dea2f35c73dd0f5ae43a`  
**Branch:** `feat/syn-05-operational-foundations`  
**Worktree:** `/Users/ruan/Documents/work12-syn05-operational-foundations`  
**STAGE:** `qszggrrjhcwltnmxpxcy`  
**Ativação live:** **NÃO** — apenas preparação/integração segura.

---

## A. PO scope

Autorizado: fundações offline OF-01…OF-04, testes, PR/CI/merge se SAFE_SKIP, inventário STAGE read-only, certificação.

Proibido (não executado): schedule, watchdog remoto, observer remoto, delivery real, alertas externos reais, Issues write, PAT/secrets, Logs API live, workflow_dispatch, db push, functions deploy, SQL remoto, PROD, PR #15, Issues #26/#30 mutation, deploy-stage.yml.

---

## B. Preflight / full SHA

| Checagem | Resultado |
|----------|-----------|
| Repo `ruanlima-devops/both-calendar-sync` | PASS |
| `origin/develop` full SHA | `0374f864b917ac1c11f3dea2f35c73dd0f5ae43a` |
| Histórico #34 #35 #36 #37 | PASS |
| PR #15 OPEN `78979549cad61438de751584a0ad895855781b8b` | PASS |
| #26 OPEN / #30 CLOSED | PASS (read-only) |
| Schedule OFF / delivery OFF / observer OFF | PASS |
| Release gate `DEPLOY_SAFETY_ALLOW_CANDIDATE` ausente | PASS |
| SEC-07 assert | `sec07_tombstone_ok` |
| Disco ~16Gi free | PASS |
| Worktree OF criada (não destrutiva) | PASS |

**OF_PREFLIGHT:** **PASS**

---

## C. Current architecture

- Watchdog / C3-D schedule safety / C3-E independent-observer (GHA-centric transport) já em develop.
- SEC-07 tombstone source integrado (#36/#37).
- Gaps remanescentes da Activation Readiness: G01 canal alerta, G02 observer externo, G03 logs identity, G04 quota/custo, G05 canary schedule.

---

## D. External observer alternatives

| Opção | Domínio de falha | Indep. de GitHub | Custo/quotas | Notas |
|-------|------------------|------------------|--------------|-------|
| A. Uptime/heartbeat SaaS | Separado | Alta | Variável | Bom para probe HTTP; menos natural para Actions run meta |
| B. Cloud scheduler + small runtime | Separado | Alta | Controlável | **Recomendado** |
| C. Synthetic monitoring platform | Separado | Alta | Médio/alto | Overkill inicial |
| D. Second-org Actions RO | Ainda Actions | Baixa/média | Baixo | **Insuficiente** como “externo” |

---

## E. Chosen observer design

**Recomendado:** B — cloud scheduler + small observer runtime reutilizando `StatusSource` (OF-01).

Implementado offline:

- `external-observer-foundation.ts` — StatusSource, InMemory source, heartbeat evaluator, fail-closed gate.
- `authorization_gate=OFF` / `enabled=false` por default.
- `operationally_active=false` sempre nesta autorização.
- Sem HTTP no import; sem provisionamento.

**OF_EXTERNAL_OBSERVER_DESIGN:** **PASS**  
**OF_OBSERVER_OFFLINE_IMPLEMENTATION:** **PASS**  
**OF_EXTERNAL_OBSERVER_OPERATIONAL:** **NO**

---

## F. Alert channel alternatives

| Opção | Indep. Issues/GHA | Decisão |
|-------|-------------------|--------|
| Email | Média | Possível, latência/ops |
| Monitoring notify | Alta | Acopla a vendor A |
| Incident management | Alta | Bom para P0/P1 |
| Independent webhook | Alta | **Recomendado** (contrato neutro) |

**PO decision pending** para provedor concreto (contratação/conta).

---

## G. Notification payload safety

Schema `both-syn05-alert-notification:v1` com campos exigidos; proíbe PII/tokens/SQL/calendar raw/secrets; limites de tamanho; dedup/rate/cooldown/anti-storm; sink fake in-memory; env **não** ativa canal real.

**OF_ALERT_CHANNEL_DESIGN:** **PASS**  
**OF_ALERT_SINK_OFFLINE:** **PASS**  
**OF_EXTERNAL_ALERT_CHANNEL_ACTIVE:** **NO**

---

## H. Logs Read identity

Design: Management API token STAGE-only, isolado do token GitHub Issues, fail-closed ausente, rotação ≤90d, redação de erros.

**Granularidade least-privilege:** **não confirmada** oficialmente como “logs-only” → risco residual `UNKNOWN_OR_BROADER_THAN_LOGS_ONLY` documentado. Não apresentar PAT amplo como solução segura sem caveat.

**OF_LOGS_READ_IDENTITY_DESIGN:** **PASS**

---

## I. Credentials provisioned

**OF_LOGS_READ_CREDENTIAL_PROVISIONED:** **NO**  
Nenhum token criado/alterado; sem live Logs reads.

---

## J. Quota and cost model

Fórmulas:

- `runs/day = 1440 / interval_minutes`
- `runner_minutes/month = runs/day * 30 * mean_duration * retry_reserve`

Defaults: watchdog+observer 10m; mean 2m; reserve 1.25.  
Unit prices default: **UNKNOWN_PRICE** (incluindo observer externo ≠ 0 implícito).  
Budget guard: WARNING / QUOTA_EXCEEDED / HARD_STOP / COST_UNKNOWN / fail-closed.

**OF_QUOTA_POLICY:** **PASS**  
**OF_COST_MODEL:** **PASS** (com UNKNOWN_PRICE explícito)

---

## K. Canary activation plan

| Canário | Agora |
|---------|-------|
| 0 Offline validation | **executado** (testes) |
| 1 External observer RO | NOT EXECUTED |
| 2 Watchdog STAGE RO limited | NOT EXECUTED |
| 3 Delivery controlado | NOT EXECUTED |
| 4 Schedule windowed | NOT EXECUTED |
| 5 Recurring GO | NOT EXECUTED |

**OF_CANARY_PLAN:** **PASS** (paper + CANARY_0)  
**OF_WATCHDOG_READ_ONLY_CANARY / OF_SCHEDULE_CANARY:** **NOT EXECUTED**

---

## L. Implementation / files

| Arquivo | Workstream |
|---------|------------|
| `scripts/syn05-watchdog/external-observer-foundation.ts` + test | OF-01 |
| `scripts/syn05-watchdog/alert-channel.ts` + test | OF-02 |
| `scripts/syn05-watchdog/logs-read-identity.ts` + test | OF-03 |
| `scripts/syn05-watchdog/quota-cost-policy.ts` + test | OF-04 |
| `scripts/syn05-watchdog/independent-observer.ts` | ponte OF-01/02 (recomendação) |
| `docs/STG-07-SYN-05-OPERATIONAL-FOUNDATIONS-E2E.md` | relatório |

Não alterados: `supabase/functions/**`, migrations, `deploy-stage.yml`, PR #15.

---

## M. Tests and negatives

| Suite | Resultado |
|-------|-----------|
| Watchdog (+ OF) | **269 PASS** (≥217) |
| Deploy Safety | **90 PASS** |
| SEC-07 legacy | **17 PASS** |
| TypeScript | **PASS** |

**OF_OFFLINE_TESTS:** **PASS**

---

## N. Typecheck / SEC-07

**OF_TYPECHECK:** **PASS**  
**OF_SEC07_GUARD:** **PASS** (`sec07_tombstone_ok`)

---

## O. Deploy Safety

Classificação do changeset (scripts + docs):

```json
{
  "decision": "SAFE_SKIP",
  "may_skip_remote_deploy": true,
  "run_db": false,
  "run_functions": false
}
```

Assert: `safe_skip` · release gate OFF.

**OF_DEPLOY_SAFETY:** **PASS**

---

## P. PR / CI / merge

| Item | Valor |
|------|-------|
| Commit | `6ef20df96eb16a5a9e88e0bcc5e5be737073650e` |
| PR | [#38](https://github.com/ruanlima-devops/both-calendar-sync/pull/38) MERGED |
| Required checks | Application SUCCESS · Supabase SUCCESS |
| Merge SHA | `377331cbae5ff00063bb534f718ced0155e6196c` |
| Deploy STAGE | [44979699104](https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/44979699104) · **SAFE_SKIP** · Supabase STAGE **SKIPPED** |

**OF_PR_CI:** **PASS**  
**OF_MERGE:** **PASS**

---

## Q. STAGE PRE / POST

### PRE = POST (CRITICAL_IDENTICAL)

| Function | Version | verify_jwt | id |
|----------|---------|------------|-----|
| sync-calendar | 22 | true | `18eb6068-dd9d-4280-a0ba-c869deaed4aa` |
| google-oauth | 24 | false | `b7306745-2362-4039-8071-2bee88fe1b84` |
| delete-account | 15 | true | `36870d87-d6e9-453b-8c01-24740e67e0be` |
| billing-webhook | 14 | false | `a485a2e6-fdb3-43db-bb16-ec5006ccde29` |
| microsoft-oauth | 23 | false | `41df2dee-91f5-4863-bf0e-edef3610a9a0` |

TOTAL: **24** functions · deployment IDs / ezbr_sha256 críticos idênticos.

**OF_STAGE_PRE_POST:** **PASS**

---

## R. Final develop SHA

`377331cbae5ff00063bb534f718ced0155e6196c` (merge #38; tip pode avançar com docs-cert follow-up)

---

## S. PR #15 / Issues #26/#30

Preservados: #15 OPEN `78979549…`; #26 OPEN; #30 CLOSED. Sem mutação.

---

## T. Operational gaps (após esta E2E)

| Gap | Status |
|-----|--------|
| G01 canal alerta externo | Fundação offline PASS; **ativo = NO** |
| G02 observer fora do GHA | Fundação offline PASS; **operacional = NO** |
| G03 Logs Read credential | Design PASS; **provisioned = NO** |
| G04 quotas/custos calibrados | Modelo PASS; preços **UNKNOWN_PRICE** |
| G05 schedule canary live | **NOT EXECUTED** |
| SEC-07 source | Já CERTIFIED — não reaberto |

---

## U. Activation readiness verdict

**OPERATIONAL_FOUNDATIONS_IMPLEMENTATION_CERTIFIED:** **PASS**  
**READY_FOR_ACTIVATION:** **CONDITIONAL** (implementação offline certificada; ativação live **NO**)  
(observador, credencial e canal externos **não** ativados)

| Flag | Valor |
|------|-------|
| WATCHDOG_REMOTE_ENABLED | **NO** |
| ALERT_DELIVERY_CERTIFIED | **NO** |
| C3_D_SCHEDULE | **OFF** |
| SYN-05 | **NO-GO** |
| STG-07 | **NO-GO** |
| PROD | **NO-GO** |

---

## V. Next PO decision

1. Escolher provedor de observer runtime (recomendação: cloud scheduler + small runtime).  
2. Escolher provedor de alerta (recomendação: independent webhook / incident mgmt).  
3. Autorizar provisioning de Logs Read identity STAGE-only (aceitar residual granularity gap ou bloquear).  
4. Autorizar CANARY 1 (observer RO) em microgate separado — **não** implícito por este merge.  
5. Manter `DEPLOY_SAFETY_ALLOW_CANDIDATE` OFF.
