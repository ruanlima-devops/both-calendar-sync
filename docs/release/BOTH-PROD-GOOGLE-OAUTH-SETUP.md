# Both — Google PROD OAuth Setup

**Status:** In progress · secrets never committed  
**Account observed:** `ruan.lima406@gmail.com`  
**Existing GCP project for STAGE:** `both-stage` (ID `both-stage`)  
**PROD GCP project:** **Both Production** / ID `both-production` — **CREATED** (console, $0)  
**OAuth consent:** Platform shows “ainda não está configurada” — branding/clients wizard **not finished** in this session (Google Auth Platform UI project picker flaky under automation).

## Clients (dedicated)

| Client display name | Purpose | Redirect URI |
|---------------------|---------|--------------|
| Both PROD — Sign In | Supabase Auth social login | `https://auth.bothcalendar.com/auth/v1/callback` **when** custom domain active; until then `https://djxulqyuafhihmuyzvvk.supabase.co/auth/v1/callback` |
| Both PROD — Calendar Sync | Edge `google-oauth` | `https://auth.bothcalendar.com/functions/v1/google-oauth` **or** `https://djxulqyuafhihmuyzvvk.supabase.co/functions/v1/google-oauth` |

Exact Calendar URI must match `GOOGLE_REDIRECT_URI` Edge secret (source: `google-oauth/index.ts`).

## Consent screen (target)

- App name: **Both** (brand)
- Legal / org verification entity: **RUAN FELIPE SERAFIM DE LIMA LTDA** (PO APPROVED; CNPJ confirm PENDING)
- Audience: **External**
- Authorized domain: `bothcalendar.com` (after Search Console verification)
- Homepage: `https://bothcalendar.com`
- Privacy / Terms: approved public URLs only (currently DRAFT in-app)
- Support / developer contact: PO-authorized @bothcalendar.com addresses
- Logo: `assets/images/icon.png` (official Both asset)
- Do **not** submit verification until `PROVIDER_VERIFICATION` authorized

## Scopes

**Sign-In:** `openid email profile` (non-sensitive).

**Calendar Sync (code):**

- `https://www.googleapis.com/auth/calendar.events` — **sensitive**
- `https://www.googleapis.com/auth/calendar.calendarlist.readonly` — **sensitive**
- plus openid/email/profile

Do not widen scopes for QA convenience.

## Publishing / verification

STAGE Calendar app historically **Testing** → refresh tokens ≈ **7 days** for external test users — unsuitable for multiweek closed beta.

PROD path:

1. External audience
2. Publish **In production** (may still require verification for sensitive scopes)
3. Submit verification with privacy, demo video, scope justification — **PO must authorize submission**
4. Brand / domain verification

`GOOGLE_PROD_VERIFICATION=PENDING` until Google approves.

## Secret placement (names only)

- Supabase Auth → Providers → Google (Sign-In client)
- Edge secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- GitHub Environment `production`: mirror IDs only if CI needs them (prefer Edge-only for secrets)

## Checklist

- [ ] GCP project Both Production exists
- [ ] Calendar API enabled
- [ ] Consent screen configured
- [ ] Sign-In Web client created
- [ ] Calendar Web client created
- [ ] Domain verified
- [ ] Privacy/Terms public + approved
- [ ] Verification package prepared (not submitted without PO)
- [ ] Secrets stored in PROD only
- [ ] STAGE clients unchanged
