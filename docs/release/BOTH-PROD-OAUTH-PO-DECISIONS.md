# Both — PROD OAuth PO Decisions

**Authorizations locked:** BETA_EXTERNAL_ACCESS=NO · PUBLIC_LAUNCH=NO · STRIPE_LIVE=NO

## Decisions requiring PO

| # | Decision | Options / notes | Blocks |
|---|----------|-----------------|--------|
| 1 | Legal entity for publishers | Keep **RUAN FELIPE SERAFIM DE LIMA LTDA** interim vs wait for Both company | Google/MS verification, invoices |
| 2 | Support / privacy / developer emails | Must be official Both addresses | Consent screen |
| 3 | Approve Privacy + Terms for public host | Until then DRAFT only | Verification submit |
| 4 | Upgrade Supabase org to **Pro** (~$25/mo) | Required for Custom Domains | Branded Auth URL |
| 5 | Approve Custom Domain add-on (~$10/mo) for `auth.bothcalendar.com` | Official Supabase feature only | Enterprise branding on consent |
| 6 | Approve public DNS for `app.` / `auth.` | Zero $ DNS; public exposure risk | FE + Auth routing |
| 7 | Authorize Google verification **submission** | Agent prepares; PO submits/approves | Multiweek refresh tokens |
| 8 | Provide Both-owned Entra admin + Partner ID path | Current az = EAF tenant (wrong) | MS PROD apps + verified publisher |
| 9 | Confirm Sign-In vs Calendar client separation | Recommended; code already separates | — |
| 10 | When to re-enable PROD signup | Keep disabled until invite gate + EXTERNAL=YES | External users |

## Safe actions already taken / in PR

- Discovered PROD ref `djxulqyuafhihmuyzvvk`
- Disabled PROD “Allow new users to sign up” (session)
- Created GCP project **Both Production** (`both-production`) — $0 create
- Documented architecture, redirects, costs, verification packages
- Hardened Deploy PROD Internal expected-ref check

## Do not do without PO

- Enable Supabase Custom Domain (paid)
- Upgrade to Pro without approval
- Submit Google/Microsoft verification
- Public DNS cutover for app/auth
- Stripe Live
- External invites
- Copy STAGE users/tokens
