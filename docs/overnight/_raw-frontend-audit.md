# Auditoria produto UI A–AV — Both Calendar Sync

**Baseline:** `origin/develop` @ `99e71b7` (via `git show` / `git grep`)  
**WIP (somente leitura):** `/Users/ruan/Documents/work12` `feat/m3-003-oauth-lifecycle` @ `f2cf6c1` + working tree dirty  
**Overnight:** `/Users/ruan/Documents/work12-overnight-sprint` — **não está limpo**; já tem cópia suja de auth WIP (`login`/`sign-up`/`forgot-password`/…). **Não use o working tree overnight como develop.**

**Legenda:** classificação relativa ao **produto web 1.0**. `IMPLEMENTED_VERIFIED` exige código **em develop** + teste local que cobre o comportamento. E2E STAGE não foi reexecutado nesta auditoria.

**WIP significativo:**  
- **Commitado no branch:** OAuth ticket/nonce/finalize, `confirmAction` no disconnect, helpers de onboarding, testes OAuth.  
- **Só dirty/untracked:** email/senha, forgot/update password, `entitlement-gate`, `paywall-params`, `+not-found` PT, “Alterar senha” em settings.

---

## Matriz A–AV

### Auth / sessão / recovery

| ID | Área | Classificação (develop) | Paths (develop) | Testes | Evidência | Deps | Severidade | Effort | Risco | Prioridade | Offline? | Recomendação |
|----|------|-------------------------|-----------------|--------|-----------|------|------------|--------|-------|------------|----------|--------------|
| **A** | Login e-mail/senha | **MISSING** | — (WIP: `app/(auth)/login.tsx`, `lib/auth/email-password.ts`) | WIP: policy/errors unit; Playwright `login-email` | Develop: só Google/Apple | Supabase Auth Email | Alta | M | Médio | P0 | Sim (UI+unit) | Portar WIP dirty → develop |
| **B** | Login Google (Auth) | **IMPLEMENTED_UNVERIFIED** | `lib/auth/google.ts`, `hooks/useGoogleAuth`, `GoogleSignInButton.tsx`, `app/auth/callback.tsx` | Sem unit de fluxo; smoke STAGE histórico | `signInWithOAuth` + callback | Consoles OAuth | Alta | S | Baixo | P1 | Parcial | Manter; regressão com password |
| **C** | Login Apple | **POST_LAUNCH_CANDIDATE** (web N/A) | `lib/auth/apple.ts` — `Platform.OS !== 'ios' → false` | — | Botão só iOS | Apple Dev | Baixa (web) | — | — | P3 | Sim | Fora do launch web |
| **D** | Sign-up e-mail/senha | **MISSING** | Develop `sign-up.tsx`: *“Cadastro com e-mail chega em breve”* | WIP: unit + Playwright signup | Só Google no develop | Auth Email+SMTP | Alta | M | Médio | P0 | Sim (UI+unit) | Portar WIP; SMTP STAGE = BLOCKED E2E |
| **E** | Confirm e-mail UI | **MISSING** | WIP: `app/(auth)/confirm-email.tsx` | WIP unit/resend cooldown | Ausente em develop | SMTP | Alta | S | Médio | P0 | Sim (UI) | Portar + resend |
| **F** | Forgot password | **MISSING** | WIP: `forgot-password.tsx` | WIP unit | Sem rota em develop | SMTP | Alta | S | Médio | P0 | Sim (UI) | Portar |
| **G** | Update password / recovery callback | **MISSING** / **PARTIAL** callback | Develop `callback.tsx` só sessão OAuth; WIP: `update-password.tsx` + `callback` recovery | WIP: `callback.flow.test.ts` | Recovery não roteado em develop | Auth templates | Alta | M | Alto | P0 | Sim (unit+UI) | Portar routing recovery |
| **H** | Sessão / restore | **IMPLEMENTED_UNVERIFIED** | `context/session.tsx`, `lib/auth/storage.ts` | — | `getSession` + SecureStore/AsyncStorage | — | Alta | — | Baixo | P1 | Sim | Unit de hydrate opcional |
| **I** | Sign-out | **IMPLEMENTED_UNVERIFIED** | `settings.tsx` → `supabase.auth.signOut()` | Auth UI B–E BLOCKED sem QA | Botão “Sair” | — | Média | S | Baixo | P2 | Sim | Smoke local |
| **J** | Guards auth/onboarding | **IMPLEMENTED_UNVERIFIED** | `lib/auth/routing.ts`, layouts `(auth)`/`(onboarding)`/`(app)` | WIP: `routing.test.ts` (não em develop) | `destinationForSession` | Profile row | Alta | S | Baixo | P1 | Sim | Trazer `routing.test.ts` |

