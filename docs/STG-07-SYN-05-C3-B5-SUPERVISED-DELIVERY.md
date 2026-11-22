# STG-07 / SYN-05 — C3-B.5 Supervised Delivery (integration)

## Empty-run fix
- Replaced bare `on: {}` (invalid/zero-job push noise) with quoted `"on": workflow_dispatch`.
- Default input `c3_b5_mode=OFF` → job `delivery-off` exits 0 (no Issues write).
- Oneshot path requires `C3-B.5-ONESHOT` + confirm `RUN`.

## Identity
- Collector/Evaluator: no issues:write.
- Top-level workflow permissions: contents:read.
- `issues:write` only on job `delivery-supervised`.
- GITHUB_TOKEN job-scoped; no PAT; no Supabase secrets on Delivery.

## Write gate / quota
- Defaults DRY_RUN=1 WRITE=0 NETWORK=0.
- Supervised oneshot requires C3-B.5 auth bag + synthetic fingerprint + Actions binding + durable Issue-marker quota (max 1 create POST).

## Non-goals
- No schedule, no continuous delivery, no operational alerts, no deploy.
