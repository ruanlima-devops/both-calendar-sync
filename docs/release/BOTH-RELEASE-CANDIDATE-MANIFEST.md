# Both — Release Candidate Manifest (Closed Beta)

**RC ID:** `BOTH-RC-CLOSED-BETA-20261126`  
**Captured (UTC):** 2026-11-26T03:42:53Z  
**Kind:** Technical release candidate for controlled closed beta — **not** a production release.  
**Tag:** Not created (tagging risks unintended automation; create only with PO approval).

---

## Immutable pointers

| Layer | Value |
|-------|--------|
| Git `develop` (RC base at capture) | `32f2b1903bcaa6fc1aeb6294baa836a8651dcc92` |
| Git `main` | `388fd4e1287b3d668c1c3110cb278f4cc28f1ccd` |
| STAGE web | https://stage.bothcalendar.com |
| Frontend asset | `/_expo/static/js/web/entry-ad241859cc999225bec4d76a6b9e5594.js` |
| Supabase STAGE | `qszggrrjhcwltnmxpxcy` |
| Stripe | Test Mode only (`livemode=false`) |
| Sync certification run | `BOTHQA20261126022819` |

Post-RC governance/docs PR may advance `develop` tip; STAGE FE asset above remains the certified browser build until the next intentional Worker publish.

---

## Edge Functions (STAGE, selected)

| Slug | Version (list) | Notes |
|------|----------------|-------|
| google-oauth | 26 | |
| microsoft-oauth | 25 | |
| sync-now | 22 | Active sync path |
| reconcile-sync | 23 | |
| google-webhook / microsoft-webhook | 22 | |
| billing-webhook | 18 | Includes cancel_at inference |
| billing-portal | 16 | Reconcile-before-portal |
| billing-checkout | 16 | |
| sync-calendar | 23 | **SEC-07 tombstone → HTTP 410** |
| delete-account | 19 | |

---

## CI / Deploy evidence (recent)

| Event | Run | Result |
|-------|-----|--------|
| Deploy STAGE #63 (billing cancel) | [45748455812](https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45748455812) | success |
| Deploy STAGE #64 (docs) | [45750039896](https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45750039896) | success |
| CI PR #63 | [45747817966](https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45747817966) | Application+Supabase PASS |
| CI push develop #64 | [45750039882](https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45750039882) | Application PASS; Supabase FAIL (runner port 54322 busy — infra flake) |

Vitest on develop tip (prior closure): **847 PASS**.

---

## Source-to-deploy rule

1. Merge to `develop` with required checks.  
2. Deploy STAGE via official `Deploy STAGE` workflow.  
3. Verify live HTML asset hash ≠ preview-only Builds.  
4. Do **not** treat Cloudflare preview URLs as STAGE production Worker.

---

## Explicit non-goals of this RC

- No PROD deploy / tag / Live Stripe.  
- No external user invitations.  
- No SYN-05 activation.  
- No claim of completed LGPD legal sign-off.
