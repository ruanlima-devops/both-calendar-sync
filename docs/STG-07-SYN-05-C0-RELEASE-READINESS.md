# STG-07 / SYN-05 — C0 Watchdog Release Readiness

**Data:** 2026-11-18  
**Escopo:** auditoria + correções **locais** apenas  
**Não autoriza:** commit · push · merge · publish remoto · schedule · Issues reais · secrets remotos

---

## A. PRECHECK

| Item | Evidência |
|------|-----------|
| Worktree | `/Users/ruan/Documents/work12` |
| Branch | `feat/m3-003-oauth-lifecycle` |
| PR #15 | OPEN · base `develop` · **não mergear** |
| Repo | `ruanlima-devops/both-calendar-sync` |
| Default branch | **`main`** (API RO) |
| Actions | habilitado (`enabled: true`) |
| Branch protection `main` | **ausente** (HTTP 404) |
| Watchdog YAML no remoto | **ausente** em `main`/`develop`/`PR#15` |
| Estado local | `LOCAL_FILE_EXISTS` · untracked/dirty |
| Opt-ins | `GITHUB_WRITE=0` · `ENABLE_NETWORK=0` · schedule comentado |
| Baseline testes | **608 PASS** / 77 files (pós C0 tests) |

Estados remotos:

| Estado | Valor |
|--------|-------|
| LOCAL_FILE_EXISTS | **SIM** |
| BRANCH_COMMITTED | **NÃO** |
| REMOTE_BRANCH_PUBLISHED | **NÃO** |
| WORKFLOW_REGISTERED | **NÃO** |
| WORKFLOW_DISPATCH_AVAILABLE | **NÃO** (arquivo não no default/remoto) |
| SCHEDULE_ACTIVE | **NÃO** |

---

## B. WATCHDOG WORKFLOW AUDIT — `both-stage-watchdog.yml`

| Campo | Valor |
|-------|-------|
| Nome | Both STAGE Watchdog (dry-run) |
| Triggers ativos | **somente** `workflow_dispatch` (sem inputs) |
| Schedule | comentado · **inativo** |
| Permissions | `contents: read` · **sem** `issues: write` |
| Runner | `ubuntu-latest` |
| Timeout | 10 min |
| Concurrency | `both-stage-watchdog-qszggrrjhcwltnmxpxcy` · `cancel-in-progress: false` |
| Env | DRY_RUN=1 · GITHUB_WRITE=0 · ENABLE_NETWORK=0 · STAGE ref fixo |
| Actions | `actions/checkout@v6` · `actions/setup-node@v7` (tag pin; SHA pin residual) |
| Steps | checkout → setup-node 24 → `npm ci` → vitest watchdog → `run.ts` dry → enforce C0 |
| Secrets | nenhum usado · nenhum hardcoded |
| Rede | desligada (flags + script) |
| Escrita | nenhuma (Issues/deploy/SQL/Stripe) |
| Sem credenciais | passa testes locais + dry-run evaluate; fail-closed se flags write/network |

**Correção C0 local:** removido input `enable_network` (era no-op confuso / bypass futuro).

Scripts alcançáveis: `npx vitest run scripts/syn05-watchdog` · `node …/run.ts`.

---

## C. SELF-WORKFLOW AUDIT — `both-stage-watchdog-self.yml`

| Campo | Valor |
|-------|-------|
| Triggers | `workflow_dispatch` only |
| Schedule | comentado |
| Permissions | `contents: read` · `actions: read` · sem issues write |
| Env | mesmos flags dry-run / STAGE |
| Steps | npm ci → self-monitor tests → enforce C0 → note |
| Notificação | nenhuma |
| Detecção remota de runs | **não implementada** nesta fase (placeholder) |

---

## D–G. INVARIANTES C0

| Invariante | Status |
|------------|--------|
| Dry-run default ON | **PASS** |
| Sem fallback write | **PASS** (`isGithubWriteEnabled` exige WRITE=1 e DRY≠1; entrypoint ainda rejeita write) |
| Schedule inativo | **PASS** |
| Sem push/PR/workflow_call/run/dispatch | **PASS** |
| Sem issues/actions/deployments/id-token write | **PASS** |
| Sem secrets embutidos | **PASS** |
| STAGE-only ref | **PASS** |
| Sem Stripe/SQL/deploy/PROD | **PASS** |
| Dispatch sem inputs bypass | **PASS** (após correção) |
| Fork/PR credentials | **PASS** (sem trigger PR) |

---

## H. GITHUB ACTIONS COMPATIBILITY

- YAML estrutura `on`/`jobs`/`steps` válida (checagens estáticas + testes).
- `npm ci` + `package-lock.json` presentes.
- Node 24 no workflow; local Node 25 OK para testes.
- Concurrency group distinto de `deploy-stage.yml` (`both-stage-deployment`).
- Sem artifacts.
- Actions tags `@v6`/`@v7` — **residual:** preferir SHA pin na publicação remota.
- `sha_pinning_required: false` no repo.

---

## I. DEFAULT BRANCH

- Default real: **`main`**.
- PR #15 → `develop` (não é default).
- **Schedule futuro** só roda no default branch (`main`) após o arquivo existir lá.
- `workflow_dispatch` futuro exige arquivo no ref selecionado.
- Proteção de branch `main`: **não configurada** — risco operacional se publish prematuro.

---

## K. SELF-MONITORING RISKS

- Outro workflow Actions **não** é independente da plataforma GitHub Actions.
- Mesmo ponto de falha: outage Actions / billing / disable org actions.
- Mecanismo externo futuro (uptime externo / heartbeat fora do GH) necessário para ausência total — **não provisionado**.
- Self remoto: **BLOCKED**.

---

## L. TESTES

Ver entrega final / `npm test`. Suite inclui `c0-release-readiness.test.ts`.

---

## M. C0 VERDICT

| Veredito | Estado |
|----------|--------|
| **C0 LOCAL** | **PASS** (após hardening local) |
| **C0 REMOTE** | **BLOCKED** |
| WATCHDOG REMOTE | **BLOCKED** |
| ALERT DELIVERY | **BLOCKED** |
| SELF-MONITORING REMOTE | **BLOCKED** |
| STG-07 | **NO-GO** |
| PROD | **NO-GO** |

C0 **não** autoriza publicação.
