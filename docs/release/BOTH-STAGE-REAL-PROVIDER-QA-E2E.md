# BOTH — STAGE Real Provider QA + P0 E2E Closure

**Baseline UTC:** `2026-11-26T01:59:56Z` → resume close `2026-11-26T02:35:00Z`  
**Repo:** `ruanlima-devops/both-calendar-sync`  
**Environment:** STAGE only (`https://stage.bothcalendar.com` / Supabase `qszggrrjhcwltnmxpxcy`)  
**PROD:** not touched · **Stripe Live:** not used · **Secrets/JWT/cookies:** omitted  
**Synthetic run id:** `BOTHQA20261126022819`

---

## 1. Resumo executivo

Após consentimento Google do PO, a sessão Chrome QA foi revalidada: **Google e Microsoft CONNECTED** na mesma conta QA (`bothcalendartest@gmail.com` / hotmail), sem `token_refresh_failed`, entitlement Stripe **Ativo**. Sync bidirecional real demonstrado via eventos sintéticos + mirrors no destino (não só HTTP 200). Dedup / anti-loop / update de horário **PASS**. Stripe cancelamento no portal permanece **PARTIAL** (UI ok; `cancel_at_period_end` ainda `false` no DB). E-mail inbox **BLOCKED**. SEC-07 **PASS**.

**Decisão:** `BOTH_STAGE_REAL_PROVIDER_E2E_CERTIFIED=PASS` · `BOTH_STAGE_P0_E2E_CERTIFIED=PARTIAL` · `BETA_READY=NO` · `PRODUCTION_RELEASE_AUTHORIZED=NO` · `PRODUCTION_DEPLOY_EXECUTED=NO`.

---

## 2. Baseline

