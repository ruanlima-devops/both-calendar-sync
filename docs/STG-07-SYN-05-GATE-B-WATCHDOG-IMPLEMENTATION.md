# STG-07 / SYN-05 — GATE B Watchdog Implementation (LOCAL)

**Data:** 2026-11-18  
**Escopo:** preparação e implementação **local** apenas  
**Canal:** GitHub Issues (mocks; sem escrita remota)  
**STAGE:** `qszggrrjhcwltnmxpxcy`  
**Veredito:** **WATCHDOG LOCAL PASS** · **C0 LOCAL PASS** · **C0 REMOTE BLOCKED** · **WATCHDOG REMOTE BLOCKED** · **ALERT DELIVERY BLOCKED** · **SELF-MONITORING REMOTE BLOCKED**  
**C0:** `docs/STG-07-SYN-05-C0-RELEASE-READINESS.md` · plano publish `…-C0-PUBLICATION-PLAN.md`

---

## 1. Diagrama de execução (local)

```
[schedule / dispatch] ──► both-stage-watchdog.yml (LOCAL FILE; schedule commented)
        │
        ▼
 runWatchdogOnce (dry-run default)
        │
        ├─► SupabaseLogsClient (RO) ──► normalize* ──┐
        │     (network OFF unless BOTH_WATCHDOG_ENABLE_NETWORK=1) │
        └─► injectedSignals (tests / dry fixtures) ───┤
                                                      ▼
                                              evaluateAll → ALERT-01/02/03
                                                      │
                                                      ▼
                                         reconcileIncidents ↔ GithubIssuesPort
                                                      │
                              DryRunGithubIssues / MemoryGithubIssues (local)
                                                      │
                              Real Issues write: OPT-IN + PO C3 (not this phase)
```

Self-monitor (independente):

```
both-stage-watchdog-self.yml (arquivo separado; schedule comentado)
        │
        ▼
 evaluateWatchdogHeartbeat(last_success_at, interval+grace)
        │
        └──► ALERT-SELF (FIRING|HEALTHY) — delivery remota BLOCKED
```

**Nota:** segundo job no **mesmo** workflow ≠ independência suficiente.

---

## 2. Componentes

| Módulo | Path | Papel |
|--------|------|-------|
| Logs client | `scripts/syn05-watchdog/supabase-logs-client.ts` | GET Management API logs; host allowlist; STAGE ref; 429/backoff; truncado fail-closed |
| Normalizer | `scripts/syn05-watchdog/normalize.ts` | edge / console JSON / pg_cron |
| Evaluator bridge | `scripts/syn05-watchdog/evaluation.ts` | Reusa `observability/alert-evaluator.ts` |
| Issues port | `scripts/syn05-watchdog/github-issues.ts` | Interface + Memory + DryRun |
| Reconciler | `scripts/syn05-watchdog/reconcile.ts` | create/update/resolve; no close em UNKNOWN/DATA_UNAVAILABLE |
| Self-monitor | `scripts/syn05-watchdog/self-monitor.ts` | Heartbeat age vs interval+grace |
| Entrypoint | `scripts/syn05-watchdog/run.ts` | Dry-run default; write forbidden nesta fase |
| Workflows | `.github/workflows/both-stage-watchdog.yml` (+ `-self.yml`) | Locais; schedule comentado |

---

## 3. Contrato Logs API

- **Host:** `https://api.supabase.com` (allowlist estrita; `redirect: 'error'`).
- **Path:** `/v1/projects/{project_ref}/analytics/endpoints/logs`.
- **Query:** `iso_timestamp_start`, `iso_timestamp_end`, `sql`.
- **SQL shape (documentada/inspecionada na prep):**  
  `select timestamp, event_message, source from logs where source = '<source>' … order by timestamp desc limit N`
