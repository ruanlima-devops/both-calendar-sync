# Both — PROD Release Candidate (pointer)

**Source develop:** `daaba11` (+ this preprod PR)  
**STAGE FE (verified):** `entry-be471b8fe43b0f42a2b24aa3bb89b9b2.js`  
**Prior RC:** `BOTH-RC-CLOSED-BETA-20261126` / `BOTH-RELEASE-CANDIDATE-MANIFEST.md`  
**P0 MVP:** PASS (`BOTH-STAGE-P0-FINAL-CLOSURE-E2E.md`)

## PROD deploy status

**NOT DEPLOYED** — Supabase PROD create Forbidden; no Worker; no public DNS.

Internal PROD deploy path prepared: `.github/workflows/deploy-prod-internal.yml` (workflow_dispatch + `production` environment).

## Non-negotiables until PO flips gates

- CLOSED_BETA_EXTERNAL_ACCESS_AUTHORIZED=NO  
- PUBLIC_SIGNUP_AUTHORIZED=NO  
- STRIPE_LIVE_AUTHORIZED=NO  