### Onboarding

| ID | Área | Class. | Paths | Testes | Evidência | Deps | Sev. | Eff. | Risco | Pri. | Offline? | Rec. |
|----|------|--------|-------|--------|-----------|------|------|------|-------|------|----------|------|
| **K** | Nome + tema visual | **IMPLEMENTED_UNVERIFIED** | `app/(onboarding)/index.tsx` step 0 | — | Update `profiles.visual_theme`/`display_name` | Profile | Média | — | Baixo | P1 | Sim | A11y labels no `TextInput` |
| **L** | Timezone no onboarding | **MISSING** (step dedicado) | Timezone só em settings + auto `SIGNED_IN` | — | Sem passo TZ no onboarding | — | Média | S | Baixo | P2 | Sim | Opcional: step ou copy |
| **M** | Connect Google/MS no onboarding | **PARTIAL** | `(onboarding)/index.tsx` | — | Develop: `Alert.alert` no erro (**no-op web** — `lib/confirm.ts`) | OAuth calendário | Alta | S | Alto (web) | **P0** | Sim | Usar `showMessage` (WIP já faz) |
| **N** | Seleção calendários (step 3) | **PARTIAL** | onboarding step 2; WIP: `lib/onboarding/calendar-step.ts` | WIP: `calendar-step.test.ts` | Skip connect → lista vazia, sem empty state | Connections | Média | S | Médio | P1 | Sim | EmptyState + reload (WIP parcial) |
| **O** | `onboarding_completed_at` + gate | **IMPLEMENTED_UNVERIFIED** | onboarding `finish()` + `routing.ts` | — | Redirect para tabs | — | Alta | — | Baixo | P1 | Sim | E2E conta nova = remoto |

### OAuth calendário / conexão UX

| ID | Área | Class. | Paths | Testes | Evidência | Deps | Sev. | Eff. | Risco | Pri. | Offline? | Rec. |
|----|------|--------|-------|--------|-----------|------|------|------|-------|------|----------|------|
| **P** | Connect Google Calendar | **IMPLEMENTED_UNVERIFIED** | `calendars.tsx`, `lib/oauth.ts` (legado develop) | `oauth-redirect.test.ts` | Popup web + `connected=` | Edge `google-oauth` | Alta | — | Médio | P0* | Não (consent) | *Merge M3-003 ticket (WIP) |
| **Q** | Connect Microsoft | **IMPLEMENTED_UNVERIFIED** | idem | idem | idem | `microsoft-oauth` | Alta | — | Médio | P0* | Não | Idem |
| **R** | Connect iCloud | **IMPLEMENTED_UNVERIFIED** | Modal iCloud + `icloud-connect` | — | App-specific password UX | Edge iCloud | Média | — | Médio | P2 | Parcial | Manter; Alert→showMessage |
| **S** | OAuth complete UX | **PARTIAL** | Develop `app/oauth.tsx` (`connected`/`oauth_error`); WIP: `oauth_ticket`+`finalizeCalendarOAuth` | WIP: `oauth-complete.test.ts` | Develop **sem** ticket/nonce | Backend M3-003 | Alta | M | Alto | **P0** | Unit sim | Não lançar web com fluxo legado |
| **T** | Status CONNECTED/SYNCING/AUTH_REQUIRED | **IMPLEMENTED_UNVERIFIED** | `calendars.tsx` `statusLabel` | — | UI + cores | DB connections | Média | — | Baixo | P1 | Sim | — |
| **U** | Disconnect UX | **PARTIAL** | Develop: `Alert.alert` confirm; WIP: `confirmAction` | WIP: disconnect QA helpers | **Web: confirm/error silenciosos** | `disconnect-calendar` | Alta | S | **Alto** | **P0** | Sim | Portar `confirmAction` do WIP |
| **V** | Reconnect AUTH_REQUIRED | **IMPLEMENTED_UNVERIFIED** | botão Reconectar em calendars | — | Re-chama `connect` / iCloud | OAuth | Alta | — | Médio | P1 | Não | Smoke pós-fix U |

### Seleção / dashboard

