# BOTH — Overnight Sprint: GoTrue Recovery + OAuth E2E + Full Audit

**UTC start:** 2026-11-25T05:19:42Z  
**UTC close:** 2026-11-25T05:35:00Z (approx)  
**Repo:** `ruanlima-devops/both-calendar-sync`  
**PR:** [#50](https://github.com/ruanlima-devops/both-calendar-sync/pull/50) DRAFT  
**Branch:** `feat/m3-003-oauth-lifecycle-reconciled`  
**Worktree:** `/Users/ruan/Documents/work12-m3-003-oauth-reconciliation`

**No merge · No remote deploy · No live Google/Microsoft · No PROD**

---

## 01. Resumo executivo

Docker Desktop estava **quebrado** (API 500) por **pressão de disco** (`/System/Volumes/Data` ~99% cheio; `Docker.raw` 228 Gi). Em vez de `prune` global, recuperamos Auth com **GoTrue nativo v2.198.0** + PostgreSQL Homebrew + JWT real via `/user`.

Resultado: OAuth Lifecycle E2E local com **GoTrue real + Postgres real + mocks Google/Microsoft + Playwright** = **27 PASS** no harness `test:oauth-local`. Vitest default **750 PASS**, Typecheck PASS, SEC-07 PASS. Deploy Safety permanece **UNKNOWN_BLOCKED** (honesto). PR #50 atualizado e permanece Draft.

**M3_003_LOCAL_E2E_CERTIFIED=PASS** (GoTrue real local + JWT + Postgres + CSRF + Playwright mocks).  
**MERGE / REMOTE DEPLOY / LIVE OAUTH / RELEASE_READY = NO.**

---

## 02. Estado inicial

| Item | Valor |
|---|---|
| HEAD | `d156faa86ac8f98fde6f4a43949f119d9cfdf151` |
| develop | `383adb8b902a40f8ecfd30c7e9acfafd49b7ab34` |
| GoTrue | BLOCKED (Docker I/O) |
| PG OAuth | 14 PASS histórico |
| Playwright mocks | 6 PASS histórico |
| Deploy Safety | UNKNOWN_BLOCKED |

---

## 03–05. Docker / causa raiz / recuperação

### Sintomas
- `docker version` server: **500 Internal Server Error** no socket Desktop
- `supabase start` histórico: `meta.db` / overlayfs **input/output error**

### Evidências host
```
/System/Volumes/Data  228Gi  181Gi  3.3Gi  99%
Docker.raw            228G
```

### Classificação
**HOST_STORAGE + DOCKER_ENGINE** — disco saturado; daemon incapaz de escrever no store.

### Recuperação executada (sem prune global)
1. Não executar `docker system prune --volumes`.
2. Estratégia B: GoTrue binário oficial `auth-v2.198.0-darwin-arm64`.
3. DB descartável `both_gotrue_local` + role `postgres` (exigido pelas migrations).
4. `scripts/oauth-local/start-gotrue.sh` + `.env.gotrue` (chmod 600, gitignored).
5. GoTrue API: `http://127.0.0.1:9999` — health OK, migrations 77 aplicadas.

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

Shim OAuth agora exige **JWT real** (`Bearer` com 3 segmentos) e valida via GoTrue `GET /user` — UUID cru → **401**.

---

## 09–14. Testes

### Harness `npm run test:oauth-local` → **27 PASS**
- Postgres integration: **14** (state/ticket/TTL/A–G/concorrência 5×)
- GoTrue integration: **6** (signup/login/JWT/refresh/malformed)
- Playwright Chromium: **7** (Google/MS JWT, deny, 401, Attack A, replay, reject raw UUID)

### Default `npm test` → **750 PASS** / 70 files  
### Deploy Safety unit → **109 PASS**  
### Typecheck → **PASS**  
### SEC-07 → `sec07_tombstone_ok`

### Regressões produto (unit/default suite)
Auth Web / Onboarding / Calendar / Paywall / Billing client / Sync Core (incl. SEC-07 tests): cobertos no Vitest 750 — **PASS**.

Stripe live / OAuth live / sync provider live: **não executados**.

---

## 15–17. Segurança / correções / commits

### Invariantes revalidados com GoTrue JWT
- Callback sem vínculo
- Ticket single-use + concurrent ≤1
- Cross-user finalize 403
- Finalize sem JWT 401
- Provider/browser/user binding

### Correções desta noite
1. Diagnóstico disco/Docker.
2. Stack GoTrue nativa + start script.
3. Shim JWT via `/user` (fim do Bearer-UUID).
4. Testes GoTrue + Playwright atualizados.
5. `.tools/` e `.env.gotrue` no `.gitignore`.

---

## 18–19. Deploy Safety / Release

**Classification:** UNKNOWN_BLOCKED  
Reasons: OAuth client paths + package/e2e/scripts unclassified; functions+migration matched.

**Release artifacts (futuro STAGE — NÃO EXECUTAR):**
1. Migration `20261001000001_oauth_completion_ticket.sql`
2. Functions: `google-oauth`, `microsoft-oauth`, `disconnect-calendar` (+ `_shared/oauth*`)
3. Frontend OAuth/client
4. Redirect URI / secrets review (PO)
5. Canary + live A–G (PO)

---

## 20–25. PR #50 / CI / preservação

*(atualizado após push)*

| Check | Result |
|---|---|
| PR #15 | HEAD `78979549…` OPEN — intacto |
| PR #46 | HEAD `822bcc28…` DRAFT — intacto |
| #26/#30 | OPEN / CLOSED |
| Release gate | OFF |
| SYN-05 / STG-07 / PROD / BETA | NO-GO |

---

## 26–34. Gates / bloqueios / decisões

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
PR50_DRAFT_PRESERVED=PASS
PR15_PRESERVED=PASS
PR46_PRESERVED=PASS
ISSUES_PRESERVED=PASS
NO_REMOTE_DEPLOY=PASS

M3_003_LOCAL_E2E_CERTIFIED=PASS
M3_003_MERGE_AUTHORIZED=NO
M3_003_REMOTE_DEPLOY_AUTHORIZED=NO
M3_003_OAUTH_LIVE_CERTIFIED=NO
M3_003_RELEASE_READY=NO
RELEASE_MANIFEST=CONDITIONAL
SYN05=NO-GO
STG07=NO-GO
PROD=NO-GO
BETA=NO-GO
```

### Bloqueios remanescentes
1. Disco host ~3.3 Gi livres — Docker Desktop ainda NO-GO até liberar espaço.
2. UNKNOWN_BLOCKED até recovery de classificação OAuth (PO separado).
3. STAGE deploy / live OAuth / release gate — não autorizados.
4. Playwright não dirige Expo Router UI completa (shim+mocks).

### Próxima execução PO
1. Liberar espaço em disco / reparar Docker Desktop (opcional para `supabase start` completo).  
2. PR de Deploy Safety path recovery para OAuth client (sem afrouxar functions/migrations).  
3. Autorizar STAGE migration+functions sob release gate.  
4. Canário OAuth live supervisionado.

---

## Comandos reproduzíveis

```bash
cd /Users/ruan/Documents/work12-m3-003-oauth-reconciliation
./scripts/oauth-local/start-gotrue.sh
export OAUTH_LOCAL_DATABASE_URL=postgresql://$USER@127.0.0.1:5432/both_oauth_local_e2e
export GOTRUE_URL=http://127.0.0.1:9999
psql -d both_oauth_local_e2e -f scripts/oauth-local/schema.sql   # se necessário
npm run test:oauth-local
npm test
npm run typecheck
```

STOP.
