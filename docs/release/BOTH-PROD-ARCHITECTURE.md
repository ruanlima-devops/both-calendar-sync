# Both — Production Architecture

**Captured (UTC):** 2026-11-26T03:57:00Z  
**Strategy (PO):** STAGE = internal QA only · PROD = all external users (incl. closed beta)  
**External access now:** **NO**

---

## Observed inventory (independent)

| Component | STAGE (observed) | PROD (observed) |
|-----------|------------------|-----------------|
| Supabase | `qszggrrjhcwltnmxpxcy` “Both STAGE” sa-east-1 ACTIVE | **None** — create Forbidden (token lacks projects create) |
| Cloudflare account | `61b030810fd93e4f3ca35bebd756ccb8` | same account available |
| Worker | `both-calendar-sync-stage` → `stage.bothcalendar.com` | **No** `both-calendar-sync-prod` worker yet |
| DNS | `stage.` / apex / `www` → Cloudflare anycast | `app.bothcalendar.com` **no records** |
| Stripe | Test account `acct_1Uc9CcFbkGjeaJ48` | Live **not** authorized |
| Google OAuth | STAGE Calendar client + Auth client (docs) | **Not provisioned** |
| Microsoft Entra | STAGE Edge client (docs); az list empty in current tenant | **Not verified in this CLI tenant** |
| Legacy Supabase | `sknpqjodttkpttaytdut` | **Forbidden — never use** |

---

## Target isolation model

```
develop ──► Deploy STAGE ──► qszg… + stage.bothcalendar.com
                 │
manual PROD_INTERNAL ──► NEW supabase ref + both-calendar-sync-prod Worker
                         (invite-only; Stripe Live OFF; no public DNS until PO)
```

Rules:
- No shared service_role / webhook / OAuth secrets.
- No STAGE callbacks on PROD OAuth clients.
- No STAGE data copy into PROD.
- SEC-07 tombstone remains on sync-calendar.

---

## Cost estimate (before approval)

| Resource | Est. | Notes |
|----------|------|-------|
| Supabase Free (2nd project) | **$0** if Free plan slot open | Create returned **Forbidden** — needs org owner / elevated token |
| Supabase Pro | ~$25/mo | Only if Free unavailable — **NEEDS_PO_ACTION** |
| Cloudflare Worker | $0 on Free/Workers paid quota | Worker create free; custom domain may need zone |
| DNS `app.` record | $0 | **NEEDS_PO** before public routing |
| Transactional email (Resend/etc.) | varies | Domain auth required |
| Stripe Live | transaction fees | **Not authorized** |
| SYN-05 / Better Stack | paid/ops | **OFF** |

**PROD_COST_APPROVAL=PENDING** for any non-zero recurring spend. Zero-cost create blocked by API Forbidden.

---

## Proposed PROD hostname

Candidate only: `app.bothcalendar.com` (no DNS today).  
Do **not** claim approved. Public DNS = PO decision.
