# Both — Supabase Cost & Capacity Assessment (2026)

**Audit kind:** READ-ONLY financial / capacity  
**Captured (UTC):** 2026-11-26T04:55:00Z  
**Pricing sources consulted:** 2026-11-26  
**Mutations performed:** **NONE**  
**Repo HEAD (develop):** `ee51087`

---

## 1. Resumo executivo

Both STAGE e Both PROD estão na **mesma organização Free** (`Both Calendar Sync` / `otaqdspnjsewiymnqbmr`), ambos em **Nano**, `sa-east-1`. Cobrança atual observada: **US$ 0/mês** (Free + Nano). Consumo do ciclo atual é baixo (egress ~0,02 GB, DB ~35 MB, MAU 7).

**PO decision (2026-11-26):** **Cenário C = TARGET architecture.** Manter custo atual **US$ 0** até aprovação paga explícita. Org alvo **Both Production** (`ufxaefwnhwzxafvajsfg`) já existe em Free/vazia. Transfer/Pro/Custom Domain **não** executados.

---

## 2. Decisão de manter Supabase

PO confirmou manter Supabase para Postgres, Auth e Edge Functions. Esta auditoria **não** avalia migração para outro vendor; apenas custo/capacidade/otimização dentro do Supabase.

---

## 3. Organizações identificadas

| Campo | Valor observado |
|-------|-----------------|
| Nome | Both Calendar Sync |
| Slug / ID | `otaqdspnjsewiymnqbmr` |
| Plano | **Free** |
| Owner | `bothcalendarsync@gmail.com` (único membro; role Owner) |
| Projetos ativos | **2** (Both STAGE, Both PROD) |
| Projetos pausados | **0** (nenhum listado) |
| Add-ons | Nenhum observado (Custom Domain UI: Pro-only) |
| Spend Cap | **Enabled** (Billing UI; em Free limita overages via restrição, não cobrança) |
| Faturas | Seção “Past Invoices” presente; **nenhuma linha de fatura paga observada** no a11y tree |
| Subscription fee | **US$ 0** |
| Compute credits | N/A no Free (crédito US$ 10/mês só em planos pagos) |

**Outras orgs Both:** não encontradas nesta sessão. CLI PAT lista só STAGE; Dashboard Owner mostra exatamente os 2 projetos Both. Projeto legado `sknpqjodttkpttaytdut` **excluído** desta auditoria (proibido).

`STAGE_ORG_IDENTIFIED=PASS` · `PROD_ORG_IDENTIFIED=PASS` · **mesma org = YES**

---

## 4. Projetos identificados

| | STAGE | PROD |
|--|-------|------|
| Nome | Both STAGE | Both PROD |
| Ref | `qszggrrjhcwltnmxpxcy` | `djxulqyuafhihmuyzvvk` |
| Org | `otaqdspnjsewiymnqbmr` | **same** |
| Região | sa-east-1 | sa-east-1 |
| Status | ACTIVE (dashboard) | ACTIVE (dashboard) |
| Compute | **nano** | **nano** |
| Plano efetivo | Free (org) | Free (org) |
| Custom Domain | none | none (not eligible Free) |
| PITR / daily backups | Free: automatic backups **not included** | same |
| Pause risk | Free: pause após 1 semana de inatividade | **risco operacional PROD** |

---

## 5. Plans and billing (oficial)

Fontes: https://supabase.com/pricing · org-based-billing · manage-your-usage/compute · custom-domains · project-transfer (consultados **2026-11-26**).

| Item | Free | Pro |
|------|------|-----|
| Subscription | US$ 0 | US$ 25 / org / mês |
| Active projects | 2 (conta Owner/Admin) | ilimitado (compute por projeto) |
| Pause | após 1 semana inatividade | never |
| Disk | 500 MB / projeto | 8 GB / projeto + US$ 0.125/GB |
| Egress | 5 GB | 250 GB + US$ 0.09/GB |
| MAU | 50.000 | 100.000 + US$ 0.00325 |
| Edge invocations | 500.000 | 2.000.000 + US$ 2 / 1M |
| Storage | 1 GB | 100 GB |
| Log retention | 1 day | 7 days |
| Backups | não | 7 days daily |
| Custom Domain | não | US$ 10 / domínio / projeto / mês (~US$ 0.0137/h) |
| Compute Nano | US$ 0 (Free) | em pago, Nano cobrado como Micro (~US$ 10) |
| Compute Micro | — | ~US$ 10 / mês |
| Compute credits | — | US$ 10 / org / mês (1× Nano/Micro) |

**Fora do Spend Cap:** Compute Hours, Custom Domain (e outros add-ons horários).

---

## 6–7. Consumo STAGE / PROD

### Medido (Dashboard org — ciclo de billing atual, 2026-11-26)

