# STG-07 / SYN-05 — Inert Infrastructure Provisioning E2E

**Preflight UTC:** 2026-11-22T03:49:49Z  
**SHA LOCK:** `3654e04e9f8b22dcabb678d43baa2b93f8efc85b`  
**Implementation merge:** PR [#40](https://github.com/ruanlima-devops/both-calendar-sync/pull/40) → `99e71b745fc59f97dd97efce8f7d5cf8fe2f0e9d`  
**Worktree:** `/Users/ruan/Documents/work12-syn05-inert-infrastructure`

---

## A. Product Owner authorization

Adapters + SAFE_SKIP merge + provisionamento **inerte** autorizado. Cron/watchdog/observer operacional/alerts/Issues/Logs live/deploy Supabase **proibidos**.

## B. Initial preflight

**PASS** — SHA lock, PR #15 OPEN `78979549…`, #26 OPEN/#30 CLOSED, release gate OFF, SEC-07 ok, STAGE 24/v22.

## C. Develop SHA

Lock: `3654e04e9f8b22dcabb678d43baa2b93f8efc85b`  
Pós-merge tip (implementation): `99e71b745fc59f97dd97efce8f7d5cf8fe2f0e9d`

## D. Worktree / branch

`feat/syn-05-inert-infrastructure` → merge #40.

## E. Code changes

| Path | Role |
|------|------|
| `github-app-jwt.ts` (+test) | RS256 Web Crypto PKCS#8 |
| `cloudflare-scheduled-adapter.ts` (+test) | `scheduled`/`fetch` inert |
| `observer-worker/wrangler.toml` | `crons=[]`, `workers_dev=false`, gate OFF |

## F–G. Cloudflare adapter / Web Crypto

Fail-closed gate OFF; Supabase PAT rejected on observer env; host pin `api.github.com`; no heartbeat send; JWT PKCS#8 only.

## H. Offline tests

Watchdog **298 PASS** · Deploy Safety **90** · SEC-07 **17** · adapters **29**

## I. TypeScript / SEC-07

PASS / `sec07_tombstone_ok`

## J. Deploy Safety

**SAFE_SKIP** · `run_db=false` · `run_functions=false`

## K. PR / CI / merge

| Item | Value |
|------|-------|
| PR | [#40](https://github.com/ruanlima-devops/both-calendar-sync/pull/40) MERGED |
| Commit | `a22f5f6df2d757d010bd638f2abf91ed31f22ed8` |
| Checks | Application SUCCESS · Supabase SUCCESS |
| Deploy STAGE | [44982727225](https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/44982727225) SAFE_SKIP · Supabase STAGE **SKIPPED** |

**IIP_PR_CI_MERGE:** **PASS**

## L. STAGE PRE/POST

24 functions · sync-calendar v22 jwt=true · critical IDs identical · **PASS**

## M. GitHub App provisioning

**NOT_PROVISIONED**

Motivo: criação exige sessão interativa no GitHub Settings (browser IDE sem login; Computer Use sem Accessibility/Screen Recording; `gh` user token não cria App via API REST sem manifest flow autenticado).  
Sem PAT GitHub fallback (proibido).

## N. Cloudflare resource

**PASS (inert)**

| Field | Value |
|-------|-------|
| Account | `61b030810fd93e4f3ca35bebd756ccb8` (pre-existing Wrangler OAuth) |
| Worker | `both-stage-syn05-observer` |
| Version ID | `780ea259-fcad-4f92-a5a9-b42264eb665d` |
| Schedules | **`[]`** (API confirmed) |
| Routes | **null** |
| workers_dev | **false** (config) · “No targets deployed” |
| Bindings | `OBSERVER_AUTHORIZATION_GATE=OFF`, `EXPECTED_REPO=…` |
| Secrets | **none** stored (no GH App key / BS URL) |
| Bundle | ~20 KiB / gzip ~4.7 KiB · startup 1 ms |
| Invocations | none expected (no cron, no routes) |

**Nenhuma cobrança CF Paid nova iniciada nesta sessão.** Conta já tinha Workers (`usage_model=standard` / Workers Builds pré-existente). Custo incremental de invocação ≈ **US$ 0**.

## O. Better Stack heartbeat

**NOT_PROVISIONED**

Sem token/API/sessão Better Stack disponível de forma não interativa. Plano Free não verificado em conta real nesta sessão (REQUIRES_ACCOUNT_VERIFICATION).

## P. Supabase scoped PAT

**NOT_PROVISIONED**

Sem criação de PAT (exigiria Dashboard autenticado). **Nenhuma** chamada Logs API. Isolamento Collector sem secret GitHub confiável permanece gap (documentado em OF-03).

## Q. IAM / secrets isolation

| Secret | Status |
|--------|--------|
| GitHub App private key | N/A (App não criado) |
| Better Stack URL | N/A |
| Supabase Logs PAT | N/A |
| CF Worker secrets | empty |

## R. Financial controls

| Item | Status |
|------|--------|
| Teto US$ 5/mo | Respeitado: **sem novo serviço pago** |
| CF Paid upgrade | **Não contratado** |
| Better Stack paid | **Não** |
| **IIP_FINANCIAL_GATE** | **PASS** |

## S. No-activation proof

- Cron schedules API: empty  
- Gate OFF  
- Deploy STAGE SKIPPED  
- Watchdog/delivery/observer workflows não executados por este merge  
- Issues criadas: **0**  
- Logs API: not called  

**IIP_NO_REMOTE_ACTIVATION:** **PASS**

## T. Issues / PR preservation

PR #15 OPEN intacto · #26 OPEN · #30 CLOSED

## U. Final gates

| Gate | Status |
|------|--------|
| IIP_PREFLIGHT | **PASS** |
| IIP_ADAPTER_IMPLEMENTATION | **PASS** |
| IIP_WEBCRYPTO | **PASS** |
| IIP_OFFLINE_TESTS | **PASS** |
| IIP_TYPECHECK | **PASS** |
| IIP_SEC07 | **PASS** |
| IIP_DEPLOY_SAFETY | **PASS** |
| IIP_PR_CI_MERGE | **PASS** |
| IIP_STAGE_PRE_POST | **PASS** |
| IIP_GITHUB_APP_RO | **NOT_PROVISIONED** |
| IIP_CLOUDFLARE_INERT | **PASS** |
| IIP_BETTER_STACK_PAUSED | **NOT_PROVISIONED** |
| IIP_SUPABASE_PAT_SCOPED | **NOT_PROVISIONED** |
| IIP_FINANCIAL_GATE | **PASS** |
| IIP_NO_REMOTE_ACTIVATION | **PASS** |
| **IMPLEMENTATION_CERTIFIED** | **PASS** |
| **INERT_INFRASTRUCTURE_PROVISIONING_CERTIFIED** | **NO** (faltam App/BS/PAT) |
| WATCHDOG_REMOTE_ENABLED | **NO** |
| C3_D_SCHEDULE | **OFF** |
| EXTERNAL_OBSERVER_OPERATIONALLY_CERTIFIED | **NO** |
| ALERT_DELIVERY_CERTIFIED | **NO** |
| SYN-05 / STG-07 / PROD | **NO-GO** |

## V. Residual risks

1. Conta Cloudflare pré-existente em modelo `standard` — billing histórico fora do escopo; Worker inerte não gera Cron.  
2. Sem GitHub App, o Worker não pode autenticar Actions reads mesmo se Cron fosse ligado (ainda OFF).  
3. Computer Use / browser sem sessão impediram provisionamento interativo.  
4. Isolamento de PAT no GitHub Actions ainda sem secret dedicado ao Collector.

## W. Next PO decision

1. Autorizar sessão interativa (ou tokens de provisionamento read/write limitados) para: GitHub App RO, Better Stack Free paused heartbeat, Supabase scoped Logs Read PAT.  
2. Opcional: confirmar spend limit Cloudflare no dashboard.  
3. Manter Cron OFF até canário autorizado.
