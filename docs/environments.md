# Both Environments

O repositório GitHub é único. Os backends Supabase de STAGE e PROD são projetos separados e não compartilham banco, usuários nem secrets.

```text
                    BOTH
                     │
              GitHub Repository
                     │
             feature branches
                     │
                  develop
                     │
                     ▼
              SUPABASE STAGE
              (projeto remoto atual)
                     │
                     ▼
              [NOVO PROJETO]
                 BOTH PROD
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
desenvolvimento local e/ou STAGE durante a fase atual
```

O app local também registra o scheme legado `unify` para não quebrar o OAuth nativo atual.

## STAGE

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

Supabase:
projeto remoto atual (hoje ainda com display name unify-dev)

Supabase Project Ref:
sknpqjodttkpttaytdut

Region:
sa-east-1

Organization slug:
kugrkrmotjtjkokcxkit

Remote display name rename:
PENDING (ainda unify-dev)
```

O `project_id` em `supabase/config.toml` (`both-stage`) identifica só o ambiente local do CLI. Não é o Project Ref remoto. O vínculo remoto continua o mesmo; nenhum `supabase link` novo foi executado nesta fase.

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

PROD deve nascer com schema, RLS, functions e secrets próprios. Não deve receber usuários, tokens, eventos, webhooks, notificações ou billing records de STAGE.

## Segregação obrigatória

Nunca compartilhar entre STAGE e PROD:

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