| Métrica | Org (STAGE+PROD) | Quota Free | Fonte |
|---------|------------------|------------|-------|
| Egress | **0,02 / 5 GB** | 5 GB | Org home |
| Database size | **35 / 500 MB** | 500 MB/projeto (UI mostra resumo) | Org home |
| MAU | **7 / 50.000** | 50.000 | Org home |
| File storage | **0 / 1 GB** | 1 GB | Org home |
| Log Ingestion | **0,02 / 1 GB** | 1 GB | Org home |
| Log Query | **0 / 100 GB** | 100 GB | Org home |
| Edge Function Invocations | **NOT_AVAILABLE** no resumo home | 500.000 | não exibido no card resumido |
| Compute Hours Nano | ativo 2 projetos | US$ 0 | pricing + dashboard nano |
| CPU / mem / swap / 7d–90d | **NOT_AVAILABLE** | — | sem export API nesta sessão |

**Interpretação:** quase todo o DB (~35 MB) e MAU (7) refletem **STAGE QA**. PROD está vazio de usuários externos (signup desativado; sem deploys de app público). Split por projeto 7d/30d/90d: **NOT_AVAILABLE** sem drill-down exportável.

`STAGE_USAGE=PARTIAL` · `PROD_USAGE=PARTIAL` · `CURRENT_BILLING=PASS` (US$ 0 Free)

---

## 8. Recursos e quotas (gargalos Free)

Ordem provável de saturação para Both:

1. **Pause por inatividade (PROD Free)** — risco operacional, não quota de uso.  
2. **Disk 500 MB/projeto** — crescimento de mappings/sync state.  
3. **Edge invocations 500k/mês** — webhooks + cron sob escala.  
4. **Egress 5 GB** — menos provável no início.  
5. **MAU 50k** — folga enorme no beta.

---

## 9. Análise do banco

| Item | Status |
|------|--------|
| Tamanho org medido | **35 MB** |
| SQL read-only detalhado (tabelas/índices) | **NOT_EXECUTED** — sem `db` link/token adequado nesta sessão; evitar queries pesadas em STAGE |
| PROD | Espera-se near-empty (sem migrations/users externos) |
| STAGE | Base QA + sync/billing state; 35 MB é pequeno |

**Hipótese de crescimento (não medido):** mappings/event state ~1–5 KB/linha; 1.000 usuários × 500 eventos × 2 lados ≈ ordem de **centenas de MB a poucos GB** → força Pro disk antes de MAU.

`DATABASE_USAGE=PARTIAL`

---

## 10. Edge Functions

### Inventário de código (24 funções sob `supabase/functions/`)

Ativas relevantes ao custo sync:

| Função | Gatilho | Papel |
|--------|---------|-------|
| google-oauth / microsoft-oauth | user | Calendar connect |
| disconnect-calendar | user | Disconnect |
| sync-now | user / catch-up | Sync core |
| google-webhook / microsoft-webhook | provider push | Ingress |
| reconcile-sync | **cron */15 min** | Catch-up |
| renew-subscriptions | **cron hourly** | Watch renewal |
| billing-checkout / billing-webhook / billing-portal / billing-revenuecat | billing | Stripe Test |
| sync-calendar | tombstone SEC-07 | **não usar** |
| Outras (create/update/delete-event, booking, icloud-*, etc.) | misto | produto |

### Custo fixo de scheduler (código — se cron aplicado no projeto)

| Job | Schedule | Invocations/mês (base) |
|-----|----------|------------------------|
| renew-subscriptions | `0 * * * *` | ~720 |
| reconcile-sync | `*/15 * * * *` | ~2.880 |
| **Subtotal fixo** | | **~3.600 / projeto / mês** |

Conteúdo por run escala com nº de calendários conectados (amplificação).  
**Invocations medidas:** NOT_AVAILABLE no card resumido.

`EDGE_USAGE=PARTIAL`

---

## 11. Sync Cost Model

### Medido

- E2E STAGE real (`BOTHQA20261126022819`): sync bidirecional validado; **sem contagem oficial de invocations por run**.

### Estimado (hipótese; faixa)

| Evento | Invocations estimadas | Notas |
|--------|----------------------|-------|
| Onboarding + email confirm | 0 Edge (Auth) | Auth não conta como Edge |
| Google Calendar connect | 2–4 | authorize + callback/finalize path |
| Microsoft Calendar connect | 2–4 | idem |
| Primeiro sync-now (2 cals) | 1–3 | + watches |
| Update de evento (webhook) | 1–3 | + possível reconcile |
| Retry / anti-loop | 0–2 | falhas |
| Cron base | ~3.600/mês | independente de tráfego usuário |

**Cenarios / usuário / dia (apenas webhooks+sync variável):**

| | Leve | Moderado | Intensivo |
|--|------|----------|-----------|
| Mudanças de evento/dia | 5 | 20 | 50 |
| Invocations variáveis/dia/user | ~8 | ~30 | ~80 |

