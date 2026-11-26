# BOTH — STAGE Real Provider QA + P0 E2E Closure

**Baseline UTC:** `2026-11-26T01:59:56Z` → report close `2026-11-26T02:12:00Z`  
**Repo:** `ruanlima-devops/both-calendar-sync`  
**Environment:** STAGE only (`https://stage.bothcalendar.com` / Supabase `qszggrrjhcwltnmxpxcy`)  
**PROD:** not touched · **Stripe Live:** not used · **Secrets/JWT/cookies:** omitted

---

## 1. Resumo executivo

Execução prática no Chrome QA (CDP `127.0.0.1:9222`, perfil entitled). Sessão autenticada com entitlement ativo. Microsoft reconectável e `sync-now` OK. Google bloqueado em `token_refresh_failed` aguardando consentimento humano. Stripe Test checkout + webhook entitlement **PASS**; cancelamento no portal Stripe Test **PASS** na UI, mas `cancel_at_period_end` **não** refletiu no banco STAGE (defeito). Paywall trial→upgrade era inacessível (P0) — corrigido em **#57** (merged); asset STAGE ainda `entry-6ef4d8…` (FE promote pendente/investigar). Sync bidirecional **não** executado (gate Google). E-mail inbox **BLOCKED**.

**Decisão:** `BOTH_STAGE_REAL_PROVIDER_E2E_CERTIFIED=PARTIAL` · `BOTH_STAGE_P0_E2E_CERTIFIED=PARTIAL` · `BETA_READY=NO` · `PRODUCTION_RELEASE_AUTHORIZED=NO` · `PRODUCTION_DEPLOY_EXECUTED=NO`.

---

## 2. Baseline

