# Environment variables

Somente nomes. Nenhum valor real pertence a este arquivo.

O único alias de Edge Function documentado no código é `MICROSOFT_TENANT_ID` → `MICROSOFT_TENANT`.

## CLIENT / EXPO PUBLIC

### EXPO_PUBLIC_SUPABASE_URL

Type: Client / Expo public  
DEV: required  
STAGE: required  
PROD: required  
Same value allowed? NO

### EXPO_PUBLIC_SUPABASE_ANON_KEY

Type: Client / Expo public  
DEV: required  
STAGE: required  
PROD: required  
Same value allowed? NO

### EXPO_PUBLIC_APP_URL

Type: Client / Expo public  
DEV: required (`http://localhost:8081` em local)  
STAGE: required  
PROD: required  
Same value allowed? NO

### EXPO_PUBLIC_REVENUECAT_IOS_API_KEY

Type: Client / Expo public (SDK public key, not secret)  
DEV: optional until store billing  
STAGE: required for native billing tests  
PROD: required  
Same value allowed? NO (apps/entitlements separados)

### EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY

Type: Client / Expo public  
DEV: optional until store billing  
STAGE: required for native billing tests  
PROD: required  
Same value allowed? NO

## BUILD / EAS

### APP_VARIANT

Type: Build / EAS  
DEV: `development`  
STAGE: `preview`  
PROD: `production`  
Same value allowed? NO

### EAS_PROJECT_ID

Type: Build / EAS  
DEV/STAGE/PROD: optional until `eas init`  
Same value allowed? YES (mesmo projeto EAS, variantes diferentes)

### EAS_OWNER

Type: Build / EAS  
DEV/STAGE/PROD: optional  
Same value allowed? YES

## EDGE FUNCTION SECRET

### APP_URL

Type: Edge Function secret  
DEV: required for emails/OAuth web  
STAGE: required (já configurada)  
PROD: required  
Same value allowed? NO

### APP_REDIRECT_ALLOWLIST

Type: Edge Function secret  
DEV: optional  
STAGE: optional  
PROD: optional  
Same value allowed? NO

### TOKEN_ENCRYPTION_KEY

Type: Edge Function secret  
DEV: required for calendar connect  
STAGE: required  
PROD: required  
Same value allowed? NO

### CRON_SECRET

Cron handlers read `CRON_SECRET` via `Deno.env.get`.  
Type: Edge Function secret  
DEV: required for cron functions  
STAGE: required  
PROD: required  
Same value allowed? NO

### GOOGLE_CLIENT_ID

Type: Edge Function secret (Calendar Integration OAuth)  
DEV: required to connect Google Calendar  
STAGE: required  
PROD: required  
Same value allowed? NO (clientes OAuth separados preferidos)

### GOOGLE_CLIENT_SECRET

Type: Edge Function secret  
DEV: required  
STAGE: required  
PROD: required  
Same value allowed? NO

### GOOGLE_REDIRECT_URI

Type: Edge Function secret  
DEV: required  
STAGE: required  
PROD: required  
Same value allowed? NO (URL do projeto Supabase muda)

### GOOGLE_WEBHOOK_URL

Type: Edge Function secret  
DEV: required for watches  
STAGE: required  
PROD: required  
Same value allowed? NO

### MICROSOFT_CLIENT_ID

Type: Edge Function secret (Calendar Integration OAuth)  
DEV: required to connect Microsoft Calendar  
STAGE: required  
PROD: required  
Same value allowed? NO

### MICROSOFT_CLIENT_SECRET

Type: Edge Function secret  
DEV: required  
STAGE: required  
PROD: required  
Same value allowed? NO

### MICROSOFT_TENANT (alias: MICROSOFT_TENANT_ID)

Type: Edge Function secret  
DEV: `common` is acceptable  
STAGE: required  
PROD: required  
Same value allowed? YES if both use `common`

### MICROSOFT_REDIRECT_URI

