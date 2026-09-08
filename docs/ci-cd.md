# CI/CD

Este repositório separa **integração** de **implantação**.

```text
CI:
este código pode ser integrado?

CD:
implante este código.
```

## Fluxo Git

A partir da Fase 5B, **não** desenvolva diretamente em `develop` ou `main`. Não use merge/push direto como fluxo normal.

```text
feature/*
    │
    ▼
Pull Request
    │
    ▼
CI
├── CI / Application
└── CI / Supabase
    │
    ▼
MERGE (GitHub UI)
    │
    ▼
develop
    │
    ▼
Deploy STAGE
    │
    ├── guard
    ├── link
    ├── migration dry-run
    ├── migrations
    ├── functions
    └── verification
    │
    ▼
Both STAGE
qszggrrjhcwltnmxpxcy
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

Checks estáveis (usados em Branch Protection):

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

## O que o CD STAGE faz

Workflow: `.github/workflows/deploy-stage.yml`

Check estável:

```text
Deploy STAGE / Supabase STAGE
```

### Trigger

- push em `develop` (após merge de PR)
- `workflow_dispatch` (somente quando a ref é `develop`; feature branches e `main` são bloqueadas pelo job `if`)

Sem filtros `paths:` nesta primeira versão: todo merge em `develop` pode reproduzir o backend STAGE.

### Concorrência

```text
group: both-stage-deployment
cancel-in-progress: false
```

Deploys ocorrem serialmente. Uma migration em andamento **não** é cancelada por commits subsequentes.

### GitHub Environment: staging

O job usa `environment: staging` como fronteira de credenciais.

Configure em **Settings → Environments → staging**:

| Tipo | Nome | Valor |
|------|------|-------|
| Secret | `SUPABASE_ACCESS_TOKEN` | Personal Access Token da conta Supabase administrativa do Both (não Legacy) |
| Secret | `SUPABASE_DB_PASSWORD` | Senha do banco Both STAGE (`qszggrrjhcwltnmxpxcy`) |
| Variable | `SUPABASE_PROJECT_REF` | `qszggrrjhcwltnmxpxcy` |

Restringir deployment branches a `develop` apenas.

**Não** configure aqui runtime secrets da aplicação (`GOOGLE_*`, `MICROSOFT_*`, `STRIPE_*`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, etc.). Esses pertencem ao Supabase runtime e não são gerenciados por este pipeline.

### Passos do deploy

1. Preflight: valida presença de credenciais (sem imprimir secrets)
2. Hard guard: exige `SUPABASE_PROJECT_REF=qszggrrjhcwltnmxpxcy`; proíbe Legacy `sknpqjodttkpttaytdut`
3. `supabase link --project-ref`
4. `supabase migration list`
5. `supabase db push --dry-run`
6. `supabase db push` (sem seed, sem reset, sem repair)
7. `supabase db push --dry-run` (deve reportar up to date)
8. `supabase functions deploy --project-ref` (sem `--prune`, sem `--no-verify-jwt` global)
9. `supabase functions list --project-ref`

O deploy respeita `supabase/config.toml` (incluindo `verify_jwt`).

### O que o CD STAGE não faz

```text
supabase secrets set
Auth provider / Site URL / Redirect URLs
google-oauth / microsoft-oauth / renew-subscriptions / sync-now
icloud-poll / reconcile-sync / send-email-digest
EAS Build / EAS Update / Expo deploy / web hosting
PROD deployment
Legacy deployment (sknpqjodttkpttaytdut)
```

## Branch Protection (develop)

Configure manualmente se `gh` não estiver autenticado:

- Require a pull request before merging: **ON**
- Required status checks: `CI / Application`, `CI / Supabase`
- Require branch to be up to date: **ON** (se disponível)
- Block force pushes: **ON**
- Block deletions: **ON**
- Reviewers externos: **NÃO** exigidos (desenvolvedor único)

## Rollback

### Failed migration

Não executar `db reset --linked`. Corrigir via nova migration:

```text
bad migration
     ↓
new corrective migration
     ↓
PR → CI → develop → CD
```

### Failed Function deployment

Corrigir código e produzir novo commit via PR. Não force rollback destrutivo automático nesta fase.

## Legacy Supabase Preview

Existe um check GitHub **Supabase Preview** associado ao projeto Legacy (`sknpqjodttkpttaytdut`). Com CI/CD próprio via GitHub Actions, essa integração é redundante.

**Não** altere dados do Legacy automaticamente. Após `Deploy STAGE` estar verde e validado, desconecte manualmente a integração GitHub/Supabase Preview Legacy.

Checks desejados:

```text
CI / Application
CI / Supabase
Deploy STAGE / Supabase STAGE
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

CI e CD não alteram:

```text
Legacy unify-dev (sknpqjodttkpttaytdut) — FROZEN
```

Edge Functions: a lógica compartilhada já é coberta por `npm test`. Não há `deno.json` / check Deno oficial no repo; validação estática Deno fica para fase posterior.

EAS Build/Update não fazem parte desta fase.

## Como disparar CI

O workflow CI roda em:

- pull request para `develop` ou `main`
- push em `develop` ou `main`
- `workflow_dispatch`

Não usar `pull_request_target`.

## Como disparar CD STAGE

O workflow Deploy STAGE roda em:

- push em `develop` (após merge de PR)
- `workflow_dispatch` (somente ref `develop`)

Antes do primeiro deploy automático, configure o GitHub Environment `staging` com secrets e variable conforme acima.
