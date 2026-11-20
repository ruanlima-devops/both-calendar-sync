# STG-07 / SYN-05 — C3-A.0.1 LOG READER SECURITY HARDENING

**Gate:** C3-A.0.1
**Authorization:** PO explícito — implementação local + testes offline only
**Kind:** C3-A.0.1 hardening evidence (committed with C3-A.0.2)
**Audit UTC:** 2026-11-19T20:18:00Z (approx.)
**Base SHA:** `0c91c494cefafc49d39bcd169869f1b5f73c3f23`
**Branch (local):** `feat/syn-05-c3-a0-1-log-hardening`
**Worktree:** `/Users/ruan/Documents/work12-syn05-c3-a0-1`

---

## Context

- C3_A_0_READINESS = PASS (prior audit).
- C3_A_REMOTE_READ = NOT CERTIFIED / NOT AUTHORIZED in this gate.
- Preserved: DRY_RUN=1, WRITE=0, NETWORK=0, schedule OFF, no issues:write.
- No live Supabase/GitHub calls. No PAT/secrets. No PR/commit/push.

---

## Files changed (local working tree)

| Path | Change |
|------|--------|
| `scripts/syn05-watchdog/supabase-logs-client.ts` | Window ≤24h assert; completeness; sanitize rows; 404/410; fail-closed errors |
| `scripts/syn05-watchdog/supabase-logs-client.test.ts` | Expanded offline scenarios |
| `scripts/syn05-watchdog/redact.ts` | Stronger patterns + `sanitizeLogEventMessage` |
| `scripts/syn05-watchdog/redact.test.ts` | **New** sanitizer unit tests |
| `scripts/syn05-watchdog/run.ts` | Propagate `completeness === 'incomplete'` → `result_truncated` |
| `scripts/syn05-watchdog/run.test.ts` | Incomplete ≠ HEALTHY; streak does not advance on UNKNOWN |
| `docs/STG-07-SYN-05-C3-A0-1-LOG-READER-HARDENING.md` | This file (local) |

**Not changed:** deploy-stage.yml, watchdog workflow YAML, GitHub Issues adapter, Edge Functions, migrations, billing, PR #15, secrets.

---

## Sanitization policy

- Reuses/extends `redact.ts`.
- New `sanitizeLogEventMessage()` applied to every `event_message` **before** rows leave `SupabaseLogsClient.query`.
- Patterns (best-effort, deterministic, idempotent double-pass):
  - Bearer / Authorization header forms
  - JWTs (`eyJ…`)
  - Stripe/Supabase/GitHub token shapes
  - Emails
  - password/token/api_key assignments + query params
  - Cookie / Set-Cookie
  - URL userinfo `user:pass@`
- Max length default 800 chars.
- Sanitizer failure → `[redacted_unparseable]`.
- Errors via `safeErrorMessage` / `redactText` — no raw response bodies, no tokens in result JSON.
- **Limitation:** free-text cannot be proven perfectly redacted; operational fields (method/status/function path) preserved when present.

---

## Time window policy

- `assertValidLogQueryWindow(start, end, nowMs)` runs **before** any HTTP fetch.
- Required start/end; valid parse; start < end; duration > 0; duration ≤ **24h** (`MAX_LOG_QUERY_WINDOW_MS`).
- End beyond `now + FUTURE_END_TOLERANCE_MS` (5 minutes clock skew) rejected.
- No silent fallback to larger/unbounded windows.
- Call-site policy unchanged: `computeQueryWindow` 15m + 2m overlap in `run.ts`.
- Fake `now` injectable via client options.

---

## Truncation / incompleteness

- No cursor pagination invented (API not documented as cursor-based).
- `LogsCompleteness = 'complete' | 'incomplete'`.
- Page hit limit → `truncated=true`, `completeness='incomplete'`, `ok=true` (rows still usable for FIRING detection).
- Transport/auth/parse failures → `ok=false`, `completeness='incomplete'`, empty rows.
- `run.ts`: any incomplete edge/console/(ok postgres) → `apiError='result_truncated'` → HEALTHY flipped to UNKNOWN.
- Reconcile: UNKNOWN/DATA_UNAVAILABLE → no resolve, no streak advance (tested).