Type: Edge Function secret  
DEV: optional (derivável de SUPABASE_URL)  
STAGE: required  
PROD: required  
Same value allowed? NO

### MICROSOFT_WEBHOOK_URL

Type: Edge Function secret  
DEV: optional (derivável de SUPABASE_URL)  
STAGE: required  
PROD: required  
Same value allowed? NO

### RESEND_API_KEY

Type: Edge Function secret  
DEV: optional (digest skipped if absent)  
STAGE: required for digests  
PROD: required for digests  
Same value allowed? NO

### RESEND_FROM_EMAIL

Type: Edge Function secret  
DEV: optional  
STAGE: required for digests  
PROD: required  
Same value allowed? NO (domínio de envio pode diferir)

### STRIPE_SECRET_KEY

Type: Edge Function secret  
DEV: optional  
STAGE: required for web billing  
PROD: required  
Same value allowed? NO

### STRIPE_WEBHOOK_SECRET

Type: Edge Function secret  
DEV: optional  
STAGE: required for web billing  
PROD: required  
Same value allowed? NO

### STRIPE_PRICE_ID

Type: Edge Function secret  
DEV: optional  
STAGE: required for web billing  
PROD: required  
Same value allowed? NO

### REVENUECAT_WEBHOOK_SECRET

Type: Edge Function secret  
DEV: optional  
STAGE: missing today (function local not deployed)  
PROD: required when native billing is live  
Same value allowed? NO

### SUPABASE_SERVICE_ROLE_KEY

Type: Edge Function secret  
DEV: required  
STAGE: required  
PROD: required  
Same value allowed? NO

### SUPABASE_ANON_KEY

Type: Edge Function secret / also Expo public sibling  
DEV: required  
STAGE: required (`SUPABASE_ANON_KEY` is present)  
PROD: required  
Same value allowed? NO

## SUPABASE MANAGED

Injetados pelo runtime das Edge Functions. Não precisam ser copiados manualmente para um projeto novo; o projeto PROD os fornece.

- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_DB_URL
- SUPABASE_JWKS
- SUPABASE_PUBLISHABLE_KEYS
- SUPABASE_SECRET_KEYS

`SUPABASE_URL` difere entre STAGE e PROD por definição.

## Authentication OAuth vs Calendar Integration OAuth

Estas **não** são as mesmas credenciais.

### AUTHENTICATION OAUTH

Login no app via Supabase Auth.

Google:

- Provider: Supabase Auth → Google
- Client IDs: configurados no Dashboard Auth (Web/iOS/Android), não nas Edge Functions
- Redirects: `{scheme}://auth/callback` e origens web
- Scopes: `openid email profile`
- Scheme legado atual: `unify`

Microsoft:

- Não usado para login

Apple:

- Provider: Supabase Auth → Apple (`signInWithIdToken`)
- Necessário no Dashboard Auth do iOS
- Sem client secret no app Expo

Email/password e magic link:

- Não usados no código atual

### CALENDAR INTEGRATION OAUTH

Conectar agendas após o login.

Google:

- Edge Function `google-oauth`
- Secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_WEBHOOK_URL`
- Redirect: `https://<project-ref>.supabase.co/functions/v1/google-oauth`
- App callback legado: `unify://oauth`

Microsoft:

- Edge Function `microsoft-oauth`
- Secrets: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT`, `MICROSOFT_REDIRECT_URI`, `MICROSOFT_WEBHOOK_URL`
- Redirect: `https://<project-ref>.supabase.co/functions/v1/microsoft-oauth`
- App callback legado: `unify://oauth`

iCloud:

- Sem OAuth. CalDAV + senha de app do usuário.

## Segregação STAGE vs PROD

Nunca compartilhar:

- projeto Supabase / database
- service role / secret keys
- TOKEN_ENCRYPTION_KEY
- CRON_SECRET
- Google OAuth client secret
- Microsoft OAuth client secret
- webhook/subscription identifiers
- dados de usuários
