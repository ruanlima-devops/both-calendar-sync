# Prod readiness

Checklist operacional. Não contém secrets.

## Supabase STAGE

- [x] Independent Both STAGE project
- [x] Database migrations
- [x] RLS/schema
- [x] Edge Functions
- [x] Application secrets (calendar OAuth; billing/email still pending)
- [x] Auth providers (Google on Supabase Auth; login E2E pending)
- [x] Calendar OAuth (clients + Edge secrets; live connection E2E pending)
- [ ] Email
- [ ] Billing
- [x] Scheduled jobs (`renew-subscriptions`, `reconcile-sync` via migration; Vault seed required per env)
- [ ] Scheduled jobs remaining (`icloud-poll`, `send-email-digest`)

## Supabase PROD

- [ ] Separate Both PROD project
- [ ] Database migrations
- [ ] Edge Functions
- [ ] Application secrets

## Notas

BOTH STAGE ativo:

- Name: Both STAGE
- Project Ref: `qszggrrjhcwltnmxpxcy`
- Region: `sa-east-1`

LEGACY STAGE congelado:

- Name: unify-dev
- Project Ref: `sknpqjodttkpttaytdut`
- Role: rollback only

PROD ainda não deve ser criado até o BOTH STAGE autenticar, conectar calendários, receber webhooks e sincronizar (E2E desta fase ainda pendente).
