# STG-07 / SEC-07 — Source Integrity E2E

**Data (UTC):** 2026-11-22  
**Repositório:** `ruanlima-devops/both-calendar-sync`  
**Base certificada (SHA lock):** `9c6666d897db927d8378fca8498591e240e31d8d`  
**Branch:** `fix/sec-07-sync-calendar-tombstone-source`  
**Worktree:** `/Users/ruan/Documents/work12-sec07-source-integrity`  
**STAGE:** `qszggrrjhcwltnmxpxcy`  
**Deploy nesta autorização:** **NÃO executado**

---

## A. Autorização

Product Owner autorizou exclusivamente correção e certificação da integridade do source SEC-07 (tombstone `sync-calendar`), com PR/CI/merge condicionados a prova de **nenhum** functions deploy / db push remoto.

Fora de escopo (não executado): Supabase functions deploy, db push, SQL remoto, secrets, PROD, projeto legado, PR #15, Issues #26/#30, SYN-05 activation, schedule/delivery/observer, force-push, alteração de `deploy-stage.yml` para permitir deploy.

---

## B. Preflight

| # | Checagem | Resultado |
|---|----------|-----------|
| 1 | Origin/repo `ruanlima-devops/both-calendar-sync` | PASS |
| 2 | `origin/develop` == `9c6666d897db927d8378fca8498591e240e31d8d` | PASS |
| 3 | PR #15 OPEN HEAD `78979549cad61438de751584a0ad895855781b8b` | PASS (intacto) |
| 4 | Worktrees Both preservadas; nova worktree ausente antes da criação | PASS |
| 5 | Espaço livre suficiente | PASS |
| 6 | Sem rebase/reset automático; sem operações Git destrutivas | PASS |
| 7 | Deploy Safety scripts presentes (`classify` + `assert`) | PASS |
| 8 | `assertSec07TombstonePresent` localizado | PASS |
| 9 | Source `supabase/functions/sync-calendar/index.ts` localizado | PASS |
| 10 | Docs/testes SEC-07 localizados (`STG-07-SEC-07-REMEDIATION.md`, legacy test) | PASS |
| 11 | Contrato histórico tombstone recuperado (dirty local PR #15 / remediação 2026-11-17) | PASS |
| 12 | Inventário STAGE PRE read-only (24 functions; sync-calendar v22) | PASS |

**SEC07_PREFLIGHT:** **PASS**

---

## C. SHA lock

```
origin/develop = 9c6666d897db927d8378fca8498591e240e31d8d
worktree HEAD  = 9c6666d897db927d8378fca8498591e240e31d8d (pré-commit)
```

Sem drift. Sem rebase.

---

## D. Histórico do tombstone

| Evidência | Detalhe |
|-----------|---------|
| Remediação certificada | `docs/STG-07-SEC-07-REMEDIATION.md` (2026-11-17) |
| Deploy remoto histórico | `sync-calendar` v20 (`verify_jwt=false`, legado vulnerável) → v21 tombstone → v22 (STAGE atual) |
| Contrato HTTP | **410** + corpo `SYNC_CALENDAR_DEPRECATED` / `SYNC_CALENDAR_GONE` |
| Handler | `handleLegacySyncCalendar` em `_shared/sync/sync-calendar-legacy.ts` |
| Entrypoint | `Deno.serve((req) => handle(req, handleLegacySyncCalendar))` |
| Config | `verify_jwt = true` sob `[functions.sync-calendar]` |
| Integração em `develop` | **Ausente** — tombstone existia apenas como dirty local em worktree PR #15 + STAGE remoto |

O tombstone **nunca foi commitado** em `develop`. Por isso `assertSec07TombstonePresent` falhava no tip certificado apesar do remoto já estar tombstonado.

**SEC07_HISTORICAL_CONTRACT:** **PASS**

---

## E. Root cause

1. `develop` tip (`9c6666d`) ainda continha o runtime legado (`processSyncJob` / `enqueueSync` / `syncConnectedCalendar` / `adminClient`).
2. `supabase/config.toml` em develop: `verify_jwt = false` para `sync-calendar` (regressão vs STAGE v22 `true`).
3. Artefatos certificados (`sync-calendar-legacy.ts` + testes) estavam **untracked** na worktree de PR #15, nunca integrados.
4. STAGE permanece v22 tombstone — divergência source↔remoto, não falha de deploy STAGE atual.

**SEC07_ROOT_CAUSE:** **IDENTIFIED**

---

## F. Contrato de segurança (restaurado)

Fail-closed idêntico ao certificado em 2026-11-17:

- Sem sincronização / eventos / tokens OAuth / DB / `service_role` / Google / Microsoft Graph / writes / migrations / jobs.
- Sem import do engine de sync legado no entrypoint.
- Sem bypass por headers/query/body (`jobId`, `calendarId`, `reconcile`, `user_id`).
- Resposta inerte: **410** + `SYNC_CALENDAR_GONE` (`error=GONE`, `code=SYNC_CALENDAR_DEPRECATED`, `use.userSync=sync-now`, `use.internalReconcile=reconcile-sync`).
- Body drenado e ignorado.

**SEC07_SOURCE_TOMBSTONE:** **PASS** (source local pós-correção)  
**SEC07_NO_LEGACY_SYNC:** **PASS**

---

## G. Investigação `verify_jwt`

| Camada | Valor | Avaliação |
|--------|-------|-----------|
| STAGE remoto v22 | `verify_jwt=true` | Alinhado ao contrato SEC-07 |
| `develop` pré-fix | `verify_jwt=false` | Regressão de source vs remoto |
| Source pós-fix | `verify_jwt=true` | Restaurado |
| Papel no contrato | Defense-in-depth no gateway; handler é inerte mesmo se alcançado | Confirmado em remediação (POST só apikey → 410; JWT inválido → 401 gateway) |
| Alteração automática isolada? | **Não** — corrigido junto do tombstone porque o assert SEC-07 exige `verify_jwt=true` e o remoto já está `true` | |

**SEC07_VERIFY_JWT_REVIEW:** **PASS** (não é proteção exclusiva; tombstone + JWT)

---

## H. Alterações de código

| Arquivo | Ação |
|---------|------|
| `supabase/functions/sync-calendar/index.ts` | Substituído runtime legado por tombstone SEC-07 |
| `supabase/functions/_shared/sync/sync-calendar-legacy.ts` | Adicionado (handler 410) |
| `supabase/functions/_shared/sync/sync-calendar-legacy.test.ts` | Adicionado (17 testes negativos/contratos) |
| `supabase/config.toml` | `verify_jwt = true` + comentário SEC-07 |
| `docs/STG-07-SEC-07-SOURCE-INTEGRITY-E2E.md` | Este relatório |

Não alterados: outras Edge Functions, migrations, `deploy-stage.yml`, PR #15, secrets.

---

## I. Testes negativos (offline)

Suite `sync-calendar-legacy.test.ts` — **17 PASS**, cobrindo:

- 410 anônimo / JWT inválido / JWT expirado-looking  
- recusa calendarId próprio/alheio, jobId, reconcile/cron  
- ignore `user_id` spoof  
- ausência de side effects  
- contratos de source (sem `processSyncJob` no entrypoint; `verify_jwt=true`; app usa `sync-now`)

Assert Deploy Safety:

- tip com tombstone → `{"ok":true,"reason":"sec07_tombstone_ok"}`  
- fixtures T23/T24 (legado / `verify_jwt=false`) → FAIL esperado (suite Deploy Safety)

**SEC07_ASSERTION:** **PASS**  
**SEC07_OFFLINE_TESTS:** **PASS**

---

## J. Regressões

| Suite | Resultado |
|-------|-----------|
| Watchdog | **217 PASS** |
| Deploy Safety | **90 PASS** |
| Vitest default (incl. SEC-07) | **429 PASS** |
| TypeScript (`tsc --noEmit`) | **PASS** |

**SEC07_TYPECHECK:** **PASS**

---

## K. Deploy Safety

Classificação do changeset:

```json
{
  "decision": "DEPLOY_CANDIDATE_FUNCTIONS",
  "reasons": ["functions_or_shared_or_config"],
  "may_skip_remote_deploy": false,
  "run_db": false,
  "run_functions": true
}
```

Assert com release gate OFF (`DEPLOY_SAFETY_ALLOW_CANDIDATE` **ausente** em repo vars e env `staging`):

```json
{
  "ok": true,
  "decision": "DEPLOY_CANDIDATE_FUNCTIONS",
  "run_db": false,
  "run_functions": false,
  "skip_remote": false,
  "reason": "candidate_blocked_until_release_gate"
}
```

Prova de não-deploy:

- `vars.DEPLOY_SAFETY_ALLOW_CANDIDATE` não existe (repo `total_count=0`; staging só `SUPABASE_PROJECT_REF` + `STAGE_WEB_ORIGIN`).
- Job `Supabase STAGE` só roda se `run_functions==true` ou `run_db==true`.
- Job `Record SAFE_SKIP / fail-closed` documenta explicitamente: *DEPLOY_CANDIDATE without release gate = blocked*.
- Classificador **não** foi alterado para `SAFE_SKIP` artificial.

**SEC07_DEPLOY_SAFETY:** **PASS** (candidate bloqueado pelo release gate; sem bypass)

---

## L. Commit / PR / CI

*(preenchido operacionalmente na execução)*

- Commit: ver git log da branch  
- PR: Draft → undraft condicional  
- Required checks develop: `Application`, `Supabase`  
- CI: ver seção M/N

**SEC07_CI:** ver atualização pós-CI

---

## M. Merge

Merge **somente** com:

1. Required checks PASS  
2. Reconfirmação `DEPLOY_SAFETY_ALLOW_CANDIDATE` ≠ `1`  
3. PR #15 intacto  
4. develop tip ainda no SHA lock pré-merge (ou fast-forward limpo)

Se qualquer condição falhar → Draft preservado / STOP.

---

## N. Actions pós-merge

Esperado no push `develop`:

- Classify → `DEPLOY_CANDIDATE_FUNCTIONS`  
- Assert → `run_functions=false` / `candidate_blocked_until_release_gate`  
- Job `Supabase STAGE` → **SKIPPED**  
- Sem `supabase functions deploy` / `db push`

---

## O. STAGE PRE / POST

### PRE (read-only)

| Function | Version | verify_jwt | ezbr_sha256 (prefix) | id |
|----------|---------|------------|----------------------|----|
| sync-calendar | **22** | **true** | `ea35e11e074a1420` | `18eb6068-dd9d-4280-a0ba-c869deaed4aa` |
| google-oauth | 24 | false | `a2f8b164ffd04d94` | `b7306745-2362-4039-8071-2bee88fe1b84` |
| delete-account | 15 | true | `74dc571d3161da76` | `36870d87-d6e9-453b-8c01-24740e67e0be` |
| billing-webhook | 14 | false | `cf8c07f4755f8681` | `a485a2e6-fdb3-43db-bb16-ec5006ccde29` |
| microsoft-oauth | 23 | false | `93a2c71d00d52c5e` | `41df2dee-91f5-4863-bf0e-edef3610a9a0` |

TOTAL functions: **24**

### POST

*(preencher após merge — deve ser idêntico ao PRE)*

---

## P. Estado final do source

Entrypoint develop (pós-integração esperada):

- Contém `handleLegacySyncCalendar` / SEC-07  
- Não contém `processSyncJob` / `syncConnectedCalendar` / `enqueueSync`  
- `assertSec07TombstonePresent` → ok  
- `verify_jwt = true`

---

## Q. Estado remoto

**SEC07_REMOTE_STAGE:** **UNCHANGED** (objetivo; confirmado POST)  
Nenhum deploy nesta autorização.

---

## R. PR #15

OPEN · HEAD `78979549cad61438de751584a0ad895855781b8b` · **não alterado**.

---

## S. Riscos residuais

1. Se PO ativar `DEPLOY_SAFETY_ALLOW_CANDIDATE=1` no futuro, um push com functions mudadas faria deploy — **intencional** (Gate D). Com tombstone no tip, SEC-07 veto adicional protege republicação de legado.  
2. Worktree PR #15 ainda tem dirty local histórico — não tocado.  
3. `supabase functions deploy` sem path filter publicaria **todas** as functions se o gate for ligado — risco operacional residual, fora deste escopo.

---

## T. Gates finais (matriz)

| Gate | Status |
|------|--------|
| SEC07_PREFLIGHT | PASS |
| SEC07_HISTORICAL_CONTRACT | PASS |
| SEC07_ROOT_CAUSE | IDENTIFIED |
| SEC07_SOURCE_TOMBSTONE | PASS |
| SEC07_NO_LEGACY_SYNC | PASS |
| SEC07_ASSERTION | PASS |
| SEC07_VERIFY_JWT_REVIEW | PASS |
| SEC07_OFFLINE_TESTS | PASS |
| SEC07_TYPECHECK | PASS |
| SEC07_DEPLOY_SAFETY | PASS |
| SEC07_CI | PENDING |
| SEC07_MERGE | PENDING |
| SEC07_NO_REMOTE_DEPLOY | PENDING (prova de gate OFF = PASS local) |
| SEC07_STAGE_PRE_POST | PRE PASS / POST PENDING |
| SEC07_SOURCE_INTEGRITY_CERTIFIED | PENDING integração develop |
| SEC07_REMOTE_STAGE | UNCHANGED |
| WATCHDOG_REMOTE_ENABLED | NO |
| SYN-05 | NO-GO |
| STG-07 | NO-GO |
| PROD | NO-GO |

---

## U. Próxima decisão PO

1. Se merge + Actions confirmarem SKIPPED deploy e STAGE idêntico → **SEC07_SOURCE_INTEGRITY_CERTIFIED=PASS**.  
2. Não habilitar `DEPLOY_SAFETY_ALLOW_CANDIDATE` sem autorização Gate D explícita.  
3. SYN-05 / STG-07 / PROD permanecem **NO-GO**.
