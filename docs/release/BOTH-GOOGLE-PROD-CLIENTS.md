# Both — Google PROD OAuth Clients

**Captured (UTC):** 2026-11-26T05:25:00Z  
**GCP project:** `both-production`  
**Legal publisher (decision):** RUAN FELIPE SERAFIM DE LIMA LTDA · brand **Both**  
**Mutations this sprint:** **NONE** (gcloud CLI absent; Auth Platform console blocked gstatic in automation session)

---

## Separation model

| Client | Purpose | Scopes | Redirect |
|--------|---------|--------|----------|
| **GOOGLE_SIGNIN_PROD** | Supabase Auth social login | Minimal: `openid` `email` `profile` (FE `lib/auth/google.ts`) | `…/auth/v1/callback` |
| **GOOGLE_CALENDAR_PROD** | Calendar sync Edge Function | `calendar.events` + `calendar.calendarlist.readonly` (+ openid/email/profile as coded in `supabase/functions/_shared/providers/google.ts`) | `…/functions/v1/google-oauth` |

Do **not** merge Sign-In and Calendar into one client.  
Do **not** reuse STAGE client IDs/secrets.

---

## Technical redirects (register now when creating clients)

```
https://djxulqyuafhihmuyzvvk.supabase.co/auth/v1/callback
https://djxulqyuafhihmuyzvvk.supabase.co/functions/v1/google-oauth
```

## Branded redirects (add before Custom Domain activate)

```
https://auth.bothcalendar.com/auth/v1/callback
https://auth.bothcalendar.com/functions/v1/google-oauth
```

---

## Branding checklist (console — human)

- App name: **Both**
- Homepage: `https://bothcalendar.com`
- Privacy / Terms: public DRAFT URLs only after legal approve (in-app still DRAFT)
- Support / developer contact: PO-authorized `@bothcalendar.com` (PENDING)
- Logo: `assets/images/icon.png`
- Authorized domain: `bothcalendar.com` after Search Console ownership
- Audience: External
- Publishing: remain Testing until PO authorizes In production / verification
- Sensitive scopes (Calendar) → verification likely required for external users

**GOOGLE_EXTERNAL_VERIFICATION = PENDING** — do not submit without `PROVIDER_VERIFICATION` authorization.

---

## Gates

| Gate | Value |
|------|-------|
| GOOGLE_PROD_PROJECT | **PASS** (project exists per prior verified session; this session could not re-load Auth Platform JS) |
| GOOGLE_PROD_BRANDING | **PARTIAL** (plan ready; not applied) |
| GOOGLE_PROD_SIGNIN_CLIENT | **PREPARED** (not created this sprint) |
| GOOGLE_PROD_CALENDAR_CLIENT | **PREPARED** (not created this sprint) |

### PO / eng action to create (zero cost)

1. Open Google Cloud Console as Both owner → project `both-production`.  
2. Google Auth Platform → Branding + two Web clients as above.  
3. Store secrets only in GitHub Environment `production` / Supabase PROD secrets — never commit.