---

## 12–13. Cenários A–E (US$ / mês)

Premissas: Nano≡Micro em org paga (~US$ 10); 1 Custom Domain só em PROD; sem overage; Spend Cap ON em Pro.

| Cenário | Descrição | Sub | Compute | Credits | CD | **Total/mês** | **Ano** | Incremental vs atual |
|---------|-----------|-----|---------|---------|-----|---------------|---------|----------------------|
| **A** | STAGE+PROD mesma org **Free** (atual) | 0 | 0 | 0 | 0 | **0** | **0** | 0 |
| **B** | Mesma org **Pro** + CD PROD | 25 | 20 (2×10) | −10 | 10 | **45** | **540** | +45 |
| **C** | STAGE Free org + PROD Pro org + CD | 25 | 10 | −10 | 10 | **35** | **420** | +35 |
| **D** | 2× Pro orgs + CD PROD | 50 | 20 | −20 | 10 | **60** | **720** | +60 |
| **E** | Ambos Free **sem** CD (adiar brand) | 0 | 0 | 0 | 0 | **0** | **0** | 0 |

**Viabilidade:**

| Cenário | Status |
|---------|--------|
| A / E | **VIABLE** agora |
| B | **VIABLE** via upgrade org (PO) |
| C | **VIABLE** via nova org + **project transfer** (não executado) |
| D | VIABLE mas **sem justificativa de custo** |

Separação de custos:

| Bucket | A/E | B | C |
|--------|-----|---|---|
| BASE (subscription+compute−credits) | 0 | 35 | 25 |
| OPTIONAL ADD-ONS (CD) | 0 | 10 | 10 |
| USAGE VARIABLE | 0 hoje | 0 esperado no beta | 0 esperado |
| EXTERNAL (CF/email/Stripe) | fora do total | fora | fora |

`FREE_PLAN_SCENARIO=CALCULATED` · `SAME_ORG_PRO_SCENARIO=CALCULATED` · `SPLIT_ORG_SCENARIO=CALCULATED`

---

## 14. Custo por usuário (só Supabase)

Usando **Cenário C = US$ 35/mês** fixo (até quotas):

| MAU ativos | US$/user/mês (infra) |
|------------|----------------------|
| 10 | 3,50 |
| 50 | 0,70 |
| 100 | 0,35 |
| 500 | 0,07 |
| 1000 | 0,035 |

Referência comercial histórica Stripe Test: **R$ 19,90/mês** Both Pro — **não** converter FX nem misturar com margem de negócio sem hipótese explícita. Este número **não** autoriza Stripe Live.

---

## 15. Projeções 10 / 50 / 100 / 500 / 1000

### Invocations/mês estimadas (moderado + cron 3,6k)

| Users | Var. (≈30/user/day) | +Cron | Total est. | vs Free 500k | vs Pro 2M |
|-------|---------------------|-------|------------|--------------|-----------|
| 10 | ~9k | 3,6k | ~13k | OK | OK |
| 50 | ~45k | 3,6k | ~49k | OK | OK |
| 100 | ~90k | 3,6k | ~94k | OK | OK |
| 500 | ~450k | 3,6k | ~454k | **limítrofe Free** | OK |
| 1000 intensivo (~80/d) | ~2,4M | 3,6k | ~2,4M | **estoura Free** | overage possível |

### Disk (hipótese)

| Users | Ordem de grandeza | Free 500MB |
|-------|-------------------|------------|
| ≤100 | dezenas–centenas MB | provavelmente OK |
| 500–1000 | GB | **Pro necessário** |

### Custo anual estimado (sem overage)

| Config | 12 meses |
|--------|----------|
| A/E Free | US$ 0 |
| C Pro split + CD | US$ 420 |
| B same Pro + CD | US$ 540 |

`COST_GROWTH_MODEL=PASS` (com hipóteses declaradas)

---

## 16. STAGE Free × PROD Pro

**Sim:** org-based billing permite planos diferentes **somente** com orgs diferentes.  
Economia vs B: **~US$ 10/mês** (um compute a menos coberto pelo credit na org Pro única vs credit só no PROD).  
Custo da complexidade: 2 orgs, 2 billings, tokens org-scoped, disciplina de secrets.

---

## 17. Avaliação de transferência

Docs oficiais (project-transfer / what-changes):

| Aspecto | Free→Pro (transfer PROD para org Pro) |
|---------|----------------------------------------|
| Project ref / URL / keys / JWT | **permanecem** |
| Data / functions / secrets Edge | permanecem |
| Downtime | **None** (Free→Pro) |
| Billing | target paga após transfer |
| Tokens org-scoped | precisam reescopo |
| GitHub connection | pode exigir reconnect |
| Add-ons Free | N/A |
| Reversibilidade | transfer de volta; **sem undo**; Free remove add-ons |

