# Both — STAGE Test Evidence (2026-11-25)

No secrets / tokens / PII beyond synthetic emails.

## Frontend

| Check | Evidence |
|-------|----------|
| Home/Login/Sign-up/Forgot/Onboarding/Calendars/Paywall HTTP | 200 |
| Title | Both STG (`APP_VARIANT=preview`) |
| Bundle | `entry-878a48c53b664f983e4b9f7ae8268256.js` |
| Worker | `64b2e988-e73b-4c23-a57a-7be8f47d6846` |
| Supabase ref in bundle | `qszggrrjhcwltnmxpxcy` |
| Signup synthetic | `e2e.stage.mvp+signup1@bothcalendar.test` → `/confirm-email` |

## Deploy STAGE

| Run | SHA | Result |
|-----|-----|--------|
| 45713964301 | #51 `1d05399` | SAFE_SKIP success |
| 45715193954 | #50 `b4f76af` | FAIL migration history drift |
| 45715852516 | #52 `f2e9223` | SUCCESS DEPLOY_CANDIDATE_BOTH |
| 45717064772 | #53 `95e56da` | SUCCESS DEPLOY_CANDIDATE_FUNCTIONS; billing-webhook v16 |

## Function probes (no auth)

| Function | HTTP / body |
|----------|-------------|
| google-oauth | 401 UNAUTHENTICATED |
| microsoft-oauth | 401 UNAUTHENTICATED |
| disconnect-calendar | 401 missing auth header |
| sync-calendar | 401 missing auth header |
| billing-webhook | INVALID_SIGNATURE |

## Local / CI tests

| Suite | Count | Result |
|-------|-------|--------|
| Vitest #50 (CI) | 738 | PASS |
| Vitest billing reconcile local | 830 | PASS |
| OAuth live STAGE | — | NOT_EXECUTED / BLOCKED |
| Stripe Test STAGE | — | NOT_EXECUTED |
| Sync live | — | NOT_EXECUTED |

## Security gates

| Gate | Value |
|------|-------|
| DEPLOY_SAFETY_ALLOW_CANDIDATE after windows | `0` |
| SEC-07 assert on OAuth deploy | ok |
| PROD mutation | none |
| Legacy project | untouched |
