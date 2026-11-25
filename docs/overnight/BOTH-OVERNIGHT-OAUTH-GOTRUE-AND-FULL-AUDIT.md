# BOTH — Overnight Sprint: GoTrue Recovery + OAuth E2E + Full Audit

**UTC start:** 2026-11-25T05:19:42Z  
**UTC close (final independent audit):** 2026-11-25T05:35:13Z  
**Repo:** `ruanlima-devops/both-calendar-sync`  
**PR:** [#50](https://github.com/ruanlima-devops/both-calendar-sync/pull/50) DRAFT  
**Branch:** `feat/m3-003-oauth-lifecycle-reconciled`  
**Worktree:** `/Users/ruan/Documents/work12-m3-003-oauth-reconciliation`  
**HEAD final:** `9d7d718da6baf711382166838d78a15e43dc881d` (alinhamento docs; se houver commit posterior só de stamp, usar `git rev-parse HEAD`)  
**Functional commit (GoTrue E2E):** `22a23c57a66a2e9cc37d65428b8389e95f952085`  
**develop:** `383adb8b902a40f8ecfd30c7e9acfafd49b7ab34`

**No merge · No remote deploy · No live Google/Microsoft · No PROD**

---

## 01. Resumo executivo

Docker Desktop estava **quebrado** (API 500 / hang) por **pressão de disco** (`/System/Volumes/Data` ~97–99% cheio; `Docker.raw` 228 Gi). Em vez de `prune` global, recuperamos Auth com **GoTrue nativo v2.198.0** + PostgreSQL Homebrew + JWT real via `/user`.

Resultado (revalidado na auditoria final): OAuth Lifecycle E2E local com **GoTrue real + Postgres real + mocks Google/Microsoft + Playwright** = **27 PASS**. Vitest default **750 PASS**, Typecheck PASS, Deploy Safety suite **109 PASS**, SEC-07 **17 PASS** (`sec07_tombstone_ok`). Deploy Safety classificação do diff PR #50: **UNKNOWN_BLOCKED** (honesto). CI Application+Supabase **PASS** no HEAD. PR #50 permanece Draft.

**M3_003_LOCAL_E2E_CERTIFIED=PASS** (GoTrue real local + JWT + Postgres + CSRF + Playwright mocks).  
**MERGE / REMOTE DEPLOY / LIVE OAUTH / RELEASE_READY = NO.**

---

## 02. Estado inicial

| Item | Valor |
|---|---|
| HEAD pré-sprint | `d156faa86ac8f98fde6f4a43949f119d9cfdf151` |
| develop | `383adb8b902a40f8ecfd30c7e9acfafd49b7ab34` |
| GoTrue | BLOCKED (Docker I/O) |
| PG OAuth | 14 PASS histórico |
| Playwright mocks | 6 PASS histórico |
| Deploy Safety | UNKNOWN_BLOCKED |
| CI anterior | https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45477255439 |

---

## 03–05. Docker / causa raiz / recuperação

### Sintomas
- `docker version` server: **500 Internal Server Error** / hang no socket Desktop
- `supabase start` histórico: `meta.db` / overlayfs **input/output error**

### Evidências host (revalidadas)
```
/System/Volumes/Data  228Gi  179Gi  ~5.7Gi  97%
Docker.raw            ~228G (pressão histórica)
```

### Classificação
**HOST_STORAGE + DOCKER_ENGINE** — disco saturado; daemon incapaz de operar o store de forma confiável.

### Recuperação executada (sem prune global)
1. Não executar `docker system prune --volumes`.
2. Estratégia B: GoTrue binário oficial `auth-v2.198.0-darwin-arm64`.
3. DB descartável `both_gotrue_local` + role `postgres` (exigido pelas migrations).
4. `scripts/oauth-local/start-gotrue.sh` + `.env.gotrue` (chmod 600, gitignored).
5. GoTrue API: `http://127.0.0.1:9999` — health 200, migrations aplicadas.

**OVERNIGHT_DOCKER_ROOT_CAUSE=CONFIRMED**  
**OVERNIGHT_GOTRUE_RECOVERY=PASS**

---

## 06–08. GoTrue / Postgres / isolamento

| Serviço | Destino | Isolamento |
|---|---|---|
| GoTrue | 127.0.0.1:9999 | loopback only |
| Auth DB | `both_gotrue_local` @ 127.0.0.1 | descartável |
| OAuth DB | `both_oauth_local_e2e` @ 127.0.0.1 | descartável |
| JWT secret | local file `.env.gotrue` | não commitado |
| STAGE/PROD | não linkado | `localPgUrl()` recusa supabase.co |

Shim OAuth exige **JWT real** (`Bearer` com 3 segmentos) e valida via GoTrue `GET /user` — UUID cru → **401**.

Auditoria final: GoTrue health OK após restart; `test:oauth-local` **27/27 PASS**.

---

## 09–14. Testes (executados nesta sprint + revalidados)

### Harness `npm run test:oauth-local` → **27 PASS** (3 files)
- Postgres integration: **14** (state/ticket/TTL/A–G/concorrência)
- GoTrue integration: **6** (signup/login/JWT/refresh/malformed)
- Playwright Chromium: **7** (Google/MS JWT, deny, 401, Attack A, replay, reject raw UUID)

### Default `npm test` → **750 PASS** / 70 files  
### Deploy Safety unit → **109 PASS** / 4 files  
### SEC-07 legacy → **17 PASS**  
### Typecheck → **PASS**  

### Não executados (por política / escopo)
- Google/Microsoft OAuth **live**
- Stripe live / billing backend PR #46
- Sync provider live / SYN-05
- `supabase start` Docker completo
- Deploy STAGE / PROD

### Regressões produto (unit/default suite)
Auth Web / Onboarding / Calendar / Paywall / Billing client / Sync Core (incl. SEC-07): cobertos no Vitest 750 — **PASS**.

---

## 15–17. Segurança / correções / commits

### Invariantes revalidados com GoTrue JWT
- Callback sem vínculo
- Ticket single-use + concurrent ≤1
- Cross-user finalize 403
- Finalize sem JWT 401
- Provider/browser/user binding

### Correções desta noite
1. Diagnóstico disco/Docker (HOST_STORAGE).
2. Stack GoTrue nativa + start script.
3. Shim JWT via `/user` (fim do Bearer-UUID).
4. Testes GoTrue + Playwright atualizados.
5. `.tools/` e `.env.gotrue` no `.gitignore`.

### Commits
| SHA | Mensagem |
|---|---|
| `9d7d718` / `dd4ca1d` | stamps de auditoria overnight + CI URLs |
| `22a23c5` | `test(m3): recover GoTrue locally and certify OAuth JWT E2E` |
| `d156faa` | `test(m3): local Postgres + Playwright OAuth lifecycle validation` (pré-sprint) |
| `6c8fccd` | `docs(m3): certify OAuth lifecycle reconciliation onto develop post-#45` (pré-sprint) |

---

## 18–19. Deploy Safety / Release

**Classification (origin/develop...HEAD):** `UNKNOWN_BLOCKED`  
**Reasons:** unclassified_paths — `.gitignore`, `app/oauth.tsx`, `context/session.tsx`, e2e oauth, lib oauth/auth, package.json/lock, scripts/oauth-local/*

**Matched:**
- migrations: `20261001000001_oauth_completion_ticket.sql`
- functions: google-oauth, microsoft-oauth, disconnect-calendar + `_shared/oauth*`
- safe_skip parcial: docs overnight, alguns app calendars, tsconfig/vitest

**Release artifacts (futuro STAGE — NÃO EXECUTAR):**
1. Migration `20261001000001_oauth_completion_ticket.sql`
2. Functions: `google-oauth`, `microsoft-oauth`, `disconnect-calendar` (+ `_shared/oauth*`)
3. Frontend OAuth/client (`app/oauth.tsx`, `lib/oauth*.ts`, session/routing)
4. Redirect URI / secrets review (PO)
5. Canary + live A–G (PO)

**RELEASE_MANIFEST=CONDITIONAL** — código local certificado; remote depende de PO + release gate + path recovery Deploy Safety.

---

## 20–25. PR #50 / CI / preservação

| Item | Status |
|---|---|
| PR #50 | OPEN + **DRAFT** — https://github.com/ruanlima-devops/both-calendar-sync/pull/50 |
| HEAD | `9d7d718da6baf711382166838d78a15e43dc881d` (+ commit docs de alinhamento se aplicável) |
| CI run (docs stamp) | https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45554371611 (`dd4ca1d`) |
| CI run (GoTrue E2E) | https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45553660768 (`22a23c5`) |
| CI run (HEAD align) | https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45554693418 (`9d7d718`) |
| Application | **SUCCESS** (required) |
| Supabase | **SUCCESS** (required) |
| Workers Builds stage | **FAILURE** (não-required; sem deploy autorizado / Cloudflare stage) |
| Supabase Preview | SKIPPED |
| PR #15 | HEAD `78979549…` OPEN — **intacto** |
| PR #46 | HEAD `822bcc28…` DRAFT — **intacto** |
| #26 | OPEN — intacto |
| #30 | CLOSED — intacto |
| Branch protection required | `Application`, `Supabase` |
| Release gate | OFF |
| SYN-05 / STG-07 / PROD / BETA | NO-GO |
| NO_REMOTE_DEPLOY | PASS |

**PR50_CI=PASS** (required checks). Workers Builds failure **não** altera certificação Application/Supabase; **não** implica release.

---

## 26–30. Auditoria final independente (HEAD `9d7d718` / funcional `22a23c5`)

Reexecutado a partir do HEAD funcional e revalidado após stamp de docs (não apenas relatório anterior):

| Check | Evidência | Resultado |
|---|---|---|
| Git clean / tracking | branch sync com origin pós-`9d7d718` | PASS |
| GoTrue real | health + 6 testes integração | PASS |
| OAuth local harness | 27/27 | PASS |
| Vitest full | 750/750 | PASS |
| Typecheck | `tsc --noEmit` | PASS |
| Deploy Safety suite | 109/109 | PASS |
| DS classification | UNKNOWN_BLOCKED | PASS (honesto) |
| SEC-07 | 17/17 + config verify_jwt=true sync-calendar | PASS |
| PR Draft | isDraft=true | PASS |
| #15/#46/#26/#30 | inalterados | PASS |
| CI required | Application+Supabase success | PASS |
| Docker Desktop | ainda instável / disco 97% | BLOCKED (infra) |
| Live OAuth | não executado | NOT_VERIFIED / NO |
| STAGE deploy | não executado | NO |

**FINAL_INDEPENDENT_AUDIT=PASS** (escopo local + CI required + preservação). Infra Docker Desktop permanece BLOCKED para `supabase start`.

---

## 31–34. Gates / bloqueios / decisões

```
OVERNIGHT_PREFLIGHT=PASS
OVERNIGHT_DOCKER_DIAGNOSIS=PASS
OVERNIGHT_DOCKER_ROOT_CAUSE=CONFIRMED
OVERNIGHT_GOTRUE_RECOVERY=PASS
OVERNIGHT_LOCAL_ENV_SECURITY=PASS

OAUTH_POSTGRES_REAL=PASS
OAUTH_GOTRUE_REAL_LOCAL=PASS
OAUTH_JWT_AUTHENTICATION=PASS
OAUTH_STATE_SECURITY=PASS
OAUTH_NONCE_SECURITY=PASS
OAUTH_TICKET_SINGLE_USE=PASS
OAUTH_TICKET_ATOMICITY=PASS
OAUTH_CSRF_A_G=PASS
OAUTH_CONCURRENCY=PASS
OAUTH_CROSS_USER_ISOLATION=PASS

GOOGLE_MOCK_E2E=PASS
MICROSOFT_MOCK_E2E=PASS
PLAYWRIGHT_E2E=PASS

AUTH_WEB_REGRESSION=PASS
ONBOARDING_REGRESSION=PASS
CALENDAR_UX_REGRESSION=PASS
PAYWALL_REGRESSION=PASS
BILLING_OFFLINE_REGRESSION=PASS
SYNC_CORE_REGRESSION=PASS

VITEST_FULL=PASS
TYPECHECK=PASS
SEC07=PASS
DEPLOY_SAFETY_SUITE=PASS
DEPLOY_SAFETY_CLASSIFICATION=UNKNOWN_BLOCKED

OAUTH_SECURITY_REVIEW=PASS
PR50_PUSH_GATE=PASS
PR50_CI=PASS
PR50_DRAFT_PRESERVED=PASS
PR15_PRESERVED=PASS
PR46_PRESERVED=PASS
ISSUES_PRESERVED=PASS

RELEASE_MANIFEST=CONDITIONAL
FINAL_INDEPENDENT_AUDIT=PASS
NO_REMOTE_DEPLOY=PASS

M3_003_LOCAL_E2E_CERTIFIED=PASS
M3_003_MERGE_AUTHORIZED=NO
M3_003_REMOTE_DEPLOY_AUTHORIZED=NO
M3_003_OAUTH_LIVE_CERTIFIED=NO
M3_003_RELEASE_READY=NO
SYN05=NO-GO
STG07=NO-GO
PROD=NO-GO
BETA=NO-GO
```

### Bloqueios remanescentes
1. Disco host ~5.7 Gi livres (Data 97%) — Docker Desktop ainda NO-GO até liberar espaço de forma segura.
2. UNKNOWN_BLOCKED até recovery de classificação OAuth client (PO / PR Deploy Safety separado — sem afrouxar functions/migrations).
3. STAGE deploy / live OAuth / release gate — não autorizados.
4. Workers Builds stage FAILURE no PR (não-required) — investigar só se/quando Cloudflare stage for autorizado.
5. Playwright não dirige Expo Router UI completa (shim+mocks locais).

### Próxima execução PO
1. Liberar espaço em disco / reparar Docker Desktop (opcional para `supabase start` completo).  
2. PR de Deploy Safety path recovery para OAuth client (sem afrouxar functions/migrations).  
3. Autorizar STAGE migration+functions sob release gate.  
4. Canário OAuth live supervisionado (A–G).  
5. Só então: undraft/merge candidatos com gates explícitos.

---

## Comandos reproduzíveis

```bash
cd /Users/ruan/Documents/work12-m3-003-oauth-reconciliation
./scripts/oauth-local/start-gotrue.sh
export OAUTH_LOCAL_DATABASE_URL=postgresql://$USER@127.0.0.1:5432/both_oauth_local_e2e
export GOTRUE_URL=http://127.0.0.1:9999
npm run test:oauth-local
npm test
npm run typecheck
npx vitest run --config scripts/deploy-safety/vitest.config.ts
npx vitest run supabase/functions/_shared/sync/sync-calendar-legacy.test.ts
git diff --name-only origin/develop...HEAD | node --experimental-strip-types -e \
  'import {classifyDeployChanges} from "./scripts/deploy-safety/classify-deploy-changes.ts";
   import {readFileSync} from "fs";
   console.log(JSON.stringify(classifyDeployChanges(readFileSync(0,"utf8").trim().split("\n").filter(Boolean)),null,2));'
```

STOP.
