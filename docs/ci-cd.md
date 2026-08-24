# CI/CD

Este repositório separa **integração** de **implantação**.

```text
CI:
este código pode ser integrado?

CD:
implante este código.
```

A Fase 5A implementa somente CI.

## Fluxo Git

```text
feature/*
    │
    ▼
Pull Request
    │
    ▼
CI
├── Application
└── Supabase
    │
    ▼
develop
    │
    ▼
[CD STAGE — próxima fase]
    │
    ▼
Both STAGE
```

```text
develop
   ↓
PR
   ↓
main
   ↓
[CD PROD — futura fase]
   ↓
Both PROD
```

## O que o CI faz

Workflow: `.github/workflows/ci.yml`

Checks estáveis (usados depois em Branch Protection):

```text
CI / Application
CI / Supabase
```

### Application

Roda no runner GitHub, sem credenciais remotas:

- `npm ci`
- `npm test`
- `npm run typecheck`
- `expo config --type public` para development, preview e production
- `APP_VARIANT=preview npx expo export --platform web`

O export de preview existe porque `develop` é homologação. Isso **não** conecta no banco STAGE.

Placeholders públicos de CI:

```text
EXPO_PUBLIC_SUPABASE_URL=https://qszggrrjhcwltnmxpxcy.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<JWT sintético, não é chave real>
```

O Project Ref não é secret. A anon/publishable key real **não** entra no GitHub.

### Supabase

Roda em paralelo, só contra Postgres local efêmero:

- `supabase db start`
- `supabase db reset --local --no-seed --yes`
- `supabase db lint --local --level error --fail-on error`
- `supabase stop --no-backup`

Nunca usa:

```text
--linked
supabase db push
supabase functions deploy
SUPABASE_ACCESS_TOKEN
SUPABASE_DB_PASSWORD
```

## Regras

```text
CI:
no remote credentials
no deployment

STAGE CD:
automatic after approved merge to develop

PROD CD:
controlled after approved promotion to main
```

CI não altera:

```text
Both STAGE
Both PROD
Legacy unify-dev
```

Edge Functions: a lógica compartilhada já é coberta por `npm test`. Não há `deno.json` / check Deno oficial no repo; validação estática Deno fica para fase posterior.

EAS Build/Update e Branch Protection não fazem parte desta fase.

## Como disparar

O workflow roda em:

- pull request para `develop` ou `main`
- push em `develop` ou `main`
- `workflow_dispatch`

Não usar `pull_request_target`.
