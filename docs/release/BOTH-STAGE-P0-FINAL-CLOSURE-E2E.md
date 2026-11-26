# Both — STAGE P0 Final Closure E2E

**Audit timestamp (UTC):** 2026-11-26T03:33:49Z  
**Repository:** `ruanlima-devops/both-calendar-sync`  
**Develop HEAD:** `c15f277af41c9f7779b57abb59a6c2d0e7c7c2c3`  
**STAGE web:** https://stage.bothcalendar.com  
**Supabase STAGE:** `qszggrrjhcwltnmxpxcy`  
**Stripe:** Test Mode only (`acct_1Uc9CcFbkGjeaJ48` sandbox)  
**PROD mutation:** NO  
**Stripe Live:** NO  

Canonical prior sync certification: `docs/release/BOTH-STAGE-REAL-PROVIDER-QA-E2E.md` (run `BOTHQA20261126022819`).

---

## 1. Executive summary

Os três bloqueios P0 restantes foram fechados em STAGE com evidência real:

| Frente | Antes | Depois |
|--------|-------|--------|
| Email confirm inbox | BLOCKED (assumed deliverability) | **PASS** — e-mail recebido; `verifyOtp(token_hash)`; login pós-confirm |
| Stripe cancel DB | INCONSISTENT (`cancel_at_period_end=false`) | **PASS** — SoT Stripe `cancel_at` + webhook/DB `true`; UI “Acesso até” |
| Frontend stale asset | STALE (preview ≠ active worker) | **PASS** — active `entry-ad241859cc999225bec4d76a6b9e5594.js` |

**BOTH_STAGE_P0_E2E_CERTIFIED=PASS**  
**BETA_READINESS_RECOMMENDATION=GO** (técnico)  
**BETA_READY=NO** (requer aprovação explícita do PO)  
**PRODUCTION_RELEASE_AUTHORIZED=NO** · **PRODUCTION_DEPLOY_EXECUTED=NO**

---

## 2. Baseline

- PRs prévios no núcleo: #55–#59 (providers/sync/paywall/docs).  
- Closure PRs: **#60** (billing thin-event preserve), **#61** (email `token_hash` callback), **#63** (flexible `cancel_at` inference).  
- Deploy STAGE functions: run [`45748455812`](https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45748455812) (SHA `c15f277…`).  
- FE STAGE asset: `/_expo/static/js/web/entry-ad241859cc999225bec4d76a6b9e5594.js`.  
- `DEPLOY_SAFETY_ALLOW_CANDIDATE` resetado para `0` após deploys.

**Nota:** #62 foi aberto sem `--base develop` e mergeou o mesmo patch de billing em `main` (somente CI; sem workflow de Deploy PROD). STAGE usa `develop` via #63.

---

## 3. P0 email — root cause

Não era falha de SMTP/deliverability STAGE.

1. Transport/inbox: mensagens de `noreply@bothcalendar.com` chegaram na caixa QA (`bothcalendartest+…@gmail.com`).  
2. Bug FE: `/auth/callback` tratava só PKCE `code` e podia short-circuitar com sessão existente, ignorando `token_hash`+`type=signup` do template Supabase.  
3. Sintoma: confirmação “clicada” sem `verifyOtp` → login continuava `email_not_confirmed`.

---

## 4. P0 email — fix

PR **#61** (`6eb2a52` / merge `5e34121`):

- `parseAuthCallbackUrl` lê `token_hash` + `type`.  
- `createSessionFromUrl` chama `supabase.auth.verifyOtp` **antes** de qualquer short-circuit de sessão.  
- Allowlist Deploy Safety + testes unitários.

FE publicado no Worker STAGE ativo (não só preview Cloudflare Builds).

---

## 5. Email E2E evidence

Jornada sintética QA:

1. Signup → `/confirm-email` (alias `bothcalendartest+p0hash030220@gmail.com`).  
2. Inbox Gmail QA: thread “Both — confirme seu e-mail” com links `type=signup` + `token_hash` (len=61).  
3. Navegação ao callback → `POST /auth/v1/verify` **200** + profile criado.  
4. Login limpo → `LOGIN_OK=true`, landing onboarding (não “Confirme seu e-mail”).  
5. Asset na sessão: `entry-ad241859…`.

Gates: `EMAIL_TRANSPORT=PASS`, `EMAIL_INBOX_DELIVERY=PASS`, `EMAIL_CONFIRMATION_E2E=PASS`, `LOGIN_POST_CONFIRM=PASS`.

---

## 6. Stripe cancelation — root cause

Não era “Stripe errado” nem só atraso.

- Portal QA cancelou com término ~25/26 dez.  
- Stripe Test SoT na sub `sub_1Ufs2dFbkGjeaJ48hoosqQQ1`:  
  - `status=active`  
  - `cancel_at_period_end=false`  
  - `cancel_at=<period end>` (flexible billing API 2026)  
  - `canceled_at` set  
  - period bounds no **item**, não na raiz (`current_period_end` root = null)  
- Handler antigo: boolean `false` explícito ganhava de `cancel_at` → DB `cancel_at_period_end=false` / `canceled_at=null`.

