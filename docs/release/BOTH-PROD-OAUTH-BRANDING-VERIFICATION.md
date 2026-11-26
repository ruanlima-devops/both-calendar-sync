# Both — PROD OAuth Branding & Verification

## Brand assets (repo)

| Asset | Path |
|-------|------|
| App icon | `assets/images/icon.png` |
| Favicon | `assets/images/favicon.png` |
| Splash | `assets/images/splash-icon.png` |
| In-app mark | `components/brand/BothLogo.tsx` |

PROD app display name (config): **Both: Calendar Sync** (`app.config.ts` production variant).

## Legal / policy URLs

| Doc | Status |
|-----|--------|
| Legal entity | **RUAN FELIPE SERAFIM DE LIMA LTDA** (APPROVED) · brand **Both** · see `BOTH-LEGAL-ENTITY-DECISION.md` |
| Privacy | In-app **DRAFT** — names LTDA as operator; CNPJ not published until RFB confirm |
| Terms | In-app **DRAFT** — same |
| Public hosted URLs on bothcalendar.com | **Not published as approved legal** |
| LEGAL_DOCUMENT_VERIFICATION | **PENDING** |
| PROVIDER_VERIFICATION | **PENDING** |

Do not submit Google/Microsoft verification until Privacy/Terms are approved, publicly hosted, and cadastral data are PO-confirmed.

## Google verification package (prepare; do not submit)

1. App name Both + logo  
2. Homepage `https://bothcalendar.com`  
3. Privacy + Terms URLs  
4. Authorized domain ownership (Search Console)  
5. Sensitive scope justification (calendar sync product)  
6. Demo video of connect → sync → disconnect/delete  
7. Data storage / deletion / retention disclosure  
8. Security assessment if Google requires for restricted scopes  

`GOOGLE_PROD_VERIFICATION=PENDING` · submission = **PO HUMAN_CHECKPOINT**

## Microsoft verification package

1. Publisher domain `bothcalendar.com` DNS proof  
2. Partner Center legal entity  
3. Verified Publisher badge process  
4. Admin consent messaging for work tenants  

`MICROSOFT_PUBLISHER_VERIFICATION=PENDING`

## Consent UX expectation

Until Custom Domain (`auth.bothcalendar.com`) is active on Pro + $10 add-on:

- Google/Microsoft may display `djxulqyuafhihmuyzvvk.supabase.co` as redirect host for Sign-In.
- Calendar redirects use the same technical host for Edge Functions.

Branded App name (“Both”) still appears from OAuth client branding even when the callback host is technical.