**Não executado.** Preview API não chamada (evita qualquer path de mutação).

`PROJECT_TRANSFER_ANALYSIS=PASS`

---

## 18. Riscos

| Risco | Severidade | Mitigação (proposta, não aplicada) |
|-------|------------|-------------------------------------|
| PROD Free pause 1 semana | ALTA p/ launch | Pro antes de usuários reais |
| Sem daily backups no Free | ALTA p/ PROD | Pro |
| Sem Custom Domain no Free | MÉDIA (branding OAuth) | Pro + CD US$ 10 |
| Cron + webhooks estouram 500k | MÉDIA em escala | monitorar; Pro 2M |
| Disk 500 MB | MÉDIA | monitorar; Pro 8 GB |
| Spend Cap OFF acidental | MÉDIA | manter ON; Compute/CD fora do cap |
| Sync loops | MÉDIA | anti-loop já no produto; alertas |

---

## 19. Recomendação

**Agora (pré-beta externo):** **Cenário A/E** — permanecer Free, US$ 0. Não ativar Custom Domain. Não upgrade.

**Antes do closed beta externo / Auth brandado:**

1. Preferência de custo: **Cenário C** (~US$ 35/mês) — PROD em org Pro + CD; STAGE permanece Free.  
2. Preferência de simplicidade: **Cenário B** (~US$ 45/mês) — uma org Pro, ambos projetos.  
3. **Não** recomendar D.

Compute: iniciar **Micro** (Nano em pago = mesmo preço; docs recomendam upgrade conveniente). Evitar Small até evidência de CPU/mem.

`BEST_CONFIGURATION_RECOMMENDED=YES`

---

## 20. Passos de implantação (futuros — NÃO executar agora)

1. PO aprova orçamento (C ou B).  
2. Se C: criar org Pro (pagamento) → transfer preview → transfer PROD.  
3. Se B: Change subscription plan na org atual.  
4. Upgrade compute Nano→Micro no PROD.  
5. Ativar Custom Domain só após DNS + OAuth clients.  
6. Spend Cap ON.  
7. Monitorar Usage mensal.

---

## 21. Aprovações PO necessárias

- [ ] Upgrade Pro (B ou C)  
- [ ] Custom Domain US$ 10/mês  
- [ ] Criar org adicional / transfer (se C)  
- [ ] Cartão / billing address na org paga  
- [ ] Momento de ativar CD vs aceitar `*.supabase.co` no consent

---

## 22. Fontes e data

- https://supabase.com/pricing — 2026-11-26  
- https://supabase.com/docs/guides/platform/org-based-billing — 2026-11-26  
- https://supabase.com/docs/guides/platform/manage-your-usage/compute — 2026-11-26  
- https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains — 2026-11-26  
- https://supabase.com/docs/guides/platform/project-transfer (+ what-changes) — 2026-11-26  
- Dashboard org `otaqdspnjsewiymnqbmr` — 2026-11-26  

---

## 23. Dados indisponíveis

- Edge invocations exatas 7/30/90 dias  
- Split STAGE vs PROD por métrica  
- CPU/mem/swap/conexões  
- Tamanhos de tabela SQL  
- Faturas históricas detalhadas (UI sem linhas)  
- Ciclo de billing (data âncora) não lida no a11y tree  

---

## 24. Limites e premissas

- Estimativas de sync **não** são medições.  
- Preços em **USD** oficiais; impostos/VAT não modelados.  
- Cloudflare / SMTP / Stripe **fora** do total Supabase.  
- Assumido 1 CD apenas em PROD.  
- Cron counts assumem schedules aplicados como no migration STAGE.

---

## Gates

```
SUPABASE_COST_AUDIT=PARTIAL
STAGE_ORG_IDENTIFIED=PASS
PROD_ORG_IDENTIFIED=PASS
CURRENT_BILLING=PASS
STAGE_USAGE=PARTIAL
PROD_USAGE=PARTIAL
EDGE_USAGE=PARTIAL
DATABASE_USAGE=PARTIAL
AUTH_MAU_USAGE=PASS
EGRESS_USAGE=PASS
FREE_PLAN_SCENARIO=CALCULATED
SAME_ORG_PRO_SCENARIO=CALCULATED
SPLIT_ORG_SCENARIO=CALCULATED
PROJECT_TRANSFER_ANALYSIS=PASS
COST_GROWTH_MODEL=PASS
BEST_CONFIGURATION_RECOMMENDED=YES
NO_RESOURCE_MUTATION=PASS
NO_PLAN_CHANGE=PASS
NO_NEW_CHARGES=PASS
NO_PROJECT_TRANSFER=PASS
NO_PRODUCTION_DEPLOY=PASS
NO_SECRET_EXPOSURE=PASS
```
