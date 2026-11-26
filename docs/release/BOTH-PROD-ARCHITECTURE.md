# Both — Production Architecture

**Captured (UTC):** 2026-11-26T04:45:00Z  
**Strategy (PO):** STAGE = internal QA only · PROD = all external users (incl. closed beta)  
**External access now:** **NO**

---

## Observed inventory (independent)

| Component | STAGE (observed) | PROD (observed) |
|-----------|------------------|-----------------|
| Supabase | `qszggrrjhcwltnmxpxcy` “Both STAGE” sa-east-1 ACTIVE | **`djxulqyuafhihmuyzvvk` “Both PROD”** sa-east-1 nano |
| Organization | Both Calendar Sync `otaqdspnjsewiymnqbmr` | same · **Free** plan |
| Cloudflare account | `61b030810fd93e4f3ca35bebd756ccb8` | same |
| Worker | `both-calendar-sync-stage` → `stage.bothcalendar.com` | **No** prod worker yet (`wrangler.prod.jsonc` prepared) |
| DNS | apex / www / stage → CF anycast | `app.` / `auth.` **no records** |
| Stripe | Test `acct_1Uc9CcFbkGjeaJ48` | Live **not** authorized |
| Google Cloud | `both-stage` | **`both-production`** created |
| Microsoft Entra | STAGE docs; az CLI on EAF tenant | Both tenant **not accessible** here |
| Legacy Supabase | `sknpqjodttkpttaytdut` | **Forbidden — never use** |

---

## Custom domain (Auth branding)

Official Supabase Custom Domains only:

- Requires **Pro+** org
- Add-on **~$10/domain/month/project**
- Proposed host: `auth.bothcalendar.com` → CNAME `djxulqyuafhihmuyzvvk.supabase.co`

`PROD_CUSTOM_DOMAIN_ELIGIBLE=BLOCKED` on Free  
`PROD_CUSTOM_DOMAIN_COST_APPROVAL=PENDING`  
`PROD_CUSTOM_DOMAIN_ACTIVE=NOT_EXECUTED`

---

## Isolation model

```
develop ──► Deploy STAGE ──► qszg… + stage.bothcalendar.com
                 │
manual PROD_INTERNAL ──► djxul… + both-calendar-sync-prod Worker
                         (signup disabled; Stripe Live OFF; no public DNS until PO)
```

Rules:
- No shared service_role / webhook / OAuth secrets.
- Separate Google Sign-In vs Calendar clients; separate MS Sign-In vs Calendar apps.
- No STAGE callbacks on PROD clients.
- No STAGE data copy into PROD.
- SEC-07 tombstone remains on sync-calendar.

See also: `BOTH-PROD-OAUTH-ENTERPRISE-ARCHITECTURE.md`.
