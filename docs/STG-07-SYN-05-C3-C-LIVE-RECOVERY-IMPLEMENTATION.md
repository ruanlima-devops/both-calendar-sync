# STG-07 / SYN-05 — C3-C Live Cross-Run Recovery (implementation)

## Scope

Supervised recovery essay across independent GitHub Actions runs:

`FIRING → HEALTHY_1 (open, streak=1) → HEALTHY_2 (closed, streak=2)`

## Components

| Path | Role |
|------|------|
| `scripts/syn05-watchdog/c3c-recovery.ts` | Phase runner + fingerprint/gates |
| `scripts/syn05-watchdog/c3c-recovery-cli.ts` | Actions CLI (sanitized JSON) |
| `.github/workflows/both-stage-watchdog-recovery.yml` | Manual workflow; job-scoped `issues:write` |
| `scripts/deploy-safety/supervised-recovery-workflow.ts` | Exact-path + digest pin |

## Hard rules

- Fingerprint: `ALERT-01|qszggrrjhcwltnmxpxcy|C3-C|SYNTHETIC|RECOVERY|20261122`
- Never mutate Issue `#26`
- Max one synthetic Issue
- Distinct sample windows per phase (fixed ISO ends)
- Durable state: `<!-- both-syn05-state:v1 -->`
- Defaults remain DRY_RUN=1 / WRITE=0 / NETWORK=0 outside the supervised job
- No schedule; delivery workflow remains OFF

## Certification

Live essay + disablement + matrix: see local (uncommitted) certification report after PO run.