---

## HTTP safety

| Case | Behavior |
|------|----------|
| HTTPS + host allowlist | Required (`api.supabase.com`) |
| STAGE ref only | Hard-fail constructor/query |
| 401/403 | `unauthorized` incomplete |
| 404 | `not_found` incomplete |
| 410 | `endpoint_gone` incomplete — **no** logs.all fallback |
| 429 | Retry-After / backoff; exhaust → `rate_limited` |
| 5xx | Limited retry → `upstream_N` |
| Timeout/abort | `timeout` incomplete |
| Invalid JSON / schema | `invalid_json` / `invalid_payload` |
| Empty `result: []` | Valid complete empty |
| Redirects | `redirect: 'error'` |

---

## Tests

| Suite | Result |
|-------|--------|
| redact + logs-client + run + reconcile + incident-state + c0-readiness | **72 PASS** |
| Full `scripts/syn05-watchdog` + alert-evaluator + deploy-safety | **97 PASS** |
| Typecheck `tsc --noEmit` | **PASS** (exit 0) |
| Dry-run CLI `run.ts` | **PASS** (`dry_run:true`, NETWORK unset/0) |

Offline only — fake `fetchImpl`, no credentials, no live HTTP.

---

## SAFE_SKIP

Classifier on intended path set:

- decision=`SAFE_SKIP`
- run_db=`false`
- run_functions=`false`
- assert_ok=`true`

---

## Security invariants (preserved)

| Flag | Value |
|------|-------|
| DRY_RUN | 1 |
| GITHUB_WRITE | 0 |
| ENABLE_NETWORK | 0 |
| schedule | OFF |
| issues:write | omitted |
| HttpGithubIssues in run.ts | not wired |

---

## Residual risks / limitations

1. Free-text redaction is best-effort, not cryptographic proof.
2. Single-page truncation may mark UNKNOWN often under high STAGE volume.
3. ALERT-01 fingerprint still drifts between FIRING function set and HEALTHY:`none` (pre-existing); incomplete path tested with fixed fingerprint at reconcile.
4. No live Logs API validation in this gate.
5. PAT / secret provisioning remains C3-A.1 only.

---

## Verdicts

| Gate | Verdict |
|------|---------|
| C3_A_0_1_PREFLIGHT | **PASS** |
| C3_A_0_1_REDACTION | **PASS** |
| C3_A_0_1_TIME_WINDOW | **PASS** |
| C3_A_0_1_TRUNCATION | **PASS** |
| C3_A_0_1_HTTP_SAFETY | **PASS** |
| C3_A_0_1_OFFLINE_TESTS | **PASS** |
| C3_A_0_1_DEPLOY_SAFETY | **PASS** |
| **C3_A_0_1_IMPLEMENTATION** | **PASS** |
| C3_A_0_1_READY_FOR_REVIEW | **YES** (local; no commit/PR under this auth) |
| C3_A_REMOTE_READ | NOT AUTHORIZED / NOT CERTIFIED |
| C3_B / C3_C / C3_D / C3_E | NOT AUTHORIZED / OFF / NOT IMPLEMENTED |
| WATCHDOG_REMOTE_ENABLED | NO |
| ALERT_DELIVERY_CERTIFIED | NO |
| SYN-05 / STG-07 / PROD | NO-GO |

---

## Next PO decision

Authorize either:

1. **Review/commit/PR** of this local branch (separate auth), or
2. **C3-A.1** live STAGE Logs Read (ephemeral PAT + NETWORK supervised) — still forbidding WRITE/Issues/schedule/deploy/PROD.

**Note:** C3-A.0.1 produced local changes; C3-A.0.2 covers controlled commit/push/draft PR.
