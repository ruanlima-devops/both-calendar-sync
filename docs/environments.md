# Both Environments

O repositório GitHub é único. Os backends Supabase de STAGE e PROD são projetos separados e não compartilham banco, usuários nem secrets.

O projeto antigo da conta pessoal permanece congelado como rollback. O STAGE ativo do Both é um projeto novo, criado na organization Both, bootstrapado somente a partir do Git.

```text
                    BOTH
                     │
              GitHub Repository
                     │
             feature branches
                     │
                  develop
                     │
          ┌─────────┴─────────┐
          ▼                   ▼
   LEGACY STAGE          BOTH STAGE
   (frozen rollback)     (ativo)
          │
          └────── BOTH PROD
                    PENDING
```

## DEV

```text
Git:
feature/*

Application:
Both DEV

APP_VARIANT:
development

Bundle:
com.bothcalendarsync.app.dev

Scheme:
both-dev

Backend:
desenvolvimento local e/ou BOTH STAGE durante a fase atual
```

O app local também registra o scheme legado `unify` para não quebrar o OAuth nativo atual.

## LEGACY STAGE

```text
Project:
unify-dev

Project Ref:
sknpqjodttkpttaytdut

Region:
sa-east-1

Status:
Frozen / rollback reference

Ownership:
legacy account

Role:
LEGACY STAGE / ROLLBACK ONLY
```

Não alterar schema, functions, secrets, usuários ou dados deste projeto.

## BOTH STAGE

```text
Git:
develop

Application:
Both STG

APP_VARIANT:
preview

Bundle:
com.bothcalendarsync.app.staging

Scheme:
both-stg

Project:
Both STAGE

Project Ref:
qszggrrjhcwltnmxpxcy

Region:
sa-east-1

Organization slug:
otaqdspnjsewiymnqbmr

Status:
Active staging environment

Ownership:
Both organization
```

O `project_id` em `supabase/config.toml` (`both-stage`) identifica só o ambiente local do CLI. Não é o Project Ref remoto.

O repositório está linked ao BOTH STAGE (`qszggrrjhcwltnmxpxcy`). Integrações externas (Auth providers, Calendar OAuth, email, billing, crons) ainda estão PENDING.

## PROD

```text
Git:
main

Application:
Both: Calendar Sync

APP_VARIANT:
production

Bundle:
com.bothcalendarsync.app

Scheme:
both

Supabase:
NOVO projeto separado — ainda não criado/configurado

PROD Project Ref:
PENDING
```

PROD deve nascer com a mesma receita do BOTH STAGE: schema, RLS, functions e secrets próprios. Não deve receber usuários, tokens, eventos, webhooks, notificações ou billing records de STAGE nem do legado.

## Segregação obrigatória

Nunca compartilhar entre LEGACY STAGE, BOTH STAGE e PROD:

- projeto Supabase
- database
- service role / secret keys
- `TOKEN_ENCRYPTION_KEY`
- `CRON_SECRET`
- Google OAuth client secret
- Microsoft OAuth client secret
- identificadores de webhook/subscription
- dados de usuários

Clientes OAuth independentes entre STAGE e PROD são o alvo; a troca acontece em fase posterior.
