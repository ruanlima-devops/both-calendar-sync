# Prod readiness

Checklist operacional. Não contém secrets.

## Supabase STAGE

- [x] Independent Both STAGE project
- [x] Database migrations
- [x] RLS/schema
- [x] Edge Functions
- [ ] Application secrets
- [ ] Auth providers
- [ ] Calendar OAuth
- [ ] Email
- [ ] Billing
- [ ] Scheduled jobs

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

PROD ainda não deve ser criado até o BOTH STAGE autenticar, conectar calendários, receber webhooks e sincronizar.
