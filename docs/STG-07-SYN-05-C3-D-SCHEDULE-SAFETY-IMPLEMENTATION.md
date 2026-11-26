# STG-07 / SYN-05 — C3-D Schedule Safety (implementation)

## Intent

Prepare fail-closed schedule safety for the STAGE watchdog **without enabling cron**.

## Components

| Path | Role |
|------|------|
| `scripts/syn05-watchdog/schedule-policy.ts` | Versioned policy; `schedule_enabled: false` |
| `scripts/syn05-watchdog/schedule-safety.ts` | Missed/overlap/stale/order evaluation |
| `scripts/syn05-watchdog/schedule-safety.test.ts` | D01–D32 offline coverage |

## Documented future cadence

`interval_minutes = 10` with `max_expected_delay_minutes = 5`, matching the commented cron `*/10` in `both-stage-watchdog.yml`.

## Invariants (C3-D)

- DRY_RUN=1 · WRITE=0 · NETWORK=0
- `schedule_enabled=false` in validated policy
- `cancel-in-progress=false`
- Concurrency group pinned to STAGE project ref
- `may_advance_healthy` always **false** from schedule evaluation
- Workflow YAML schedule remains **commented** (no cron activation)

## Activation

Requires a separate Product Owner activation gate. This delivery does **not** enable schedule.
