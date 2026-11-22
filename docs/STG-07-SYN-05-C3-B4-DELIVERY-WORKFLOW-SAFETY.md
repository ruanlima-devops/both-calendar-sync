# STG-07 / SYN-05 — C3-B.4 Entrega 2: Inert Delivery Workflow Safety

## Purpose

Certify that `.github/workflows/both-stage-watchdog-delivery.yml` may land on `develop` only while remaining structurally non-executable, under a fail-closed Deploy Safety allowlist.

## Certified workflow

- Path (exact): `.github/workflows/both-stage-watchdog-delivery.yml`
- SHA256: `9bf332340ac158eb3a80edb317e3a2adbc358843540ae5c144a700175820a44d`
- Triggers: `on: {}` (no schedule / dispatch / push / pull_request / workflow_run)
- Permissions: `contents: read` only — no `issues:write`
- Job guard: `if: ${{ false }}` with refuse step
- No secrets, no remote calls, no Delivery script execution

## Classifier policy

Implemented in `scripts/deploy-safety/inert-delivery-workflow.ts` + `classify-deploy-changes.ts`:

1. Exact path match only (renames / near-miss names → `UNKNOWN_BLOCKED`).
2. Content digest must equal the pinned SHA256.
3. Structural inertness checks (triggers, permissions, secrets, curl/gh/supabase, aliases, uses, URLs).
4. Mixed changesets with migrations, Edge Functions, or `deploy-stage.yml` → `UNKNOWN_BLOCKED`.
5. Filename alone never yields `SAFE_SKIP`.

## Explicit non-goals

- Live Delivery / Issues write
- schedule / workflow_dispatch enablement
- NETWORK=1 / WRITE=1
- Altering `deploy-stage.yml`

## Residual risks

- Search+create Issues remains non-atomic (unchanged).
- SHA256 integrity ≠ authenticity of origin.
- `scripts/deploy-safety/**` remains SAFE_SKIP; pin+structure changes in the same PR require human review.
- Delivery remains disabled; C3-B.5 not authorized.
