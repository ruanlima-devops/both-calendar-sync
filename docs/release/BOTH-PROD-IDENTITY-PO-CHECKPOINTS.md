# Both — PROD Identity & Scenario C — PO Checkpoints

**Captured (UTC):** 2026-11-26T05:25:00Z

---

## Locked decisions

| Item | Status |
|------|--------|
| LEGAL_ENTITY_DECISION | **APPROVED** — RUAN FELIPE SERAFIM DE LIMA LTDA |
| PRODUCT_BRAND | Both |
| OFFICIAL_DOMAIN | bothcalendar.com |
| Supabase architecture | **Scenario C** (STAGE Free org · PROD Pro org) |
| LEGAL_DOCUMENT_VERIFICATION | **PENDING** (RFB / publishable CNPJ+address) |
| PROVIDER_VERIFICATION | **PENDING** |
| CURRENT_COST | **USD 0** |

Option 1 (LTDA as publisher, Both as brand) is the active path.  
Option 2 (future Both PJ) remains open — would require re-verification / policy republication.

---

## Checkpoint A — Cost (blocks Pro / CD / transfer-to-paid)

- [ ] Approve ~USD 35/mo on org **Both Production** (`ufxaefwnhwzxafvajsfg`) only  
- [ ] Confirm payer / payment method / invoice email  
- [ ] Confirm spend cap policy after Pro  
- [ ] Explicit written approval: `PAID_SUPABASE_SCENARIO_C=APPROVED`

**Until then:** no Pro upgrade, no Custom Domain, no chargeable add-ons.

---

## Checkpoint B — Transfer (blocks org move)

- [ ] Confirm target org name/slug  
- [ ] Authorize GitHub disconnect on **Both PROD** only  
- [ ] Authorize transfer Both PROD → Both Production  
- [ ] Expect ref **`djxulqyuafhihmuyzvvk` unchanged**  
- [ ] Plan reconnect GitHub + org-scoped tokens after transfer  

Live blocker today: **GitHub integration connected** (Dashboard transfer dry-run).

---

## Checkpoint C — Google

- [ ] Confirm console access to `both-production` as Both owner  
- [ ] Authorize create GOOGLE_SIGNIN_PROD + GOOGLE_CALENDAR_PROD  
- [ ] Authorize Search Console domain verify `bothcalendar.com`  
- [ ] Separate approval to submit OAuth verification / In production  

---

## Checkpoint D — Microsoft

- [ ] Provision/access **Both-owned** Entra tenant (not EAF `45f2cb41-…`)  
- [ ] Authorize MICROSOFT_SIGNIN_PROD + MICROSOFT_CALENDAR_PROD  
- [ ] Publisher domain + Verified Publisher = separate approval  

---

## Checkpoint E — DNS / FE

- [ ] Approve create `auth` CNAME + ACME TXT when Pro+CD authorized  
- [ ] Approve `app.bothcalendar.com` Worker route for PROD FE  
- [ ] No public signup / invites until EXTERNAL gate  

---

## Checkpoint F — Legal publish

- [ ] Confirm RFB extract / CNPJ + address to publish  
- [ ] Approve Privacy/Terms out of DRAFT  
- [ ] Institutional emails privacy@ / support@ / legal@  

---

## Explicit non-goals until separate approval

External beta · public signup · Stripe Live · SYN-05 paid monitoring · provider verification submit · PROD public deploy
