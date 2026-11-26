# Both — STAGE P0 Functional Validation & MVP Completion E2E

**UTC start baseline:** 2026-11-26T01:17:42Z  
**Mode:** STAGE only · PROD forbidden · fail-closed · no invented PASS  
**Supabase STAGE:** `qszggrrjhcwltnmxpxcy`  
**Frontend:** https://stage.bothcalendar.com

---

## 01. Resumo executivo

Revalidação P0 em STAGE comprovou partes críticas do produto **reais**, não só publicação:

| Frente | Resultado |
|--------|-----------|
| Frontend publicado | PASS (republish pós-#55) |
| Signup API + trial 14d automático | **PASS_STAGE_REAL** |
| Login sessão (QA nativo + sintético confirmado) | **PASS_STAGE_REAL** |
| Confirmação de e-mail via inbox | **BLOCKED** (sem caixa autorizada; rate-limit Resend) |
| OAuth start Google/Microsoft (JWT+nonce+redirect) | **PASS_STAGE_REAL** |
| OAuth consent/finalize live | **BLOCKED** — `NEEDS_HUMAN_ACTION` (QA Chrome consent) |
| Sync engine identificado | `sync-now` + webhooks + `reconcile-sync` (**não** `sync-calendar` tombstone) |
| Sync G↔M live | **NOT_EXECUTED** (sem connections QA) |
| Stripe Test checkout URL | **PASS_STAGE_REAL** (`checkout.stripe.com`) |
| Entitlement (expired bloqueia sync) | **PASS_STAGE_REAL** |
| Bug UX Google busy no email auth | **FIXED** (#55) + frontend republished |

**BOTH_STAGE_P0_E2E_CERTIFIED=PARTIAL**  
**BETA_READY=NO** · **PRODUCTION_RELEASE_AUTHORIZED=NO** · **PRODUCTION_DEPLOY_EXECUTED=NO**

---

## 02. Baseline inicial

| Item | Valor |
|------|-------|
| develop HEAD | `49a8b147961daaaebd3ab01dbfaf9f2bf2e4a9ef` |
| Frontend asset | `entry-878a48c53b664f983e4b9f7ae8268256.js` |
| Worker | `64b2e988-e73b-4c23-a57a-7be8f47d6846` |
| Gate `DEPLOY_SAFETY_ALLOW_CANDIDATE` | `0` |
| PR #15 | OPEN (preservado) |
| PR #46 | MERGED (histórico; sem re-merge) |
| work12 local | branch suja #15 — **não modificada**; trabalho em worktree `cert/stage-p0-functional` |

---

## 03. STAGE final

| Item | Valor |
|------|-------|
| develop HEAD | `ef3f171…` (Merge #55) |
| Frontend asset | `entry-6ef4d8c866c13d63a351c0e61a14586c.js` |
| Worker Version ID | `1e779e44-3ba9-4ac6-8c84-db0738e91245` |
| Title | Both STG |
| Bundle Supabase ref | `qszggrrjhcwltnmxpxcy` |
| Release gate | `0` |

---

## 04–06. Auth / e-mail / trial

### Signup
- API Auth signup → `confirmation_sent_at` set, **sem sessão** até confirm (`mailer_autoconfirm=false`).
- Login antes de confirm → `email_not_confirmed` (**PASS_STAGE_REAL**).
- Browser signup UI: formulário + política de senha + erro rate-limit **“Muitas tentativas…”** observado.
- Bug: botão Google mostrava “Conectando ao Google…” durante submit e-mail → **#55**.

### E-mail
- `EMAIL_CONFIRMATION_STAGE=BLOCKED` — sem acesso a inbox autorizada para `@bothcalendar.test` / Resend.
- Resend/recover → `over_email_send_rate_limit` sob carga de teste.
- Admin confirm usado **somente** em usuário sintético próprio para desbloquear login/trial audit — **não** substitui prova de deliverability.

### Trial 14d
- Trigger `initialize_user_subscription` na criação de `profiles`.
- Usuário sintético novo: `status=trialing`, `plan_id=unify_pro`, `billing_provider=internal`, **14 dias** exatos.
- QA nativo: trial ativo até 2026-12-01.
- QA expired: `status=expired`; `sync-now` → `ENTITLEMENT_REQUIRED`.

`TRIAL_14D_STAGE=PASS_STAGE_REAL` (criação + enforcement expired).  
Expiração temporal artificial em STAGE: `PASS_LOCAL_ONLY` / fixture hist (não reexecutada aqui).

### Login / sessão
- QA native-auth password login **PASS**.
- Logout HTTP 204 **PASS**.
- Sintético pós-admin-confirm login **PASS**.

---

## 07–08. Google / Microsoft OAuth

### Auditado em STAGE
- Start autenticado exige `client_nonce` + redirect allowlisted (`https://stage.bothcalendar.com/oauth`).
- Default redirect sem body falha se `APP_URL` Edge ≠ allowlist (FE envia redirect — OK).
- Google authorize URL: `accounts.google.com` + PKCE/state (**PASS_STAGE_REAL** initiation).
- Microsoft authorize URL: `login.microsoftonline.com/common` (**PASS_STAGE_REAL** initiation).
- JWT inválido → 401.
- Finalize ticket inválido → 403 `invalid_ticket`.

### Live consent / finalize / calendars
**BLOCKED — NEEDS_HUMAN_ACTION**

Instruções PO (mínimas):
1. Abrir Chrome QA `test-engine/fixtures/local/chrome-qa-entitled` (ou login Both QA nativo em STAGE).
2. Em `/calendars` ou onboarding: Conectar Google → consent conta QA dedicada.
3. Repetir Microsoft com conta QA dedicada.
4. Confirmar `calendar_connections` + calendários listados.
5. Sem MFA bypass; sem conta pessoal.

---

## 09–10. Onboarding / calendars

- QA nativo: `onboarding_completed_at` preenchido; **0** connections atuais.
- Onboarding E2E completo com providers: **PARTIAL/BLOCKED** (depende OAuth live).

---

## 11–13. Sync

### Arquitetura ATUAL (não tombstone)
- **Ativo:** `sync-now` → `_shared/sync/runtime.syncConnectedCalendar` + `ensureEnabledWatches`.
- **Ingresso:** `google-webhook`, `microsoft-webhook` (entitlement gate; catch-up via reconcile/sync-now).
- **Catch-up:** `reconcile-sync`.
- **SEC-07:** `sync-calendar` permanece tombstone (`sec07_tombstone_ok`).

### Live G↔M
**NOT_EXECUTED** — sem calendários conectados na QA disponível.  
Não criar eventos em contas reais sem connections.

`SYNC_*=NOT_EXECUTED` / engine presence **PASS** via `sync-now` 200 `{synced:0}` com trial ativo.

---

## 14–17. Stripe / entitlement / paywall

- `billing-checkout` (trialing) → URL `checkout.stripe.com` (**PASS_STAGE_REAL** initiation Test).
- Expired também obtém URL checkout (caminho paywall→upgrade) — esperado.
- `billing-webhook` sem assinatura → `INVALID_SIGNATURE`.
- Checkout session complete / webhook apply / grace / cancel: **NOT_EXECUTED** (sem cartão Test + fluxo UI completo nesta janela).
- Locals: Vitest billing 151 subset + full **830 PASS**.

Paywall route: protegida (redirect login sem sessão) — **PARTIAL**.

---

## 18–20. Bugs / correções / PRs

| BUG_ID | FEATURE | SEV | ACTUAL | FIX | PR | RETEST |
|--------|---------|-----|--------|-----|----|--------|
| P0-AUTH-GOOGLE-BUSY | Auth UI | P1→fixed | Google label during email submit | `busy={googleBusy}` | #55 | Frontend republished `1e779e44` |

### Merges esta execução
- #55 `fix(auth): Google busy label only during Google sign-in` → `ef3f171`

### Releases STAGE
- Wrangler deploy Worker `1e779e44-3ba9-4ac6-8c84-db0738e91245`
- Asset `entry-6ef4d8c866c13d63a351c0e61a14586c.js`
- Sem mutação Supabase necessária (SAFE_SKIP esperado no Deploy STAGE do #55)

---

## 21–26. Testes / segurança / Deploy Safety / SEC-07

| Suite | Result |
|-------|--------|
| Vitest full (develop tip) | **830 PASS** / 73 files |
| Auth+billing targeted | 151 PASS |
| Playwright STAGE suite | NOT_EXECUTED (API+browser MCP smoke) |
| SEC-07 | PASS |
| Deploy Safety #55 | SAFE_SKIP |
| Required CI #55 | Application+Supabase PASS |
| OAuth CSRF negatives (ticket/JWT) | PASS_STAGE_REAL parciais |
| Cross-user OAuth live | NOT_EXECUTED |

---

## 27. Observability

SYN-05 OFF. Sem ativação. Erros auth/OAuth/Stripe observáveis via HTTP nesta sessão.

---

## 28. Features ainda pendentes (P0)

1. Inbox/e-mail confirmation deliverability autorizada.  
2. Consent Google+Microsoft QA + connections persistidas.  
3. Sync bidirecional em calendários QA isolados.  
4. Stripe Test checkout complete + webhook entitlement cycle.  
5. Onboarding E2E com ambos providers.

---

## 29. Próximas decisões PO

1. Disponibilizar caixa de teste / bypass controlado só para domínio sintético, **ou** confirmar e-mails QA via fluxo humano.  
2. Sessão Chrome QA entitled para OAuth live (passos §07).  
3. Autorizar janela Stripe Test checkout com cartão de teste oficial (sem live).  
4. Não reativar `sync-calendar` legado.

---

## 30. GO/NO-GO

**GO parcial para confiança STAGE Auth/Trial/OAuth-init/Entitlement/Stripe-init.**  
**NO-GO** para certificação P0 E2E completa e beta.

`BOTH_STAGE_P0_E2E_CERTIFIED=PARTIAL`
