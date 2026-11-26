# Both — PROD Organization Separation Plan (Scenario C)

**Captured (UTC):** 2026-11-26T05:25:00Z  
**PO target architecture:** Scenario C  
**Mutations this sprint:** **NONE** (no transfer, no Pro upgrade, no Custom Domain)  
**CURRENT_COST:** **USD 0**

Sources: live Dashboard 2026-11-26 · [project-transfer](https://supabase.com/docs/guides/platform/project-transfer) · [requirements](https://supabase.com/docs/guides/platform/project-transfer/requirements) · [what-changes](https://supabase.com/docs/guides/platform/project-transfer/what-changes) · [pricing](https://supabase.com/pricing)

---

## Verified organizations

| Role | Name | Slug / ID | Plan | Projects | Billing |
|------|------|-----------|------|----------|---------|
| STAGE (stay) | Both Calendar Sync | `otaqdspnjsewiymnqbmr` | **Free** | Both STAGE + Both PROD (today) | USD 0; spend cap on |
| PROD target | **Both Production** | **`ufxaefwnhwzxafvajsfg`** | **Free** | **0** (empty) | USD 0; spend cap enabled; no paid invoices observed |

Owner observed on PROD project: `bothcalendarsync@gmail.com` (sole member of source org).  
Same account can see Both Production in Transfer UI → membership in target confirmed for transfer eligibility path.

| Gate | Value |
|------|-------|
| SUPABASE_STAGE_ORG | **VERIFIED** (`otaqdspnjsewiymnqbmr` Free) |
| SUPABASE_PROD_PROJECT | **VERIFIED** (`djxulqyuafhihmuyzvvk` nano sa-east-1) |
| SUPABASE_TARGET_ORG | **CREATED** (`ufxaefwnhwzxafvajsfg` Free, empty) |
| SUPABASE_PROD_TRANSFER_EXECUTED | **NO** |
| SUPABASE_PRO_UPGRADE_EXECUTED | **NO** |
| SUPABASE_CUSTOM_DOMAIN_ACTIVE | **NO** |
| NEW_COST_INCURRED | **NO** |

---

## Transfer eligibility (Dashboard dry-run — Cancel only)

Opened **Transfer project Both PROD** → selected target **Both Production**.

| Check | Result |
|-------|--------|
| Target org selectable | **PASS** — Both Production listed |
| Owner on both orgs | **PASS** (UI reachable; docs require Owner on source) |
| GitHub connection | **BLOCK** — Dashboard: *“Project is currently connected to GitHub. Please disconnect the GitHub integration before transferring…”* |
| Transfer Project button | **Disabled** while GitHub connected |
| Usage restriction Free→Free | Not raised in this dry-run (beyond GitHub block) |
| Overdue invoices | Not raised |
| Free project limit | Not raised (owner already in source; Free→Free skip applies for shared members) |

**SUPABASE_PROD_TRANSFER_ELIGIBLE = PARTIAL**  
Unblocked only after GitHub disconnect on PROD (and re-check Dashboard).  
**Do not disconnect in this sprint** without a separately authorized change window (STAGE also shows GitHub link; disconnect PROD only).

---

## Ref / secrets preservation (official)

Per Supabase *what-changes* (consulted 2026-11-26), transfer **keeps**:

- Project ref / API URL → **`djxulqyuafhihmuyzvvk` preserved**
- API keys (`anon` / `service_role`), JWT secret
- Database, Auth users, Storage, Edge Functions + secrets, Cron, Realtime
- Region (cannot change via transfer)

**Changes / risks:**

- Org-scoped Management API tokens for source org **stop** working for the project
- GitHub integration must be removed before transfer; reconnect after on target org
- Billing moves to target org after transfer
- Free→Pro: no DB downtime (Nano stays Nano until resized)
- Custom Domain remains unavailable until target is Pro + add-on paid

**SUPABASE_TRANSFER_RISK:** MEDIUM operational (GitHub disconnect/reconnect, org tokens, future Pro invoice) · LOW data (ref+DB preserved) · ZERO cost if transfer stays Free→Free before upgrade.

---

## Scenario C cost model (reference, not a promise)

After **separate** PO paid approval on **Both Production** only:

| Line | Estimate |
|------|----------|
| Pro subscription (PROD org) | ~USD 25 / mo |
| Compute credit | −USD 10 (covers first Micro; Nano often covered similarly) |
| Custom Domain `auth.bothcalendar.com` | ~USD 10 / mo / project |
| **Target total** | **~USD 35 / mo** |

STAGE remains Free in `otaqdspnjsewiymnqbmr` → avoids second project compute on Pro (~USD 10 vs Scenario B ~USD 45).

What can change cost: egress/MAU/disk overages if spend cap off; PITR; extra projects; pricing changes; currency/tax.

---

## Authorized future cutover (NOT this sprint)

1. PO confirms paid spend on **Both Production** only.  
2. Add payment method + billing identity (LTDA) on target org — **no upgrade yet** if preferred.  
3. Disconnect **GitHub** from Both PROD only.  
4. Transfer Both PROD → Both Production (expect ref `djxulqyuafhihmuyzvvk` unchanged).  
5. Upgrade **Both Production** to Pro.  
6. Reconnect GitHub integration on PROD under new org.  
7. Rotate/create org-scoped tokens; update GitHub Environment `production` secrets if org-scoped.  
8. Custom Domain + OAuth (see sibling docs).

**Preferred order note:** Free→Free transfer then Pro upgrade keeps CURRENT_COST=0 until step 5. Alternately upgrade target to Pro first then transfer Free→Pro (also zero downtime); still requires paid approval before Pro.

---

## SUPABASE_REQUIRED_PO_ACTION (now)

1. Acknowledge Scenario C target org **`ufxaefwnhwzxafvajsfg`**.  
2. **Do not** upgrade or transfer until paid approval sprint.  
3. Schedule GitHub disconnect window before transfer.  
4. Keep STAGE on Free org `otaqdspnjsewiymnqbmr`.  
5. Confirm billing email / Tax ID (CNPJ) only after `LEGAL_DOCUMENT_VERIFICATION`.