---

## 7. Stripe source-of-truth comparison

| Campo | Stripe Test (após portal) | DB pré-fix | DB pós-fix (#63 + event) |
|-------|---------------------------|------------|---------------------------|
| status | active | active | active |
| cancel_at_period_end | false (API) | false | **true** (inferido) |
| cancel_at | 2026-12-26 | (sem coluna) | representado via boolean+period |
| canceled_at | set | null | set |
| current_period_end | item 2026-12-26 | 2026-12-26 | 2026-12-26 |
| entitlement | paid period | active | **active até period end** |

---

## 8. Stripe fix

PR **#63** (commit `abae5fb`, merge `c15f277`):

- `resolveCancelAtPeriodEnd`: se `cancel_at` agenda fim e status active/trialing → `true` mesmo com boolean `false`.  
- `resolveSubscriptionPeriodBounds`: fallback para `items.data[0]`.  
- Webhook + `asSubscriptionSnapshot` alinhados.  
- Testes: cancel-at-period-end + webhook flexible shape.

Deploy: Deploy STAGE `45748455812` → Edge Functions.

Reconciliação comprovada via novo `customer.subscription.updated` (`evt_1UftJ9…`, metadata reconcile) no endpoint STAGE `billing-webhook`.

---

## 9. Stripe Test E2E evidence

- Portal histórico: cancelamento agendado (UI Stripe).  
- Webhook fresco aplicado → DB `cancel_at_period_end=true`, `canceled_at=2026-11-26T02:07:28Z`.  
- Conta QA Conta tab: **Status Ativo**, **Acesso até 25 de dezembro de 2026**, **Gerenciar assinatura**.  
- Entitlement permanece ativo durante período pago.

Gates: `STRIPE_CANCEL_PORTAL=PASS`, `STRIPE_CANCEL_WEBHOOK=PASS`, `STRIPE_CANCEL_DB=PASS`, `STRIPE_CANCEL_ENTITLEMENT=PASS`, `STRIPE_CANCEL_UI=PASS`.

---

## 10. Frontend stale asset — root cause

Cloudflare Workers Builds gerava **previews** por branch; o Worker **ativo** de `stage.bothcalendar.com` permanecia em build antigo até publish explícito (`wrangler` / promote). Inferir versão só pelo HEAD de `develop` era insuficiente.

---

## 11. Frontend fix

Publish oficial do Worker STAGE apontando HTML → `entry-ad241859cc999225bec4d76a6b9e5594.js` (traceável ao merge #61 / FE publish stage).

---

## 12. Browser/build freshness evidence

- `GET https://stage.bothcalendar.com/` → script `entry-ad241859cc999225bec4d76a6b9e5594.js`.  
- Sessão QA Conta/Agenda: mesmo hash.  
- `cache-control: public, max-age=0, must-revalidate`.  

`FRONTEND_STAGE_FRESHNESS=PASS` · `FRONTEND_BUILD_TRACEABILITY=PASS`.

---

## 13–15. OAuth / connected / sync regression

Regressão focada (sem recriar suíte destrutiva):

- Google ✓ `bothcalendartest@gmail.com`  
- Microsoft ✓  
- Evento histórico `BOTHQA20261126022819-G2M-UPD` ainda visível na Agenda  
- Evidência bidirecional completa preservada no relatório #59  

`BOTH_STAGE_REAL_PROVIDER_E2E_CERTIFIED=PASS` (histórico + revalidação de connected state).

---

## 16. Security

- Sem tokens/links completos neste relatório.  
- Sem mutação PROD / legado `sknpqjodttkpttaytdut`.  
- Stripe Test only.  
- Webhook signature path inalterado; idempotência preservada (resend mesmo `evt` não era suficiente — novo evento necessário).  
- Entitlement server-side: cancel agendado **não** revoga acesso antes do period end.

---

## 17. SEC-07

`POST /functions/v1/sync-calendar` (com anon) → **410**  
`{"error":"GONE","code":"SYNC_CALENDAR_DEPRECATED",...}`

---

## 18. Deploy Safety

- Classify fail-closed nas deploys #60/#63.  
- `DEPLOY_SAFETY_ALLOW_CANDIDATE` → `0` ao final.  
- Sem `SAFE_SKIP` forçado em artefato deployable.

---

## 19. Unit / integration / E2E results

| Suite | Result |
|-------|--------|
| Vitest (develop HEAD) | **847 passed** / 75 files / ~2.6s |
| Typecheck | PASS (`tsc --noEmit`) |
| Billing cancel unit+webhook | 41 PASS (pré-merge) |
| CI #63 Application + Supabase | PASS |
| Email E2E STAGE | PASS |
| Stripe cancel E2E STAGE | PASS |
| FE freshness | PASS |
| OAuth connected smoke | PASS |
| Sync historical + UI residual | PASS |

---

## 20. PRs, merges and commits

| PR | Base | Result |
|----|------|--------|
| #60 | develop | merged — thin Stripe cancel preserve |
| #61 | develop | merged — email token_hash callback |
| #62 | **main** (acidental) | merged code-only; **no PROD deploy** |
| #63 | develop | merged — flexible cancel_at inference |

Develop tip: `c15f277`.

---

## 21. STAGE deploy IDs

- Functions (cancel fix): [Deploy STAGE 45748455812](https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45748455812)  
- FE Worker asset: `entry-ad241859cc999225bec4d76a6b9e5594.js`  
- Stripe webhook endpoint: `we_1UcAmQ…` → `…/functions/v1/billing-webhook`  
- Reconcile event: `evt_1UftJ9FbkGjeaJ48aguXNQvM`

---

## 22. Remaining bugs / debt

- Mensagem genérica de erro no callback ainda pode mapear falhas OTP para copy “Google” (`userMessageForAuthError` default) — UX P1, não bloqueia E2E.  
- `main` contém o patch #62; alinhar política de base branch (sempre `develop` para STAGE).  
- CDP Playwright pode travar se o Chrome QA debug ficar wedged (ops).  

---

## 23. Human actions needed

Nenhuma ação bloqueante para certificação P0 STAGE.

Para beta produto: **aprovação explícita do PO** (`BETA_READY` permanece NO até lá).

---

## 24. Gates

```
PREFLIGHT=PASS

AUTH_SIGNUP_STAGE=PASS
EMAIL_TRANSPORT=PASS
EMAIL_INBOX_DELIVERY=PASS
EMAIL_CONFIRMATION_E2E=PASS
LOGIN_POST_CONFIRM=PASS
TRIAL_14D_STAGE=PASS

GOOGLE_OAUTH_STAGE=PASS
MICROSOFT_OAUTH_STAGE=PASS
BOTH_PROVIDERS_CONNECTED=PASS

SYNC_GOOGLE_TO_MICROSOFT=PASS
SYNC_MICROSOFT_TO_GOOGLE=PASS
SYNC_UPDATES=PASS
SYNC_NO_DUPLICATION=PASS
SYNC_NO_LOOP=PASS

STRIPE_TEST_CHECKOUT=PASS
STRIPE_TEST_WEBHOOK=PASS
STRIPE_TEST_ENTITLEMENT=PASS
STRIPE_CANCEL_PORTAL=PASS
STRIPE_CANCEL_DB=PASS
STRIPE_CANCEL_ENTITLEMENT=PASS
STRIPE_CANCEL_UI=PASS

FRONTEND_STAGE_FRESHNESS=PASS
FRONTEND_BUILD_TRACEABILITY=PASS
FRONTEND_BROWSER_REGRESSION=PASS

VITEST=PASS
TYPECHECK=PASS
SEC07=PASS
DEPLOY_SAFETY=PASS
REQUIRED_CI=PASS

STAGE_NO_UNEXPECTED_DRIFT=PASS
NO_PRODUCTION_MUTATION=PASS
FINAL_INDEPENDENT_AUDIT=PASS

BOTH_STAGE_REAL_PROVIDER_E2E_CERTIFIED=PASS
BOTH_STAGE_P0_E2E_CERTIFIED=PASS

BETA_READINESS_RECOMMENDATION=GO
BETA_READY=NO
PRODUCTION_RELEASE_AUTHORIZED=NO
PRODUCTION_DEPLOY_EXECUTED=NO
```

---

## 25. Beta readiness recommendation

**GO técnico** para beta fechado em STAGE-certified builds, após aprovação PO.

---

## 26. Production NO-GO

**PRODUCTION_RELEASE_AUTHORIZED=NO.** Nenhum deploy PROD executado nesta closure.

---

## 27. Next steps

1. PO aprova `BETA_READY` se desejar.  
2. Política: PRs STAGE sempre `--base develop`.  
3. Opcional P1: copy de erro do callback email ≠ Google.  
4. Manter SYN-05 OFF até autorização separada.

---

## Respostas diretas (entrega §14)

1. **Por que o e-mail “não chegava”?** Chegava; o FE não consumia `token_hash`.  
2. **Já chega e confirma?** Sim — inbox + verify 200 + login OK.  
3. **Causa cancel Stripe divergente?** API flexible: `cancel_at` com `cancel_at_period_end=false`; mapper antigo confiava no boolean.  
4. **DB representa Stripe?** Sim — `cancel_at_period_end=true` + period end + canceled_at.  
5. **Entitlement no período pago?** Sim — Status Ativo / Acesso até 25 dez 2026.  
6. **Frontend stale?** Worker ativo ≠ preview Builds.  
7. **Navegador na versão nova?** Sim — `entry-ad241859…`.  
8. **Google/Microsoft?** Continuam ✓.  
9. **Sync?** Evidência BOTHQA + connected state revalidado.  
10. **P0 novo?** Não crítico; UX copy callback é P1.  
11. **PRs merged?** #60, #61, #63 (develop); #62 em main sem deploy PROD.  
12. **Publicado STAGE?** Functions `45748455812` + FE `entry-ad241859…`.  
13. **Versão final?** develop `c15f277` + asset `entry-ad241859…`.  
14. **MVP P0 PASS?** **SIM.**  
15. **Beta recomendável tecnicamente?** **GO** (BETA_READY ainda NO até PO).
