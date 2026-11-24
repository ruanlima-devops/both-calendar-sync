# Auditoria backend — develop vs PR #15

**Escopo truth:** `/Users/ruan/Documents/work12-overnight-sprint` @ `99e71b745fc59f97dd97efce8f7d5cf8fe2f0e9d` (`origin/develop`).  
**PR #15 head:** `78979549cad61438de751584a0ad895855781b8b` (somente leitura via `git diff`).  
**WIP glance:** `/Users/ruan/Documents/work12` @ `feat/m3-003-oauth-lifecycle` (ahead de PR#15 + hardening local não em develop).

Classificação: **OK** | **PARTIAL** | **GAP** | **BUG**

---

## 1. OAuth lifecycle (develop = truth)

| Subárea | Class | Notas |
|--------|-------|-------|
| Start (PKCE + state) | **PARTIAL** | `createOAuthState` em `supabase/functions/_shared/oauth.ts`; TTL 10m; redirect allowlist |
| State consume / replay | **BUG** | `consumeOAuthState` checa `used_at` mas **nunca grava** `used_at` — só `DELETE`; coluna de `20260819000003_oauth_state_used.sql` é morta |
| Callback → tokens | **GAP** | Callback **não autenticado** troca code e persiste connection/secrets (`google-oauth`, `microsoft-oauth`) |
| Ticket / client nonce | **GAP** | Ausente em develop (só em PR#15) |
| Refresh | **OK** | `getValidAccessToken` em `supabase/functions/_shared/sync/runtime.ts`; rotação de refresh; `AUTH_REQUIRED` |
| Reconnect | **PARTIAL** | Upsert por `(user_id, provider)` — 1 conta Google/MS; preserva refresh se provider não devolver novo |
| Disconnect | **PARTIAL** | `disconnect-calendar/index.ts`: para watches + revoke best-effort + delete; **não** aborta em transient; erro `UNAUTHENTICATED` se connection sumiu |
| Revocation | **PARTIAL** | Google revoke OK; Microsoft **skipped** (`oauth-revoke.ts`); iCloud N/A |
| Redirect safety | **BUG** | `pathname.includes('/oauth')` aceita paths frouxos; popup `postMessage(..., '*')` fallback |

**Fluxo develop:** `start` autenticado + entitlement → provider redirect → callback unauth → exchange + sync + watch → HTML/redirect com `connected=`.

---

## 2. Calendar sync

| Subárea | Class | Notas |
|--------|-------|-------|
| Bidirecional (mirror) | **OK** | Engine `applyIncomingEvent` + firewall; providers marcam `MIRROR`/`ORIGIN` |
| Anti-loop | **OK** | Role MIRROR não repropaga; abandonment key evita recriar |
| Idempotency jobs | **OK** | `sync_jobs` dedupe + follow-up; claim `pending→running` |
| Event upsert | **OK** | Por `providerEventId`; create-event com `clientEventId` |
| Conflicts | **PARTIAL** | last-write via sync; sem merge de conflitos de título |
| Delete cascade | **OK** | Origin delete → mirrors; mirror externo → abandoned |
| Recurrence | **PARTIAL** | Masters não espelhados (`recurring.ts`); occurrences OK; mutations series unsupported |
| Timezone / DST | **PARTIAL** | `dates.ts` `zonedDateTimeToUtc` + Graph wall-clock; Google all-day via `date` |
| All-day | **OK** | `allDayRange` exclusivo no fim |
| Permissions / reader | **OK** | Só writer/owner/editor como target; create checa `access_role` |
| Rate limits | **OK** | `http-retry.ts` (429/Retry-After); booking `api_rate_buckets` |
| Recovery | **PARTIAL** | Token inválido → full; DEGRADED + reconcile; iCloud backoff |
| Watches | **BUG** | `ensureWebhook`: Google **sem** `last_notification_at` recria canal (duplicata no connect) |
| Entitlement pause | **BUG** | `paused_by_entitlement` **escrito, nunca lido**; webhooks/`processSyncJob` syncam sem checar pause |

Arquivos-chave:  
`.../sync/engine.ts`, `runtime.ts`, `recurring.ts`, `dates.ts`, `abandonment.ts`, `providers/{google,microsoft}.ts`, `google-webhook`, `microsoft-webhook`, `reconcile-sync`, `renew-subscriptions`.

---

## 3. Stripe billing

| Subárea | Class | Notas |
|--------|-------|-------|
| Trial | **OK** | Trigger `initialize_user_subscription` (14d); `computeEntitlement` |
| Checkout | **OK** | `billing-checkout` + `stripe.createCheckoutSession`; metadata `user_id` |
| Portal | **OK** | `billing-portal` |
| Webhook signature | **PARTIAL** | HMAC + skew 300s; compare string **não** timing-safe |
| Webhook idempotency | **PARTIAL** | Unique `(provider, provider_event_id)` insert; sem claim/process/fail |
| Entitlement map | **PARTIAL** | `active`/`grace_period` retomam; `past_due` no apply **não** abre grace |
| `invoice.payment_failed` | **BUG** | Resolve user só via `metadata.user_id` — Invoice Stripe tipicamente **não** tem; grace morta |
| Cancel / expire | **PARTIAL** | `subscription.deleted` → expired + pause flag; trial expire no reconcile |
| Paywall gates | **PARTIAL** | Edge: `requireEntitlement` em OAuth/CRUD/sync-now; app `_layout` paywall; **push sync continua** pós-expire |
| RevenueCat | **PARTIAL** | Endpoint existe; store path separado |

---

## 4. Account deletion

| Class | Notas |
|-------|-------|
| **PARTIAL** | `delete-user.ts`: cancela jobs → stop watches (abort transient) → revoke BE → cascade → auth delete |
| **GAP** | Sem cancelamento Stripe customer/subscription |
| **GAP** | Microsoft revoke continua skipped |
| Disconnect develop ≠ delete rigor | Disconnect engole erros e apaga local mesmo assim |

---

## 5. RLS / security

| Item | Class | Path / nota |
|------|-------|-------------|
| Core tables RLS | **OK** | `20260819000001_init.sql` select/update own |
| `oauth_states` / `calendar_secrets` | **OK** | public + revoke anon/auth; só service_role (`oauth_public.sql`) |
| `billing_*` | **PARTIAL** | plans/subs OK; `billing_settings` RLS on + **grant select sem policy** (morto) |
| `profiles.plan_tier` | **GAP** | `profiles_update_own` permite update de **todas** colunas |
| `api_rate_buckets` / `availability_invalidations` | **GAP** | Sem RLS em develop (`scheduling_links.sql`) |
| `sync_jobs` | **OK** | RLS on, sem policy client (= deny) |
| Secrets em Edge | **OK** | admin client; tokens encrypt |
| Open redirect / postMessage | **BUG** | ver OAuth |

---

## 6. Observability

| Class | Notas |
|-------|-------|
| **PARTIAL** | `logSafe`, `sync_log`, `product_events`; webhooks logam canal |
| **PARTIAL** | `observability/alert-evaluator.ts` — parsers/alertas locais (SYN-05), não wiring prod de paging |
| **GAP** | Sem métricas de entitlement-pause efetivo; OAuth develop sem eventos ticket |

---

## 7. O que PR #15 adiciona que develop **não** tem

Commits: `8182b96` → `d7624c9` (OAuth) + 3 commits CI stage (`5d0673d`…`7897954`).

| Área | Delta PR#15 |
|------|-------------|
| Migration | `supabase/migrations/20261001000001_oauth_completion_ticket.sql` — `client_nonce_hash`, `ticket_hash`, `encrypted_code`, cron cleanup |
| OAuth core | Ticket single-use; callback **não** troca code; `finalizeOAuthConnection` exige user+nonce+ticket |
| Handlers | `google-oauth` / `microsoft-oauth` refactor start/callback/finalize |
| Client | `lib/oauth.ts`, `lib/oauth-complete.ts`, `app/oauth.tsx`, routing/session |
| Disconnect | `account/disconnect.ts` + testes; handler fino; cleanup compartilhado com delete |
| Watches | `sync/watch-policy.ts` + uso em `ensureWebhook` (anti-duplicata Google) |
| Tests | `oauth.test.ts`, `oauth-finalize.test.ts`, `disconnect.test.ts`, fake-db |
| CI/stage | `deploy-stage.yml`, `wrangler.jsonc`, `.node-version` |

**Não tratar PR#15 como verdade de develop.** Develop ainda completa OAuth no callback.

---

## 8. WIP glance (`/Users/ruan/Documents/work12`) — sem modificar

Além do conteúdo de PR#15:
- Migrations locais: `20261115000001_billing_webhook_hardening.sql`, `20261117000001_sec10_rls_profile_hardening.sql`
- Billing/webhook/entitlement reescritos; observability renomeada; docs STAGE OAuth/billing/delete
- Branch `feat/m3-003-oauth-lifecycle` ahead 1 (`f2cf6c1` docs)

Não está em `origin/develop`.

---

## 9. Bugs/gaps determinísticos (fixáveis offline)

| ID | Sev | Área | Problema | Path(s) |
|----|-----|------|----------|---------|
| D1 | P1 | OAuth | `used_at` nunca setado; anti-replay incompleto / TOCTOU no consume | `supabase/functions/_shared/oauth.ts`, `migrations/20260819000003_oauth_state_used.sql` |
| D2 | P1 | OAuth | Callback unauth completa connection (session fixation / tab hijack class) | `google-oauth/index.ts`, `microsoft-oauth/index.ts` |
| D3 | P2 | OAuth | `pathOk` via `includes('/oauth')` | `_shared/oauth.ts` `assertSafeAppRedirect` |
| D4 | P2 | OAuth | `postMessage` fallback `'*'` | `_shared/oauth.ts` `oauthResultPage` |
| D5 | P1 | Sync/Billing | `paused_by_entitlement` nunca consultado; push sync pós-expire | `entitlement.ts`, `runtime.ts` `processSyncJob`, `google-webhook`, `microsoft-webhook` |
| D6 | P2 | Sync | Google watch recriado se sem `last_notification_at` | `runtime.ts` `ensureWebhook` (~755–766) |
| D7 | P1 | Billing | `invoice.payment_failed` não resolve user (só metadata) | `billing-webhook/index.ts` |
| D8 | P2 | Billing | `past_due` via subscription.updated → revoke imediato sem grace | `webhook-handler.ts` `applyStripeSubscription` |
| D9 | P2 | Billing | Signature verify não constant-time | `billing/stripe.ts` `verifyWebhookSignature` |
| D10 | P2 | Disconnect | Transient provider → apaga credentials/local mesmo assim | `disconnect-calendar/index.ts` |
| D11 | P2 | Disconnect | Connection missing → `UNAUTHENTICATED` (401) | `disconnect-calendar/index.ts` |
| D12 | P2 | Delete | Sem cancel Stripe ao deletar conta | `account/delete-user.ts` |
| D13 | P2 | RLS | `profiles` client pode atualizar `plan_tier` | `migrations/...init.sql` policies |
| D14 | P2 | RLS | `api_rate_buckets` / `availability_invalidations` sem RLS | `migrations/20260819000009_scheduling_links.sql` |
| D15 | P3 | OAuth/MS | Microsoft revoke sempre `skipped` | `account/oauth-revoke.ts` |
| D16 | P3 | OAuth | MS: falha pós-connect de calendários ainda retorna success | `microsoft-oauth/index.ts` |
| D17 | P3 | HTTP | `ENTITLEMENT_REQUIRED` → 400 genérico | `_shared/function.ts` `handle` |
| D18 | P3 | Billing | `billing_settings` grant sem policy | `migrations/20260819000007_billing.sql` |

Itens **já endereçados em PR#15** (não mergeados): D2 (ticket), D6 (watch-policy), D10 (disconnect compartilhado).  
Itens **só no WIP**: D7/D8 hardening billing, D13/D14 SEC-10.

---

## 10. Matriz resumo (develop)

| Domínio | Veredito |
|---------|----------|
| OAuth lifecycle | **GAP/BUG** — funcional, inseguro no callback; sem ticket |
| Calendar sync | **PARTIAL** — engine forte; pause/watch gaps |
| Stripe billing | **PARTIAL** — trial/checkout OK; webhook grace frágil |
| Account deletion | **PARTIAL** — cleanup externo bom; Stripe/MS revoke fracos |
| RLS/security | **PARTIAL** — base OK; profiles/plan_tier + tabelas internas |
| Observability | **PARTIAL** — logs/sync_log; alertas inertes |

**Recomendação docs:** documentar develop como “callback completes connection”; marcar PR#15 como “app-mediated finalize”; listar D5/D7 como riscos de entitlement real; não copiar PR#15 para STAGE sem migration `20261001000001` + client nonce.