- **Sources:** `function_edge_logs`, `function_logs`, `postgres_logs`.
- **Paginação:** cursor **não** documentado → página única; se `rows.length >= limit` → `truncated: true` → recovery HEALTHY vira `UNKNOWN` (fail-closed).
- **Overlap:** `computeQueryWindow(windowMs + overlapMs)` para reduzir buracos.
- **Auth:** Bearer Management token (mínimo `analytics_logs_read` quando provisionado). **Não** usar `service_role` de app.
- **429:** honra `Retry-After`; backoff exponencial + jitter ≤15s; max retries configurável.
- **401/403/5xx/timeout/invalid payload:** `ok: false` → avaliações `DATA_UNAVAILABLE` (nunca HEALTHY).

---

## 4. Alertas (hipóteses — calibração futura)

| ID | Sinal | Threshold preliminar | Notas |
|----|-------|----------------------|-------|
| ALERT-01 | edge 5xx / função | ≥3 / 15m | Ignora 401/403/404/410 |
| ALERT-02 | último `reconcile-sync` 200 | age > 15m + 10m grace | Zero jobs ≠ miss |
| ALERT-03 | billing processing fail | ≥3 / 15m | Isola `invalid_signature`; ignora skipped/deleted |

Estados: `HEALTHY` · `FIRING` · `UNKNOWN` · `DATA_UNAVAILABLE` · `RECOVERING` · `RESOLVED`.

Fingerprint: `ALERT-XX|qszggrrjhcwltnmxpxcy|<dedupe_key>`.

---

## 5. Issues / dedupe / recovery

- Label `both-watchdog` + marker `<!-- both-syn05-watchdog -->` + `both-syn05-fp:<fingerprint>`.
- Um incidente aberto por fingerprint; update em vez de create.
- Recovery: **2** avaliações `HEALTHY` consecutivas com evidência positiva.
- **Não** fechar em `UNKNOWN` / `DATA_UNAVAILABLE` / janela truncada.
- Issues humanas sem marker/label → recusa.
- Dry-run **default** (`BOTH_WATCHDOG_DRY_RUN≠0`).
- Write real exige `BOTH_WATCHDOG_GITHUB_WRITE=1` **e** dry-run off — **bloqueado** no entrypoint Gate B local.
- Concorrência: workflow `concurrency.group` por STAGE; busca+create **não** atômica — mitigações: group + reconciliação; limitação documentada sob corrida externa.

---

## 6. Workflow local

Arquivo: `.github/workflows/both-stage-watchdog.yml`

- `schedule` **comentado**.
- `workflow_dispatch` **sem inputs** (C0 removeu `enable_network`).
- `permissions: contents: read` apenas (sem `issues: write`).
- Env: `BOTH_WATCHDOG_DRY_RUN=1`, `GITHUB_WRITE=0`, `ENABLE_NETWORK=0`.
- Sem deploy / SQL / Stripe / secrets embutidos.
- Self: `.github/workflows/both-stage-watchdog-self.yml` (arquivo separado).
- Step `Enforce C0 safety invariants` fail-closed se flags divergirem.

**C0 LOCAL PASS ≠ publish.** Publicação remota permanece **BLOCKED** até auth PO + plano isolado do PR #15.

---

## 7. Opt-ins destrutivos (confirmados OFF)

| Flag | Estado nesta fase |
|------|-------------------|
| `BOTH_WATCHDOG_GITHUB_WRITE` | `0` / unset |
| `BOTH_WATCHDOG_ENABLE_NETWORK` | `0` / unset |
| Schedule remoto | comentado |
| Polling contínuo local | ausente |

---

## 8. Testes

`scripts/syn05-watchdog/**/*.test.ts` incluídos em `vitest.config.ts`.  
Cobertura: client (200/vazio/429/401/5xx/timeout/truncado/overlap/dedupe), evaluator, reconcile/recovery/human refuse/sanitize, self-monitor, YAML dry-run, run dry-run + refuse write.

---

## 9. Limitações

- Sem paginação cursor → truncamento fail-closed.
- Race externa Issues (sem lock distribuído).
- Self-monitor remoto não provisionado.
- Custos Actions/API **não confirmados**.
- Thresholds = hipóteses (sem baseline PROD).
