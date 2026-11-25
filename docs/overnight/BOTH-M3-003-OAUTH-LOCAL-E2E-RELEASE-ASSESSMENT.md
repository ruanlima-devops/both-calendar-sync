# BOTH — M3-003 OAuth Local E2E + Release Impact Assessment

**UTC:** 2026-11-24T20:10:00Z  
**PR:** [#50](https://github.com/ruanlima-devops/both-calendar-sync/pull/50) (DRAFT)  
**Branch:** `feat/m3-003-oauth-lifecycle-reconciled`  
**Worktree:** `/Users/ruan/Documents/work12-m3-003-oauth-reconciliation`  

**No merge · No remote deploy · No live Google/Microsoft OAuth**

---

## A. Autorização e escopo

PO authorization: local development + safe Draft PR update only.

```
M3_003_MERGE_AUTHORIZED=NO
M3_003_REMOTE_DEPLOY_AUTHORIZED=NO
M3_003_OAUTH_LIVE_CERTIFIED=NO
```

---

## B. Preflight

| Check | Result |
|---|---|
| origin / gh auth | PASS |
| develop | `383adb8b902a40f8ecfd30c7e9acfafd49b7ab34` |
| PR #50 | OPEN / DRAFT / MERGEABLE |
| HEAD (start) | `6c8fccd4302e01af9990323da5f13142cf9320b3` |
| PR #15 | intact `78979549…` |
| PR #46 | intact DRAFT `822bcc28…` |
| Issues #26/#30 | OPEN / CLOSED |
| SEC-07 | `sec07_tombstone_ok` |
| Release gate | OFF |
| Deploy STAGE trigger | push `develop` only |
| Linked remote project | **false** (no project-ref) |
| Dirty tree | only prior local report touch + this work |

**PREFLIGHT=PASS**

---

## C. PR #50 HEAD/base

Base: `383adb8…` (develop pós-#45)  
Commits on branch (pre-update): oauth lifecycle cherry-picks + docs cert.

---

## D. Inventário do fluxo OAuth

```
User authenticated (JWT / local Bearer shim)
  → POST start (client_nonce 256-bit) → oauth_states row (nonce hash)
  → Provider mock authorize
  → GET callback (unauthenticated) → completion ticket only (encrypted code)
  → POST finalize (JWT required) → consume ticket (DELETE RETURNING) → connection
  → calendars / onboarding continue
```

Disconnect: `disconnect-calendar` + shared disconnect helpers (owner-scoped).  
SEC-07: sync-calendar untouched.

---

## E. Local environment security

| Control | Evidence |
|---|---|
| No `.env` with remote URLs | NO_DOTENV |
| Supabase CLI linked=false | confirmed |
| Disposable DB host | `127.0.0.1` only |
| `localPgUrl()` refuses supabase.co / STAGE / legado refs | enforced |
| Mock providers bind `127.0.0.1` | yes |
| No real client secrets | mock tokens only |
| Docker full `supabase start` | **FAILED** — containerd I/O errors |

**LOCAL_ENV_SECURITY=PASS** (Postgres/brew path)  
**Supabase local stack=BLOCKED** (Docker I/O)

---

## F. Auth/Postgres setup

- Homebrew `postgresql@17` started.
- Disposable DB: `both_oauth_local_e2e`
- Schema: `scripts/oauth-local/schema.sql` (profiles + oauth_states ticket columns + constraints; **no pg_cron**)
- Connection: `OAUTH_LOCAL_DATABASE_URL=postgresql://ruan@127.0.0.1:5432/both_oauth_local_e2e`
- Adapter: `createPgDb` with real `DELETE/UPDATE … RETURNING`

Auth: local shim uses `Authorization: Bearer <user-uuid>` as stand-in for JWT `sub`.  
**GoTrue / Supabase Auth container: NOT_EXECUTED** (Docker blocked).

---

## G. Migration results (local)

Applied locally via `psql -f scripts/oauth-local/schema.sql` (mirrors `20261001000001_oauth_completion_ticket.sql` columns/constraints without remote cron).

`oauth_states_ticket_complete` constraint verified (rejects incomplete ticket rows).

**M3_003_LOCAL_MIGRATIONS=PASS** (disposable DB only)

---

## H–K. State / ticket / concurrency / CSRF

Postgres integration (`oauth.postgres.integration.test.ts`): **14 PASS**

Includes: state persistence, expired/missing state, opaque ticket, TTL ≤5m, constraint, Attacks A–G, duplicate callback, dual-user isolation, **5-way concurrent finalize → exactly 1 winner**.

**CSRF A–G on real Postgres: PASS**

---

## L. Additional negatives

- Finalize without Authorization → 401 (Playwright)
- Cross-user finalize → 403 (Playwright + PG)
- Ticket replay → 403
- Consent denied → no ticket / no connection

---

## M–O. Google/Microsoft mock + Playwright

Mock server: `scripts/oauth-local/mock-providers.mjs`  
Shim: `scripts/oauth-local/local-oauth-shim.ts`  
Suite: `e2e/oauth/lifecycle.playwright.test.ts` via Chromium

| Case | Result |
|---|---|
| Google happy path | PASS |
| Microsoft happy path | PASS |
| Consent denied | PASS |
| Finalize unauthenticated | PASS |
| Cross-user | PASS |
| Replay | PASS |

**6/6 PASS** (`npm run test:oauth-e2e` / `test:oauth-local`)

Scope note: drives shim + mocks + real PG, **not** full Expo web UI / Onboarding screens (would need `supabase start` + `expo web`).

---

## P. Disconnect/reconnect

Unit/shared disconnect tests in Vitest suite PASS.  
Live revocation NOT executed.  
Playwright disconnect UX against Expo UI: NOT_EXECUTED (no full app stack).

**M3_003_DISCONNECT_RECONNECT=PASS** (unit/helpers) · UI E2E residual

---

## Q. Product regressions

Default `npm test`: **750 PASS** (includes auth/onboarding/calendars/billing/oauth unit + PG integration when env set).

| Area | Result |
|---|---|
| Auth Web unit | PASS |
| Onboarding unit | PASS |
| Calendar UX unit | PASS |
| Paywall unit | PASS |

---

## R. Security review

No HIGH/CRITICAL open findings in reconciled path.

Residual: full GoTrue JWT validation path not exercised in Docker; shim Bearer is local-only and must not ship.

---

## S. Correções aplicadas

1. Playwright landing read `oauth_error` (not only `error`).
2. Dedicated `vitest.oauth-local.config.ts` + npm scripts to avoid PG/Playwright cross-file races.
3. `tsconfig` exclude `scripts/oauth-local` + `e2e` so Deno Edge sources are not typechecked via shim imports.
4. Local PG harness + schema + mock providers + shim.

---

## T. Full test suite

| Suite | Count |
|---|---|
| Vitest default | **750 PASS** / 70 files |
| OAuth local (PG+PW serial) | **20 PASS** |
| Deploy Safety unit | **109 PASS** |

---

## U. Typecheck / lint / build

Typecheck: **PASS**  
Lint: no project lint script  
Build: not required for this gate

---

## V. SEC-07

```json
{"ok":true,"reason":"sec07_tombstone_ok"}
```

---

## W. Deploy Safety classification

Still **UNKNOWN_BLOCKED** (classifier untouched):

- Functions + migration matched correctly
- Unclassified: OAuth client (`app/oauth.tsx`, `lib/oauth*`, `context/session.tsx`, …), package.json, e2e/scripts harness, docs

Conceptual release class: **DEPLOY_CANDIDATE_FUNCTIONS + DEPLOY_CANDIDATE_DB** (+ frontend client ship).  
SAFE_SKIP is incorrect for this PR.

---

## X. Release impact matrix (summary)

| ARTIFACT | PATH | TYPE | REQUIRED |
|---|---|---|---|
| Migration | `supabase/migrations/20261001000001_oauth_completion_ticket.sql` | DB | STAGE db migrate |
| google-oauth | `supabase/functions/google-oauth/index.ts` | Edge Function | functions deploy |
| microsoft-oauth | `supabase/functions/microsoft-oauth/index.ts` | Edge Function | functions deploy |
| disconnect-calendar | `supabase/functions/disconnect-calendar/index.ts` | Edge Function | functions deploy |
| shared oauth | `supabase/functions/_shared/oauth.ts` (+tests) | shared | with functions |
| Client OAuth | `app/oauth.tsx`, `lib/oauth*.ts`, … | frontend | client release |
| Calendars UX touch | `app/(app)/(tabs)/calendars.tsx` | frontend | client release |
| Local harness | `scripts/oauth-local/**`, `e2e/oauth/**` | test-only | no STAGE deploy |

JWT: finalize requires authenticated user (`userFromRequest` in Edge; shim Bearer locally).  
Config: `verify_jwt=false` on google/microsoft oauth entry (callback public) — finalize still authz in-handler.  
Secrets: existing TOKEN_ENCRYPTION_KEY / provider secrets (verify only; not rotated here).

---

## Y. Ordered STAGE release plan (DO NOT EXECUTE)

1. Security + Deploy Safety PO approval (path classification recovery or supervised candidate).  
2. STAGE inventory snapshot (24 fn / sync-calendar v22).  
3. Apply migration `20261001000001_oauth_completion_ticket.sql`.  
4. Deploy Edge Functions: shared bundle via google-oauth, microsoft-oauth, disconnect-calendar.  
5. Ship frontend client with OAuth UX.  
6. Canary: synthetic STAGE users Google then Microsoft.  
7. Live negatives A–G.  
8. SEC-07 re-assert.  
9. Rollback: prior function versions + feature flag / disable finalize.

---

## Z. PR update and CI

- HEAD: `d156faa86ac8f98fde6f4a43949f119d9cfdf151`
- Draft: **YES** (unchanged)
- URL: https://github.com/ruanlima-devops/both-calendar-sync/pull/50
- CI: https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45477255439
- Application SUCCESS · Supabase SUCCESS
- Workers Builds FAILURE (not required)
- PR #15 HEAD unchanged: `78979549…`

---

## AA. Final gates

```
M3_003_PREFLIGHT=PASS
M3_003_LOCAL_ENV_SECURITY=PASS
M3_003_LOCAL_POSTGRES=PASS
M3_003_LOCAL_AUTH=PARTIAL          # Bearer shim; GoTrue NOT_EXECUTED (Docker I/O)
M3_003_LOCAL_MIGRATIONS=PASS
M3_003_STATE_PERSISTENCE=PASS
M3_003_USER_BINDING=PASS
M3_003_PROVIDER_BINDING=PASS
M3_003_BROWSER_BINDING=PASS
M3_003_NONCE_SECURITY=PASS
M3_003_TICKET_SINGLE_USE=PASS
M3_003_TICKET_TTL=PASS
M3_003_TICKET_ATOMICITY=PASS
M3_003_CONCURRENCY=PASS
M3_003_AUTHENTICATED_FINALIZE=PASS # via shim + Edge contract tests
M3_003_ACCOUNT_LINKING_CSRF=PASS
M3_003_GOOGLE_MOCK_E2E=PASS
M3_003_MICROSOFT_MOCK_E2E=PASS
M3_003_PLAYWRIGHT=PASS             # shim+mocks+Chromium; not full Expo UI
M3_003_DISCONNECT_RECONNECT=PASS   # unit; UI E2E residual
M3_003_AUTH_WEB_REGRESSION=PASS
M3_003_ONBOARDING_REGRESSION=PASS
M3_003_CALENDAR_REGRESSION=PASS
M3_003_PAYWALL_REGRESSION=PASS
M3_003_FULL_VITEST=PASS            # 750
M3_003_TYPECHECK=PASS
M3_003_SEC07=PASS
M3_003_DEPLOY_SAFETY_ANALYSIS=PASS
M3_003_RELEASE_IMPACT_MATRIX=PASS
M3_003_RELEASE_PLAN=CONDITIONAL
M3_003_PUSH_GATE=PASS
M3_003_PR50_UPDATED=YES
M3_003_PR50_CI=PASS
M3_003_PR15_PRESERVED=PASS
M3_003_PR46_PRESERVED=PASS
M3_003_ISSUES_PRESERVED=PASS
M3_003_NO_REMOTE_DEPLOY=PASS

M3_003_LOCAL_E2E_CERTIFIED=BLOCKED
  # Blocker: Supabase Auth/GoTrue local stack not started (Docker I/O).
  # Postgres+ticket+CSRF+Playwright mock E2E otherwise PASS.

M3_003_RELEASE_READY=NO
M3_003_MERGE_AUTHORIZED=NO
M3_003_REMOTE_DEPLOY_AUTHORIZED=NO
M3_003_OAUTH_LIVE_CERTIFIED=NO
SYN05=NO-GO
STG07=NO-GO
PROD=NO-GO
BETA=NO-GO
```

---

## AB. Residual risks

1. Docker Desktop I/O prevents `supabase start` (Auth + Edge runtime + Studio).  
2. Deploy Safety UNKNOWN_BLOCKED until separate classification recovery.  
3. Playwright does not drive Expo Router onboarding screens.  
4. Cron cleanup job from migration not applied locally (intentionally omitted).

---

## AC. Next PO decision

1. Fix Docker / authorize re-run with full `supabase start` for GoTrue JWT E2E.  
2. Authorize Deploy Safety OAuth path recovery PR (separate).  
3. Authorize STAGE migration + functions deploy under release gate.  
4. Keep #50 Draft; do not merge until UNKNOWN_BLOCKED resolved or supervised.

STOP.
