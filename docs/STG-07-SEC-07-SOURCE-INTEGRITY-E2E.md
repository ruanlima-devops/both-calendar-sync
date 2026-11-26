# STG-07 / SEC-07 — Source Integrity E2E

**Data (UTC):** 2026-11-22  
**Repositório:** `ruanlima-devops/both-calendar-sync`  
**Base certificada (SHA lock pré-merge):** `9c6666d897db927d8378fca8498591e240e31d8d`  
**Merge SHA:** `90187289dcf945969894858fd70a96741520d532`  
**PR:** [#36](https://github.com/ruanlima-devops/both-calendar-sync/pull/36) **MERGED**  
**Branch de correção:** `fix/sec-07-sync-calendar-tombstone-source` @ `b7d637542ad427ec560bae7592861be05950399f`  
**Worktree:** `/Users/ruan/Documents/work12-sec07-source-integrity`  
**STAGE:** `qszggrrjhcwltnmxpxcy`  
**Deploy nesta autorização:** **NÃO executado** (job Supabase STAGE **SKIPPED**)

---

## A. Autorização

Product Owner autorizou exclusivamente correção e certificação da integridade do source SEC-07 (tombstone `sync-calendar`), com PR/CI/merge condicionados a prova de **nenhum** functions deploy / db push remoto.

Fora de escopo (não executado): Supabase functions deploy, db push, SQL remoto, secrets, PROD, projeto legado, PR #15, Issues #26/#30, SYN-05 activation, schedule/delivery/observer, force-push, alteração de `deploy-stage.yml` para permitir deploy.

---

## B. Preflight

| # | Checagem | Resultado |
|---|----------|-----------|
| 1 | Origin/repo `ruanlima-devops/both-calendar-sync` | PASS |
| 2 | `origin/develop` == `9c6666d…` (pré-merge) | PASS |
| 3 | PR #15 OPEN HEAD `78979549cad61438de751584a0ad895855781b8b` | PASS (intacto pré e pós) |
| 4 | Worktrees Both preservadas; nova worktree criada de forma não destrutiva | PASS |
| 5 | Espaço livre suficiente | PASS |
| 6 | Sem rebase/reset automático; sem operações Git destrutivas | PASS |
| 7 | Deploy Safety scripts presentes (`classify` + `assert`) | PASS |
| 8 | `assertSec07TombstonePresent` localizado | PASS |
| 9 | Source `supabase/functions/sync-calendar/index.ts` localizado | PASS |
| 10 | Docs/testes SEC-07 localizados | PASS |
| 11 | Contrato histórico tombstone recuperado (remediação 2026-11-17 + dirty PR #15) | PASS |
| 12 | Inventário STAGE PRE read-only (24 functions; sync-calendar v22) | PASS |

**SEC07_PREFLIGHT:** **PASS**

---

## C. SHA lock

```
pré-merge origin/develop = 9c6666d897db927d8378fca8498591e240e31d8d
pós-merge origin/develop = 90187289dcf945969894858fd70a96741520d532
```

Sem rebase. Merge commit padrão de PR #36.

---

## D. Histórico do tombstone

| Evidência | Detalhe |
|-----------|---------|
| Remediação certificada | `docs/STG-07-SEC-07-REMEDIATION.md` (2026-11-17) |
| Deploy remoto histórico | v20 legado → v21 tombstone → **v22** (STAGE atual, inalterado) |
| Contrato HTTP | **410** + `SYNC_CALENDAR_DEPRECATED` / `SYNC_CALENDAR_GONE` |
| Handler | `handleLegacySyncCalendar` |
| Config | `verify_jwt = true` |
| Integração prévia em `develop` | **Ausente** — só dirty local + remoto |

**SEC07_HISTORICAL_CONTRACT:** **PASS**

---

## E. Root cause

1. `develop` tip (`9c6666d`) ainda continha runtime legado (`processSyncJob` / `enqueueSync` / `syncConnectedCalendar` / `adminClient`).
2. `config.toml` em develop: `verify_jwt = false` (regressão vs STAGE v22 `true`).
3. Artefatos certificados (`sync-calendar-legacy.ts` + testes) estavam **untracked** na worktree de PR #15.
4. STAGE já era v22 tombstone — divergência **source↔remoto**, não falha do remoto atual.

**SEC07_ROOT_CAUSE:** **IDENTIFIED**

---

## F. Contrato de segurança (restaurado em develop)

Fail-closed idêntico ao certificado em 2026-11-17:

- Sem sync / eventos / OAuth tokens / DB / `service_role` / Google / Microsoft Graph / writes / migrations / jobs.
- Sem import do engine legado no entrypoint.
- Sem bypass por headers/query/body.
- Resposta: **410** + `SYNC_CALENDAR_GONE`.

**SEC07_SOURCE_TOMBSTONE:** **PASS**  
**SEC07_NO_LEGACY_SYNC:** **PASS**

---

## G. Investigação `verify_jwt`

| Camada | Valor |
|--------|-------|
| STAGE remoto v22 | `true` (inalterado PRE=POST) |
| develop pré-fix | `false` (regressão) |
| develop pós-merge | `true` |
| Papel | Defense-in-depth; handler permanece inerte |

Não alterado isoladamente; restaurado com o tombstone porque o assert SEC-07 exige `verify_jwt=true` e o remoto já estava `true`.

**SEC07_VERIFY_JWT_REVIEW:** **PASS**

---

## H. Alterações de código (PR #36)

| Arquivo | Ação |
|---------|------|
| `supabase/functions/sync-calendar/index.ts` | Tombstone SEC-07 |
| `supabase/functions/_shared/sync/sync-calendar-legacy.ts` | Handler 410 |
| `supabase/functions/_shared/sync/sync-calendar-legacy.test.ts` | 17 testes |
| `supabase/config.toml` | `verify_jwt = true` |
| `docs/STG-07-SEC-07-SOURCE-INTEGRITY-E2E.md` | Relatório E2E |

Não alterados: outras Edge Functions, migrations, `deploy-stage.yml`, PR #15, secrets.

---

## I. Testes negativos (offline)

- Suite legacy: **17 PASS**
- Assert tip develop: `{"ok":true,"reason":"sec07_tombstone_ok"}`
- Fixtures Deploy Safety T23/T24 (legado / jwt false): FAIL esperado

**SEC07_ASSERTION:** **PASS**  
**SEC07_OFFLINE_TESTS:** **PASS**

---

## J. Regressões

| Suite | Resultado |
|-------|-----------|
| Watchdog | **217 PASS** |
| Deploy Safety | **90 PASS** |
| Vitest default | **429 PASS** |
| TypeScript | **PASS** |

**SEC07_TYPECHECK:** **PASS**

---

## K. Deploy Safety

Classificação do changeset:

```json
{
  "decision": "DEPLOY_CANDIDATE_FUNCTIONS",
  "run_db": false,
  "run_functions": true,
  "may_skip_remote_deploy": false
}
```

Assert com release gate OFF (`DEPLOY_SAFETY_ALLOW_CANDIDATE` vazio no Actions run):

```json
{
  "ok": true,
  "decision": "DEPLOY_CANDIDATE_FUNCTIONS",
  "run_db": false,
  "run_functions": false,
  "reason": "candidate_blocked_until_release_gate"
}
```

Prova Actions pós-merge (run `44978220228`):

- `DEPLOY_SAFETY_ALLOW_CANDIDATE:` (vazio)
- Classify → `DEPLOY_CANDIDATE_FUNCTIONS`
- Assert → `run_functions=false`
- Job **Supabase STAGE** → **skipped**
- Job **Record SAFE_SKIP / fail-closed** → **success**
- Sem `supabase functions deploy` / sem `db push`

Classificador **não** foi alterado para forçar `SAFE_SKIP`.

**SEC07_DEPLOY_SAFETY:** **PASS**  
**SEC07_NO_REMOTE_DEPLOY:** **PASS**

---

## L. Commit / PR / CI

| Item | Valor |
|------|-------|
| Commit fix | `b7d637542ad427ec560bae7592861be05950399f` |
| PR | [#36](https://github.com/ruanlima-devops/both-calendar-sync/pull/36) |
| Required checks | `Application` SUCCESS · `Supabase` SUCCESS |
| CI develop push | run `44978220358` SUCCESS |
| Nota | Check não-required `Workers Builds: both-calendar-sync-stage` FAILURE no PR (Cloudflare); **não** está em branch protection |

**SEC07_CI:** **PASS**

---

## M. Merge

| Campo | Valor |
|-------|-------|
| Undraft | sim (após required checks + prova no-deploy) |
| Merge | `90187289dcf945969894858fd70a96741520d532` @ 2026-11-22T02:54:41Z |
| Base pré-merge | `9c6666d…` (sem drift) |
| Release gate | OFF reconfirmado |
| PR #15 | intacto |

**SEC07_MERGE:** **PASS**

---

## N. Actions pós-merge

| Workflow | Run | Resultado |
|----------|-----|-----------|
| Deploy STAGE | [44978220228](https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/44978220228) | success · Supabase STAGE **SKIPPED** |
| CI | [44978220358](https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/44978220358) | success |

Nenhum outro workflow de deploy Supabase executado no SHA de merge.

---

## O. STAGE PRE / POST

### PRE = POST (ALL_IDENTICAL)

| Function | Version | verify_jwt | ezbr_sha256 (prefix) | id |
|----------|---------|------------|----------------------|----|
| sync-calendar | **22** | **true** | `ea35e11e074a1420` | `18eb6068-dd9d-4280-a0ba-c869deaed4aa` |
| google-oauth | 24 | false | `a2f8b164ffd04d94` | `b7306745-2362-4039-8071-2bee88fe1b84` |
| delete-account | 15 | true | `74dc571d3161da76` | `36870d87-d6e9-453b-8c01-24740e67e0be` |
| billing-webhook | 14 | false | `cf8c07f4755f8681` | `a485a2e6-fdb3-43db-bb16-ec5006ccde29` |
| microsoft-oauth | 23 | false | `93a2c71d00d52c5e` | `41df2dee-91f5-4863-bf0e-edef3610a9a0` |

TOTAL functions: **24** (todas as 24 IDs/versões/sha idênticos PRE↔POST)

**SEC07_STAGE_PRE_POST:** **PASS**

---

## P. Estado final do source (`origin/develop`)

```ts
import { handle } from '../_shared/function.ts';
import { handleLegacySyncCalendar } from '../_shared/sync/sync-calendar-legacy.ts';
// SEC-07: legacy endpoint retired. Deployed surface returns 410 Gone.
Deno.serve((req) => handle(req, handleLegacySyncCalendar));
```

`assertSec07TombstonePresent(develop tip)` → `sec07_tombstone_ok`

---

## Q. Estado remoto

**SEC07_REMOTE_STAGE:** **UNCHANGED**  
sync-calendar permanece **v22** / `verify_jwt=true` / mesmo deployment id e sha.

---

## R. PR #15

OPEN · HEAD `78979549cad61438de751584a0ad895855781b8b` · **não alterado**.

---

## S. Riscos residuais

1. Ativar `DEPLOY_SAFETY_ALLOW_CANDIDATE=1` no futuro autorizaria deploy de candidates — requer Gate D explícito. Com tombstone no tip, veto SEC-07 adicional bloqueia republicação de legado.
2. Worktree PR #15 ainda pode ter dirty local histórico — não tocado.
3. Check Cloudflare Workers Builds falhou no PR #36 (não-required); fora do escopo Supabase Edge.

---

## T. Gates finais

| Gate | Status |
|------|--------|
| SEC07_PREFLIGHT | **PASS** |
| SEC07_HISTORICAL_CONTRACT | **PASS** |
| SEC07_ROOT_CAUSE | **IDENTIFIED** |
| SEC07_SOURCE_TOMBSTONE | **PASS** |
| SEC07_NO_LEGACY_SYNC | **PASS** |
| SEC07_ASSERTION | **PASS** |
| SEC07_VERIFY_JWT_REVIEW | **PASS** |
| SEC07_OFFLINE_TESTS | **PASS** |
| SEC07_TYPECHECK | **PASS** |
| SEC07_DEPLOY_SAFETY | **PASS** |
| SEC07_CI | **PASS** |
| SEC07_MERGE | **PASS** |
| SEC07_NO_REMOTE_DEPLOY | **PASS** |
| SEC07_STAGE_PRE_POST | **PASS** |
| SEC07_SOURCE_INTEGRITY_CERTIFIED | **PASS** |
| SEC07_REMOTE_STAGE | **UNCHANGED** |
| WATCHDOG_REMOTE_ENABLED | **NO** |
| SYN-05 | **NO-GO** |
| STG-07 | **NO-GO** |
| PROD | **NO-GO** |

---

## U. Próxima decisão PO

1. Source SEC-07 está integrado em `develop` e protegido pelo assert + release gate.  
2. **Não** habilitar `DEPLOY_SAFETY_ALLOW_CANDIDATE` sem autorização Gate D.  
3. SYN-05 / STG-07 / PROD permanecem **NO-GO**.  
4. PR #15 permanece OPEN/intocável sob esta autorização.
