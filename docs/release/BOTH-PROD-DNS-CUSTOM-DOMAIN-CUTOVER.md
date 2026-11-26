# Both — PROD DNS & Custom Domain Cutover Plan

**Captured (UTC):** 2026-11-26T05:25:00Z  
**Mutations:** NONE (no DNS writes, no Custom Domain activate)  
**Official guide:** https://supabase.com/docs/guides/platform/custom-domains

---

## Hostname architecture

| Hostname | Role | DNS 2026-11-26 | Action now |
|----------|------|----------------|------------|
| `bothcalendar.com` | Marketing / legal | A → Cloudflare proxy | Keep |
| `stage.bothcalendar.com` | STAGE FE Worker | A → Cloudflare | Keep |
| `app.bothcalendar.com` | PROD FE | **No A/CNAME** | Prepare only |
| `auth.bothcalendar.com` | Supabase Custom Domain (Auth+API+Functions) | **No A/CNAME** | Prepare only |

Zone NS: `jimmy.ns.cloudflare.com` / `evangeline.ns.cloudflare.com`  
CF account observed (wrangler): `61b030810fd93e4f3ca35bebd756ccb8`  
Worker config: `wrangler.prod.jsonc` → `both-calendar-sync-prod`, **routes=[]**, `workers_dev=false`

---

## Custom Domain prerequisites (PROD)

1. Org **Both Production** on **Pro+** (today Free — blocked).  
2. Add-on **Custom Domain ~USD 10/mo**.  
3. Subdomain only (not apex) — `auth.bothcalendar.com` OK.  
4. CNAME powered (not A/AAAA alone).  
5. Single custom domain per project.

### Exact DNS records (when authorized)

| Type | Name | Target / value | Notes |
|------|------|----------------|-------|
| CNAME | `auth` | `djxulqyuafhihmuyzvvk.supabase.co` | Low TTL during cutover; CF may require DNS-only (grey cloud) for ACME — follow Dashboard/CLI prompts |
| TXT | `_acme-challenge.auth` | *(issued by `supabase domains create`)* | Ownership / cert |

CLI sequence (future):

```bash
supabase domains create --project-ref djxulqyuafhihmuyzvvk --custom-hostname auth.bothcalendar.com
supabase domains reverify --project-ref djxulqyuafhihmuyzvvk
# After OAuth clients include branded callback:
supabase domains activate --project-ref djxulqyuafhihmuyzvvk
```

### Frontend PROD (separate from Auth CD)

| Type | Name | Target |
|------|------|--------|
| CNAME or Worker route | `app` | Worker `both-calendar-sync-prod` (after PO public DNS approval) |

Do **not** point `app` at Supabase. Do **not** host FE on Custom Domain Auth host.

---

## OAuth ordering constraint

1. Register **both** technical and branded callbacks on Google/MS clients **before** Auth starts advertising custom domain.  
2. Activate Custom Domain.  
3. Auth immediately uses branded callback on consent screens.  
4. Browser-validate consent text; do not promise all technical hosts disappear from every UI.

Confirmed callbacks (code: `lib/oauth/prod-redirects.ts`):

```
https://djxulqyuafhihmuyzvvk.supabase.co/auth/v1/callback
https://djxulqyuafhihmuyzvvk.supabase.co/functions/v1/google-oauth
https://djxulqyuafhihmuyzvvk.supabase.co/functions/v1/microsoft-oauth
https://auth.bothcalendar.com/auth/v1/callback          # after CD
https://auth.bothcalendar.com/functions/v1/google-oauth
https://auth.bothcalendar.com/functions/v1/microsoft-oauth
```

---

## DNS_ARCHITECTURE

**PARTIAL** — apex/STAGE live; `app`/`auth` absent; Custom Domain not eligible on Free.
