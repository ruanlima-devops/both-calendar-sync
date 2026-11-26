# Both — Decisão Definitiva de Identidade Jurídica (PROD)

**Captured (UTC):** 2026-11-26T05:20:00Z  
**PO decision:** APPROVED  

| Gate | Value |
|------|-------|
| LEGAL_ENTITY_DECISION | **PASS** / APPROVED |
| LEGAL_ENTITY_NAME | **RUAN FELIPE SERAFIM DE LIMA LTDA** |
| LEGAL_ENTITY_TYPE | Brazilian LTDA (Sociedade Empresária Limitada) |
| PRODUCT_BRAND | **Both** (marca apresentada ao usuário) |
| OFFICIAL_DOMAIN | **bothcalendar.com** |
| LEGAL_DOCUMENT_VERIFICATION | **PENDING** |
| PROVIDER_VERIFICATION | **PENDING** (não submeter sem autorização explícita) |
| BOTH_LTDA | **Não existe** — não declarar |

---

## Aplicação aos provedores / produtos

| Área | Como aplicar |
|------|----------------|
| Google Cloud PROD / org verification | Conta/organização sob a LTDA; app display name **Both** |
| Microsoft Entra / Verified Publisher / Partner Center | Entidade legal = LTDA; app display **Both** |
| Supabase PROD | Billing/owner alinhados à LTDA quando conta paga; produto Both |
| Privacy / Terms | Controlador/operador = LTDA; marca Both |
| Contatos institucionais | Domínio bothcalendar.com (e-mails oficiais ainda PENDING_PO) |
| Stripe (quando Live autorizado) | Conta comercial sob a LTDA; brand Both |
| Futuro | Migração opcional para PJ Both independente — planejar republicação/verification |

---

## Conferência cadastral (não inventada; ainda PENDING)

Consulta **read-only** a agregadores públicos baseados em Dados Abertos CNPJ (BrasilAPI, 2026-11-26).  
**Não substitui** extrato oficial da Receita Federal. **Não usar em submissões** até PO/legal confirmar.

| Campo | Valor observado (provisório) | Status |
|-------|------------------------------|--------|
| CNPJ | 43.440.779/0001-79 | PENDING_PO_CONFIRM vs RFB |
| Razão social | RUAN FELIPE SERAFIM DE LIMA LTDA | matches decision |
| Situação | ATIVA | PENDING_PO_CONFIRM |
| Abertura | 2021-09-08 | PENDING_PO_CONFIRM |
| Natureza | Sociedade Empresária Limitada | matches |
| CNAE principal | Reparação e manutenção de computadores… (9511-8/00) | PENDING review (fit produto SaaS) |
| Município/UF | Brasília / DF | PENDING_PO_CONFIRM |
| Endereço completo | *(disponível na consulta pública; omitido aqui até decisão de publicação)* | PENDING_PO — não republicar sem aprovação |
| Capital social | R$ 10.000,00 | PENDING_PO_CONFIRM |

Fontes da consulta provisória: BrasilAPI `cnpj/v1` · agregadores Dados Abertos RFB.  
**LEGAL_DOCUMENT_VERIFICATION=PENDING** até o PO anexar/confirmar extrato Receita Federal (ou cartão CNPJ) e o conjunto público a divulgar.

---

## Regras operacionais

1. Usuário vê **Both**; contratos/verificações usam a **LTDA**.  
2. Não inventar CNPJ, endereço, telefone ou IE.  
3. Não submeter Google/Microsoft/Stripe verification sem `PROVIDER_VERIFICATION` autorizado.  
4. Privacy/Terms permanecem **DRAFT** até aprovação jurídica do texto + dados oficiais.  
5. Preservar caminho futuro para PJ Both independente (republicar policies + re-verificar publishers).

---

## Ainda PENDING (não bloqueia o registro desta decisão)

- E-mails oficiais privacy@ / support@ / legal@ em bothcalendar.com  
- Texto final Privacy/Terms  
- Confirmação RFB do CNPJ/endereço a publicar  
- Autorização de submission Google / Microsoft Partner  
- Stripe Live (continua NO)  
- External beta / public signup (continuam NO)  