| Item | Valor |
|------|--------|
| develop HEAD (início) | `18a43de` |
| develop HEAD (fim) | `c1b4d68` (merge #57) |
| Frontend STAGE observado | `entry-6ef4d8c866c13d63a351c0e61a14586c.js` (sem mudança pós-#57) |
| Supabase STAGE | `qszggrrjhcwltnmxpxcy` (confirmado via `localStorage` key prefix) |
| Legado | `sknpqjodttkpttaytdut` — não usado (Preview check skipped nele) |
| SEC-07 | `sync-calendar` → **410** `SYNC_CALENDAR_DEPRECATED` (com JWT QA) |
| Sync engine | `sync-now` / webhooks / `reconcile-sync` (tombstone intacto) |
| PR #15 | OPEN (preservado) |
| Issues #26 / #30 | #26 OPEN · #30 CLOSED (não alterados) |
| Deploy concorrente | nenhum bloqueio observado |

---

## 3. Browser QA

- Chrome QA dedicado (`chrome-qa-entitled`), CDP local `127.0.0.1:9222`.
- Login via Playwright `connectOverCDP` + secrets locais (não logados).
- Sessão: QA Both Test; calendários Google/Microsoft QA visíveis na UI.

---

## 4. Interações humanas

| Checkpoint | Status | Pedido |
|------------|--------|--------|
| `HUMAN_CHECKPOINT` Google OAuth reconnect | **ABERTO** | No Chrome QA, popup Google em `accounts.google.com` (e-mail QA pré-preenchido). Completar login/consentimento da conta Google QA autorizada e confirmar retorno ao Both STAGE. Sem senha no chat. |
| Microsoft consent | Não exigido nesta rodada (conexão já presente; sync manual OK) | — |
| E-mail inbox QA | **BLOCKED** | Disponibilizar caixa autorizada ou confirmar entrega humana (histórico: Resend rate-limit / sem inbox). |

---

## 5–6. Google / Microsoft OAuth

### Google

| Gate | Resultado |
|------|-----------|
| GOOGLE_OAUTH_START / authorize URL | **PASS** (`google-oauth` 200 → `accounts.google.com`) |
| UI loading “Conectando…” | **PASS** (sem regressão #55 no CTA errado) |
| GOOGLE_CONSENT_LIVE | **BLOCKED** (parado em sign-in Google) |
| GOOGLE_CALLBACK / FINALIZE / PERSISTED | **NOT_EXECUTED** |
| GOOGLE_CALENDARS_LISTED | **PARTIAL** (lista residual da conexão antiga; status `Reconectar` + `token_refresh_failed`) |
| GOOGLE_CONNECTION | **AUTH_REQUIRED** |

### Microsoft

| Gate | Resultado |
|------|-----------|
| Conexão persistida mesma conta Both | **PASS** (QA hotmail) |
| MICROSOFT_CONSENT_LIVE (reconsent) | **NOT_EXECUTED** (já conectada) |
| Calendários listados | **PASS** (Calendário visível; feriados/aniversários ocultos só-leitura) |
| `sync-now` | **PASS** → `{synced:1,failed:0}`; UI “Conectado”, última sync “agora” |
| BOTH_PROVIDERS_CONNECTED | **BLOCKED** (Google AUTH_REQUIRED) |

---

## 7–11. Sync / anti-loop

**Gate pré-evento:** falhou em `GOOGLE_CONNECTION=VERIFIED`.

| Gate | Resultado |
|------|-----------|
| SYNC_GOOGLE_TO_MICROSOFT | **BLOCKED** |
| SYNC_MICROSOFT_TO_GOOGLE | **BLOCKED** |
| SYNC_UPDATES / NO_DUPLICATION / NO_LOOP / RECOVERY | **NOT_EXECUTED** |
| NO_LEGACY_SYNC | **PASS** (SEC-07 410) |
| ENTITLEMENT_ACTIVE (ao sync MS) | **PASS** (pós Stripe: subscription active) |

Nenhum evento sintético criado.

---

## 12–13. Stripe Test / trial / entitlement

| Cenário | Resultado |
|---------|-----------|
| Stripe Test Mode | **PASS** (checkout `cs_test_*`, badge “Área restrita”) |
| `billing-checkout` GET plan | **PASS** (`Unify Pro` / R$ 19,90 · `stripeConfigured:true`) |
| `billing-checkout` POST → URL | **PASS** |
| Checkout completo (4242) | **PASS** → `/billing/success?session_id=…` |
| Webhook → entitlement | **PASS** — Settings: Origem **Web (Stripe)**, Status **Ativo**; row `status=active`, `billing_provider=stripe` |
| Trial banner some pós-upgrade | **PASS** |
| Portal (`billing-portal`) | **PASS** — Visa •••• 4242, fatura paga |
| Cancelar no portal | **PASS** na UI Stripe (“Cancela em 25 de dez.” / serviço até fim do período) |
| `cancel_at_period_end` no STAGE DB | **FAIL** — permaneceu `false` / `canceled_at=null` após vários refreshes (**P0/P1**) |
| Paywall UI trial (banner / Ver planos) | **P0 encontrado** — `resolveEntitlementRedirect` expulsava qualquer `hasAccess` do paywall |

**P0 fix:** PR **#57** — trial pode permanecer no paywall; só `source===subscription` redireciona. Merged `c1b4d68`. Deploy Safety **SAFE_SKIP**. CI Application/Supabase **PASS**. Workers Builds develop **PASS**, porém asset STAGE **não** mudou → **reteste UI trial no STAGE = PENDING / FE promote**.

---

## 14. E-mail

`EMAIL_DELIVERABILITY=BLOCKED` — sem caixa QA autorizada nesta sessão; alinhado ao histórico (Resend rate-limit / inbox). Usuário QA já confirmado — OAuth não bloqueado por isso.

---

## 15–16. Bugs e correções

| ID | Severidade | Achado | Ação |
|----|------------|--------|------|
| P0-PAYWALL-TRIAL | P0 | Trial entitled não abre paywall (banner/Ver planos) | **#57** merged |
| P0/P1-CANCEL-FLAG | P0/P1 | Portal cancela; DB sem `cancel_at_period_end` | Aberto — investigar webhook `customer.subscription.updated` / stale ignore / entrega |
| P0-GOOGLE-TOKEN | P0 (ops) | `token_refresh_failed` | Reconnect OAuth — **HUMAN_CHECKPOINT** |
| FE-STAGE-STALE | P1 | #57 merged + Workers Builds OK; `entry-6ef4d8…` inalterado | Verificar branch de produção CF / promote de `stage.bothcalendar.com` |

---

## 17. PRs / SHAs / deploys

| Item | Valor |
|------|--------|
| #57 | MERGED · `c1b4d68` |
| Deploy STAGE run | `45740332542` — SAFE_SKIP (sem mutação Supabase) · success |
| CI develop | `45740332601` success |
| Frontend STAGE asset | ainda `entry-6ef4d8c866c13d63a351c0e61a14586c.js` |
| #15 | OPEN preservado |
| #46 | MERGED (histórico) |

---

## 18–22. CI / SEC-07 / Deploy Safety / Segurança

| Gate | Resultado |
|------|-----------|
| VITEST (focado entitlement-gate) | **PASS** (13) |
| VITEST full | **NOT_EXECUTED** nesta rodada (prioridade E2E live) |
| TYPECHECK | **NOT_EXECUTED** |
| SEC07 | **PASS** (410 tombstone) |
| DEPLOY_SAFETY | **PASS** (SAFE_SKIP correto para gate client-only) |
| REQUIRED_CI (#57 / develop) | **PASS** |
| OAuth CSRF / ticket / JWT negatives | histórico PASS; live finalize Google **NOT_EXECUTED** |
| Token leakage UI/URL | não observado nos fluxos executados |
| NO_PRODUCTION_MUTATION | **PASS** |

---

## 23. Gates finais

```
PREFLIGHT=PASS
CHROME_QA=PASS
QA_ENTITLED_SESSION=PASS

GOOGLE_CONSENT_LIVE=BLOCKED
GOOGLE_CALLBACK_LIVE=NOT_EXECUTED
GOOGLE_FINALIZE_LIVE=NOT_EXECUTED
GOOGLE_CONNECTION_PERSISTED=BLOCKED
GOOGLE_CALENDARS_LISTED=PARTIAL

MICROSOFT_CONSENT_LIVE=NOT_EXECUTED
MICROSOFT_CALLBACK_LIVE=NOT_EXECUTED
MICROSOFT_FINALIZE_LIVE=NOT_EXECUTED
MICROSOFT_CONNECTION_PERSISTED=PASS
MICROSOFT_CALENDARS_LISTED=PASS

BOTH_PROVIDERS_CONNECTED=BLOCKED

SYNC_GOOGLE_TO_MICROSOFT=BLOCKED
SYNC_MICROSOFT_TO_GOOGLE=BLOCKED
SYNC_UPDATES=NOT_EXECUTED
SYNC_NO_DUPLICATION=NOT_EXECUTED
SYNC_NO_LOOP=NOT_EXECUTED
SYNC_RECOVERY=NOT_EXECUTED

STRIPE_TEST_CHECKOUT=PASS
STRIPE_TEST_WEBHOOK=PASS
STRIPE_TEST_ENTITLEMENT=PASS
STRIPE_TEST_CANCELATION=PARTIAL   # portal OK; DB flag não atualizada

EMAIL_DELIVERABILITY=BLOCKED
ONBOARDING_COMPLETE=PARTIAL

VITEST=PARTIAL
TYPECHECK=NOT_EXECUTED
SEC07=PASS
DEPLOY_SAFETY=PASS
REQUIRED_CI=PASS

STAGE_NO_UNEXPECTED_DRIFT=PARTIAL   # FE asset stale pós-#57; cancel flag drift
NO_PRODUCTION_MUTATION=PASS
FINAL_INDEPENDENT_AUDIT=PARTIAL

BOTH_STAGE_REAL_PROVIDER_E2E_CERTIFIED=PARTIAL
BOTH_STAGE_P0_E2E_CERTIFIED=PARTIAL
BETA_READY=NO
PRODUCTION_RELEASE_AUTHORIZED=NO
PRODUCTION_DEPLOY_EXECUTED=NO
```

---

## 24–25. Pendências e próximas ações

1. **PO:** completar consentimento Google no Chrome QA (popup aberta).
2. Após Google OK: selecionar calendários QA → sync G→M e M→G → update/dedup/anti-loop (volume mínimo).
3. Investigar webhook cancel (`cancel_at_period_end`) e FE promote STAGE pós-#57.
4. Retestar paywall trial em conta trial (entitled atual virou subscription Stripe Test).
5. Inbox e-mail QA autorizada.
6. Vitest completo + typecheck antes de nova certificação plena.

---

## 26. GO / NO-GO

| Decisão | Valor |
|---------|--------|
| STAGE real-provider E2E | **NO-GO** (Google + sync + email + cancel DB + FE stale) |
| STAGE P0 E2E completo | **NO-GO** / PARTIAL |
| Beta | **NO** |
| Production | **NO-GO** · sem deploy PROD |
