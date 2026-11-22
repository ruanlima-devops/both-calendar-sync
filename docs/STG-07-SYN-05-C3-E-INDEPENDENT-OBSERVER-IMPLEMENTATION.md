# STG-07 / SYN-05 — C3-E Independent Observer (implementation)

## Intent

Offline-testable independent observer for primary STAGE watchdog health.

## State model

| Classification | Meaning |
|----------------|---------|
| DISABLED_INTENTIONALLY | Schedule OFF (canonical now) — **not HEALTHY** |
| EXPECTED_BUT_MISSING | Schedule expected; no/late success |
| RUNNING | In-progress within stale budget |
| FAILED | Latest conclusion failure/timeout |
| STALE | In-progress too long / heartbeat aged |
| OBSERVER_BLIND | Cannot read Actions source |
| UNKNOWN | Invalid time / unrecognized |
| HEALTHY | Success within interval+grace **and** schedule_expected |

## Independence gaps (documented)

- Same GitHub Actions platform as primary (shared dependency).
- Separate workflow file ≠ external platform independence.
- Issues must never be sole evidence of health.
- Alert channel remains **inactive** (`dispatchObserverAlert` always `sent:false`).

## Activation

Remote periodic observation requires a separate PO operational gate. C3-E ships code + tests only.
