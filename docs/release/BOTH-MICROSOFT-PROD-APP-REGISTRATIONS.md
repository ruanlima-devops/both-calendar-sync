# Both — Microsoft PROD App Registrations

**Captured (UTC):** 2026-11-26T05:25:00Z  
**Mutations:** **NONE**  
**Safety:** NEVER use EAF tenant for Both.

---

## Live Azure session (blocked)

| Field | Observed |
|-------|----------|
| `az account show` tenant | `45f2cb41-042b-44a7-8047-e04606844b68` |
| Display | ASSOCIAÇÃO … EAF / `sigaantenado.com.br` |
| User | `ruan.lima.terceirizado@eaf.org.br` |
| Subscriptions listed | EAF only |

**MICROSOFT_BOTH_TENANT = BLOCKED** for mutations in this session.  
No app registrations created.

---

## Target model (when Both-owned tenant available)

| App | Purpose | Scopes | Redirect |
|-----|---------|--------|----------|
| **MICROSOFT_SIGNIN_PROD** | Supabase Auth Azure provider | OIDC basic (openid profile email / offline as Auth needs) | `…/auth/v1/callback` |
| **MICROSOFT_CALENDAR_PROD** | Calendar sync | `offline_access User.Read Calendars.ReadWrite` (`providers/microsoft.ts`) | `…/functions/v1/microsoft-oauth` |

Account types: prefer **personal + work/school** (`common` / multitenant + MSA) matching product audience — confirm with PO.

Publisher domain: `bothcalendar.com` after domain verification.  
Display name: **Both**.  
Legal entity for Verified Publisher: LTDA (not “Both LTDA”).  
**MICROSOFT_PUBLISHER_VERIFICATION = PENDING**

### Redirects

Technical:

```
https://djxulqyuafhihmuyzvvk.supabase.co/auth/v1/callback
https://djxulqyuafhihmuyzvvk.supabase.co/functions/v1/microsoft-oauth
```

Branded (post Custom Domain):

```
https://auth.bothcalendar.com/auth/v1/callback
https://auth.bothcalendar.com/functions/v1/microsoft-oauth
```

---

## Exact PO Microsoft checkpoint

1. Sign out of EAF Azure CLI / portal sessions used for Both work.  
2. Sign in with **Both-owned** admin identity (or create/approve dedicated Entra tenant + custom domain `bothcalendar.com`).  
3. Confirm tenant ID ≠ EAF `45f2cb41-…`.  
4. Authorize creation of the two app registrations (free).  
5. Store client secrets in Supabase PROD / GitHub `production` only.  
6. Do **not** submit Partner Center / Verified Publisher without `PROVIDER_VERIFICATION`.

| Gate | Value |
|------|-------|
| MICROSOFT_PROD_SIGNIN_APP | **PREPARED** |
| MICROSOFT_PROD_CALENDAR_APP | **PREPARED** |
