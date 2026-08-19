# Unify

Calendário unificado Google + Microsoft. Um app Expo (iOS, Android, Web) e Supabase.

O produto: conectar as duas agendas e, ao criar um compromisso, bloquear as outras com um evento "Ocupado" — sem loops e sem copiar detalhes privados.

## Stack

- Expo 57 + Expo Router + TypeScript
- Supabase (Auth, Postgres, RLS, Realtime, Edge Functions)

## Setup

1. Crie um projeto Supabase e aplique `supabase/migrations`.
2. Copie `.env.example` para `.env` (app) e configure os secrets das Edge Functions.
3. No Google Cloud: Calendar API, OAuth (web) com `calendar.events` e `calendar.calendarlist.readonly`.
4. No Entra ID: Graph `Calendars.ReadWrite`, `offline_access`, `User.Read`.
5. Redirects:
   - Auth: `https://<ref>.supabase.co/auth/v1/callback`
   - Google calendar: `https://<ref>.supabase.co/functions/v1/google-oauth`
   - Microsoft calendar: `https://<ref>.supabase.co/functions/v1/microsoft-oauth`
6. Webhooks públicos (tunnel em local):
   - `.../functions/v1/google-webhook`
   - `.../functions/v1/microsoft-webhook`
7. Agende cron (dashboard Supabase):
   - `renew-subscriptions` a cada hora
   - `reconcile-sync` a cada 15 minutos
   - Header `x-cron-secret`

```bash
npm install
npm run web          # ou ios / android
npm test
```

Gere a chave de tokens: `openssl rand -base64 32` → `TOKEN_ENCRYPTION_KEY`.

Login (Supabase Auth) e conexão de calendário são OAuth separados. Você pode entrar com Google e conectar outro Google + Microsoft.

## Limitações do MVP

- Recorrência: leitura/exibição de ocorrências. Sem criar/editar séries.
- 1 conta Google + 1 Microsoft por usuário (beta).
- Mirror padrão: título `Ocupado`, sem descrição/local/participantes.
- Sem billing, polls, booking ou IA.

## Testes

`npm test` cobre importação, idempotência de webhook, auto-block, anti-loop, update/delete de origin, mirror abandonado, token/resync, timezone/DST e all-day.
# unify-dev