| ID | Área | Class. | Paths | Testes | Evidência | Deps | Sev. | Eff. | Risco | Pri. | Offline? | Rec. |
|----|------|--------|-------|--------|-----------|------|------|------|-------|------|----------|------|
| **W** | Página Calendários | **IMPLEMENTED_UNVERIFIED** | `app/(app)/(tabs)/calendars.tsx` | — | Connect + lista + sync | — | Alta | — | Baixo | P1 | Sim | Loading inicial ausente |
| **X** | Enable/disable calendário | **IMPLEMENTED_UNVERIFIED** | toggle `connected_calendars.enabled` | WIP lifecycle tests | Pressable Visível/Oculto | — | Alta | — | Baixo | P1 | Sim | Unit toggle (onboarding helpers) |
| **Y** | Filtro sidebar agenda | **IMPLEMENTED_UNVERIFIED** | `CalendarSidebar.tsx` (checkbox a11y) | — | Wide layout ≥960 | — | Média | — | Baixo | P2 | Sim | — |
| **Z** | Agenda Dia | **IMPLEMENTED_UNVERIFIED** | `index.tsx` + `DayAgenda.tsx` | `lib/calendar/ranges.test.ts` | DayAgenda mobile; grid tablet | Events | Alta | — | Baixo | P1 | Sim | — |
| **AA** | Agenda Semana | **IMPLEMENTED_UNVERIFIED** | `TimeGrid` week | ranges tests | Default `view=week` | — | Alta | — | Baixo | P1 | Sim | — |
| **AB** | Agenda Mês | **IMPLEMENTED_UNVERIFIED** | `MonthView.tsx` | — | + modal “more” | — | Média | — | Baixo | P2 | Sim | — |
| **AC** | Criar/abrir evento | **IMPLEMENTED_UNVERIFIED** | FAB + `event/new`, `event/[id]` | `events/create.test.ts` | Navegação com query | — | Alta | — | Baixo | P1 | Sim | — |

### Settings / delete / paywall

| ID | Área | Class. | Paths | Testes | Evidência | Deps | Sev. | Eff. | Risco | Pri. | Offline? | Rec. |
|----|------|--------|-------|--------|-----------|------|------|------|-------|------|----------|------|
| **AD** | Settings perfil/TZ/tema | **IMPLEMENTED_UNVERIFIED** | `settings.tsx` | — | Nome, TZ (40), color_scheme, visual_theme | — | Média | — | Baixo | P1 | Sim | — |
| **AE** | Billing portal / manage sub | **IMPLEMENTED_UNVERIFIED** | settings + `openBillingPortal` | entitlement unit | Stripe portal / store URLs | Stripe | Alta | — | Médio | P1 | Não | — |
| **AF** | Alterar senha (settings) | **MISSING** | WIP button → `/auth/update-password` | — | Ausente develop | Password auth | Média | S | Baixo | P1 | Sim | Após A/G |
| **AG** | Delete na settings | **IMPLEMENTED_VERIFIED** (lib) / **UNVERIFIED** (UI) | `confirmAndDeleteAccount`, settings danger card | `lib/account/delete-account.test.ts` | Confirm + edge | `delete-account` fn | Alta | — | Médio | P1 | Unit sim | UI web OK via `confirmAction` |
| **AH** | Delete tipado `/delete-account` | **IMPLEMENTED_VERIFIED** (lib+UI) | `app/delete-account.tsx`, `DELETE_ACCOUNT_CONFIRM_WORD` | delete-account.test | Frase tipada | Edge | Alta | — | Médio | P1 | Unit sim | E2E = remoto |
| **AI** | Paywall preço/copy | **IMPLEMENTED_UNVERIFIED** | `paywall.tsx`, `fetchBillingPlan` | WIP expired Playwright (BLOCKED sem session) | Both Pro + features; preço API | Stripe price | Alta | — | Baixo | P1 | Parcial | Fixtures preço mock |
| **AJ** | CTA checkout Stripe/web | **IMPLEMENTED_UNVERIFIED** | `startCheckout` + WebBrowser | — | Ramo `!native` | Stripe | Alta | — | Médio | P1 | Não | — |
| **AK** | Checkout cancelado UX | **PARTIAL** | Develop: `params.canceled` só limpa error; WIP: `paywall-params.ts` msg PT | WIP: `paywall-params.test.ts` | Sem mensagem ao usuário em develop | — | Média | S | Baixo | **P1** | Sim | Portar notice |
| **AL** | Entitlement gate / expired | **IMPLEMENTED_UNVERIFIED** | `(app)/_layout.tsx` EntitlementGate | WIP: `entitlement-gate.test.ts`; develop: `entitlement.test.ts` | Redirect paywall se `!hasAccess` | Trial/sub | Alta | S | Médio | P1 | Sim | Trazer gate puro+test |

### Estados / a11y / responsivo