| Item | Valor |
|------|--------|
| develop HEAD | `f4d8959` (merge #58) |
| Frontend STAGE | `entry-6ef4d8c866c13d63a351c0e61a14586c.js` |
| Supabase STAGE | `qszggrrjhcwltnmxpxcy` |
| Legado | `sknpqjodttkpttaytdut` — não usado |
| SEC-07 | `sync-calendar` → **410** `SYNC_CALENDAR_DEPRECATED` |
| Sync engine | `sync-now` + webhooks + `reconcile-sync` |
| PR #15 | OPEN (preservado) |
| Issues #26 / #30 | #26 OPEN · #30 CLOSED (não alterados) |
| PRs desta sprint | #57 paywall trial · #58 report (merged) |

---

## 3. Browser QA

- Chrome QA `chrome-qa-entitled`, CDP `127.0.0.1:9222`.
- Sessão Both Test; popup Google fechada após consentimento PO.
- Console: sem erros críticos sanitizados observados no reteste.

---

## 4. Interações humanas

| Checkpoint | Status |
|------------|--------|
| Google login/consent QA | **COMPLETED_BY_PO** — resultado verificado na app (não assumido) |
| E-mail inbox QA | **BLOCKED** (sem caixa autorizada) |

---

## 5–6. Google / Microsoft OAuth (pós-consent)

| Gate | Resultado | Evidência |
|------|-----------|-----------|
| GOOGLE_CONSENT | COMPLETED_BY_PO | Popup Google ausente |
| GOOGLE_CALLBACK / FINALIZE | **PASS** (inferido por conexão persistida) | UI + REST `calendar_connections` |
| GOOGLE_CONNECTION_PERSISTED | **PASS** | `status=CONNECTED`, `last_sync_error=null`, sync ~`02:25Z` |
| GOOGLE_TOKEN_REFRESH | **PASS** | `token_refresh_failed` ausente pós-reconnect |
| GOOGLE_CALENDARS_LISTED | **PASS** | primary `bothcalendartest@gmail.com` enabled writer |
| MICROSOFT_CONNECTION_PERSISTED | **PASS** | `CONNECTED`, hotmail QA |
| MICROSOFT_CALENDARS_LISTED | **PASS** | `Calendário` enabled writer |
| BOTH_PROVIDERS_CONNECTED | **PASS** | Mesmo `user_id` prefix `1ed00131…` |
| Persistência pós-refresh | **PASS** | Ambos Conectado após reload |
| ACTIVE_ENTITLEMENT | **PASS** | Stripe · Status Ativo |

---

## 7. Gate de sync (pré-evento)

| Requisito | Status |
|-----------|--------|
| Contas QA dedicadas | PASS |
| Calendários isolados enabled writer (G+MS) | PASS |
| Entitlement active | PASS |
| Engine sync-now (não sync-calendar) | PASS |
| SEC-07 tombstone | PASS |
| Prefixo sintético + volume mínimo | PASS (`BOTHQA20261126022819`, ≤3 origins) |

---

## 8–10. Sync bidirecional / dedup / updates

### Google → Microsoft (`…-G2M` → `…-G2M-UPD`)

| | |
|--|--|
| ORIGIN | Google · título sintético · all-day |
| MIRROR | Microsoft `Calendário` · `Horário reservado · Both` (privacidade firewall) |
| Contagem | 1 ORIGIN + 1 MIRROR |
| Re-sync ×2 | **DEDUP_OK** — continua 1 mirror |
| Update título | ORIGIN → `…-G2M-UPD`; mirror permanece 1 |

### Microsoft → Google (`…-M2G-REAL`)

| | |
|--|--|
| ORIGIN | Microsoft · `17:00–17:30` UTC |
| MIRROR | Google · mesmos timestamps · `Horário reservado · Both` |
| `M2G_PASS` | **true** |

### Update de horário (anti-loop)

| | |
|--|--|
| ORIGIN MS end | `17:30` → `18:00` |
| MIRROR Google end | `18:00` (**TIMES_MATCH**) |
| Mirrors após sync | 1 (**NO_LOOP**) |

**Nota:** espelhos usam título busy privado por design; prova de sync = presença + timestamps no provider destino, não cópia literal do título origem.

| Gate | Resultado |
|------|-----------|
| SYNC_GOOGLE_TO_MICROSOFT | **PASS** |
| SYNC_MICROSOFT_TO_GOOGLE | **PASS** |
| SYNC_UPDATES | **PASS** |
| SYNC_NO_DUPLICATION | **PASS** |
| SYNC_NO_LOOP | **PASS** |

---

## 11–13. Stripe / trial / e-mail

| Item | Resultado |
|------|-----------|
| Checkout + webhook + entitlement | **PASS** (rodada anterior) |
| Portal cancel UI | **PASS** (histórico: cancela fim do período) |
| `cancel_at_period_end` no DB | **FAIL / PARTIAL** — ainda `false`; `last_stripe_event_at=2026-11-26T02:07:29Z` |
| Paywall trial UI (#57) | Corrigido no código; asset STAGE ainda antigo |
| EMAIL_DELIVERABILITY | **BLOCKED** |

**Hipótese cancel DB:** webhook `customer.subscription.updated` pode ter aplicado payload sem `cancel_at_period_end=true`, ou evento posterior sobrescreveu; não há evidência de mutação manual. Correção = mapear/`reconcile` Stripe Test + teste de webhook — aberto como P1/P0 billing.

---

## 14–16. Bugs / correções / PRs

| ID | Sev | Status |
|----|-----|--------|
| P0-PAYWALL-TRIAL | P0 | **FIXED** #57 |
| P0-GOOGLE-TOKEN | P0 ops | **RESOLVED** pós-consent (CONNECTED) |
| P0/P1-CANCEL-FLAG | P0/P1 | **OPEN** |
| FE-STAGE-STALE | P1 | **OPEN** (`entry-6ef4d8…` pós-#57) |

---

## 17–22. Deploys / CI / segurança

| Gate | Resultado |
|------|-----------|
| SEC07 | **PASS** |
| DEPLOY_SAFETY (#57 SAFE_SKIP) | **PASS** |
| REQUIRED_CI | **PASS** (#57/#58) |
| NO_PRODUCTION_MUTATION | **PASS** |
| Token leakage | Não observado |
| Cross-user connections | Mesmo user QA |

---

## 23. Gates finais

```
CHROME_QA=PASS
GOOGLE_CALLBACK_LIVE=PASS
GOOGLE_FINALIZE_LIVE=PASS
GOOGLE_REFRESH=PASS
GOOGLE_CONNECTED=PASS
MICROSOFT_CONNECTED=PASS
BOTH_PROVIDERS_CONNECTED=PASS

SYNC_GOOGLE_TO_MICROSOFT=PASS
SYNC_MICROSOFT_TO_GOOGLE=PASS
SYNC_UPDATES=PASS
SYNC_NO_DUPLICATION=PASS
SYNC_NO_LOOP=PASS

STRIPE_CANCELATION_DB=PARTIAL
EMAIL_DELIVERABILITY=BLOCKED
SEC07=PASS
DEPLOY_SAFETY=PASS
NO_PRODUCTION_MUTATION=PASS

BOTH_STAGE_REAL_PROVIDER_E2E_CERTIFIED=PASS
BOTH_STAGE_P0_E2E_CERTIFIED=PARTIAL
BETA_READY=NO
PRODUCTION_RELEASE_AUTHORIZED=NO
PRODUCTION_DEPLOY_EXECUTED=NO
```

---

## 24–26. Pendências / GO-NO-GO

1. Corrigir persistência `cancel_at_period_end` (webhook/reconcile Stripe Test).  
2. Confirmar promote FE STAGE do #57 (paywall trial).  
3. Inbox e-mail QA.  
4. Vitest/typecheck full opcional antes de beta.

| Decisão | Valor |
|---------|--------|
| Real-provider E2E (OAuth+sync bidirecional) | **GO (STAGE cert PASS)** |
| P0 E2E completo | **NO-GO / PARTIAL** (email + cancel DB + FE stale) |
| Beta / Production | **NO** |
