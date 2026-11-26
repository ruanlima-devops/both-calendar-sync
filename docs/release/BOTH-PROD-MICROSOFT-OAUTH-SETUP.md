# Both — Microsoft PROD OAuth Setup

**Status:** Blocked on Both-owned Entra tenant access from this agent session  
**az CLI current tenant:** EAF / `sigaantenado.com.br` (unrelated) — **no Both apps listed**  
**Do not** register Both PROD apps in the EAF tenant.

## Required apps (dedicated)

| Display name | Purpose | Redirect URI |
|--------------|---------|--------------|
| Both PROD — Sign In | Supabase Auth Azure provider | `https://auth.bothcalendar.com/auth/v1/callback` (or `https://djxulqyuafhihmuyzvvk.supabase.co/auth/v1/callback` interim) |
| Both PROD — Calendar Sync | Edge `microsoft-oauth` | `https://…/functions/v1/microsoft-oauth` exact match via `MICROSOFT_REDIRECT_URI` / `functionPublicUrl` |

## Account types

For closed beta with consumer + optional work accounts:

- Prefer **Accounts in any organizational directory and personal Microsoft accounts** (`common`) — matches code default tenant `common` in `microsoft.ts`.

Corporate tenants may still require admin consent for unverified publishers — document as risk, not a guarantee.

## Scopes (Calendar — code)

`offline_access User.Read Calendars.ReadWrite`

Least privilege relative to product need; do not add Mail/Files.

## Publisher domain / verification

1. Add `bothcalendar.com` as publisher domain in Entra (Microsoft-approved DNS TXT/CNAME proof).
2. Microsoft **Verified Publisher** requires Partner Center + MPN/Partner ID — **not** the same as a display name.
3. Prerequisites often include legal business verification — **PO / legal HUMAN_CHECKPOINT**.

`MICROSOFT_PUBLISHER_VERIFICATION=PENDING` until badge granted.

## Secret placement

- Supabase Auth → Azure provider (Sign-In)
- Edge: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, optional `MICROSOFT_REDIRECT_URI`
- Never copy STAGE secrets

## PO actions

1. Identify / create Both-owned Entra tenant (or company Azure AD).
2. Grant agent or ops admin consent to create app registrations.
3. Partner Center entity: **RUAN FELIPE SERAFIM DE LIMA LTDA** (PO APPROVED). Confirm CNPJ via Receita before forms (`LEGAL_DOCUMENT_VERIFICATION=PENDING`).
4. Approve publisher verification **submission** when ready (`PROVIDER_VERIFICATION` still PENDING).