| ID | Área | Class. | Paths | Testes | Evidência | Deps | Sev. | Eff. | Risco | Pri. | Offline? | Rec. |
|----|------|--------|-------|--------|-----------|------|------|------|-------|------|----------|------|
| **AM** | Loading states | **PARTIAL** | `SessionSplash`, paywall spinner, button loading | — | **Sem** loading inicial em agenda/calendars list | — | Média | S | Baixo | P1 | Sim | Skeleton/splash na 1ª fetch |
| **AN** | Error boundary | **IMPLEMENTED_UNVERIFIED** | `AppErrorBoundary` no `_layout` | — | Retry button a11y | — | Média | — | Baixo | P2 | Sim | — |
| **AO** | Empty states | **IMPLEMENTED_UNVERIFIED** | `EmptyState`, DayAgenda, calendars | — | Calendars + day OK; week/month fracos; onboarding step3 fraco | — | Média | S | Baixo | P1 | Sim | Completar week/onboarding |
| **AP** | Offline banner | **IMPLEMENTED_UNVERIFIED** | `OfflineBanner.tsx` + root layout | — | NetInfo + live region | — | Média | — | Baixo | P2 | Difícil | — |
| **AQ** | A11y labels básicos | **PARTIAL** | Auth/Google/CalendarToolbar fortes; onboarding/settings fracos | — | Muitos `Pressable` sem label | — | Média | M | Médio | P1 | Sim | Labels onboarding/settings/paywall |
| **AR** | Font scaling / roles | **PARTIAL** | Auth `maxFontSizeMultiplier`; pouco no app | — | Inconsistente fora de auth | — | Baixa | M | Baixo | P2 | Sim | Propagar Typography |
| **AS** | Responsivo mobile | **IMPLEMENTED_UNVERIFIED** | agenda `<720` DayAgenda; AuthShell | — | Breakpoints 720/960 | — | Alta | — | Baixo | P1 | Sim | — |
| **AT** | Responsivo tablet/desktop | **IMPLEMENTED_UNVERIFIED** | sidebar ≥960; `Screen` maxWidth | — | Layout wide | — | Alta | — | Baixo | P1 | Sim | — |
| **AU** | 404 / not-found | **PARTIAL** | Develop: inglês “Oops!”; WIP PT + brand | — | Template Expo default em develop | — | Baixa | S | Baixo | **P1** | Sim | Portar WIP `+not-found.tsx` |
| **AV** | Terms / Privacy | **PARTIAL** | `terms.tsx`, `privacy.tsx` | — | `[REVISÃO JURÍDICA NECESSÁRIA]` / `[PENDENTE]` | Jurídico | Alta (compliance) | M | Alto legal | P1 | Sim (copy) | Revisão humana; não é bug de código |

---

## Develop vs WIP (deltas que importam)

| Tema | `origin/develop` | WIP |
|------|------------------|-----|
| Email/senha + recovery | **Ausente** (sign-up diz “em breve”) | **Dirty untracked** completo + unit tests |
| Calendar OAuth | Popup legado `connected=` | **Ticket + nonce + finalize** (commitado) |
| Disconnect / erros calendars | `Alert.alert` (**quebra web**) | `confirmAction` / `showMessage` |
| Paywall `?canceled=1` | Ignora mensagem | Msg PT + testes (`paywall-params`) |
| Entitlement gate | Inline no layout | Extraído + testes |
| `+not-found` | EN | PT |
| Test Engine / Playwright auth | Ausente no develop tree | Presente (E2E STAGE ainda BLOCKED sem bootstrap) |

---

## Top P0 / P1 — gaps localmente corrigíveis

1. **P0 — Web alerts no-op** (`calendars.tsx`, onboarding): trocar `Alert.alert` → `confirmAction`/`showMessage` (`lib/confirm.ts`). Offline, S, alto impacto.  
2. **P0 — Auth password surface** (A/D/E/F/G): portar arquivos dirty do WIP + unit tests já existentes. Offline para UI/unit; E2E SMTP = BLOCKED.  
3. **P0 — OAuth complete ticket UX** (S): develop sem finalize — alinhar frontend ao lifecycle M3-003 (código já no WIP commitado). Unit offline; consent remoto.  
4. **P1 — Paywall cancel notice** (AK): portar `lib/billing/paywall-params.ts` + wire em `paywall.tsx`.  
5. **P1 — `+not-found` PT** (AU): portar WIP.  
6. **P1 — Onboarding step 3 empty** (N): EmptyState se `calendars.length===0`.  
7. **P1 — Loading inicial** agenda/calendars (AM).  
8. **P1 — Entitlement gate testável** (AL): portar `entitlement-gate.ts` + testes.  
9. **P1 — A11y onboarding/settings** (AQ): labels/`accessibilityRole` nos presses principais.

**Não local-fixable (BLOCKED / remoto):** SMTP Auth STAGE, consentimento Google/MS real, preço Stripe live, delete E2E, expired paywall Playwright sem storage QA.

---

## Nota de método

Checklist **A–AV** não estava versionada no repo; foi derivada dos domínios pedidos (48 itens A…AV). Classificações usam **só evidência de código/testes** — sem inventar features. Overnight dirty ≠ develop limpo.