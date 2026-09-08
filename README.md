# Both: Calendar Sync

Sincroniza disponibilidade e eventos entre os calendários conectados (Google, Microsoft e iCloud), evitando loops de sincronização e eventos espelhados duplicados.

O nome anterior do projeto era **Unify**. Identificadores persistidos (entitlements, metadados de evento, scheme OAuth legado `unify://`) permanecem até a migração STAGE/PROD.

## Stack

- Expo 57 + Expo Router + TypeScript
- Supabase (Auth, Postgres, RLS, Realtime, Edge Functions)

## Variantes

| `APP_VARIANT` | Nome visível | Bundle ID | Scheme |
| --- | --- | --- | --- |
| `development` (padrão local) | Both DEV | `com.bothcalendarsync.app.dev` | `both-dev` |
| `preview` | Both STG | `com.bothcalendarsync.app.staging` | `both-stg` |
| `production` | Both: Calendar Sync | `com.bothcalendarsync.app` | `both` |

O scheme legado `unify` continua registrado em todas as variantes até a migração OAuth.

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
7. Cron (versionado — migration `20260908000001_cron_renew_reconcile.sql`):
   - `both-renew-subscriptions` → `renew-subscriptions` a cada hora
   - `both-reconcile-sync` → `reconcile-sync` a cada 15 minutos
   - Seed Vault (`project_url`, `cron_secret`, `anon_key`) — ver `docs/cron-schedules.md`
   - Header `x-cron-secret` (Edge `CRON_SECRET`)

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
- Mirror padrão: título `Horário reservado · Both`, sem descrição/local/participantes copiados.
- Billing e agendamento estão em construção.

## Testes

`npm test` cobre importação, idempotência de webhook, auto-block, anti-loop, update/delete de origin, mirror abandonado, token/resync, timezone/DST e all-day.
