# BOTH — M3-003 OAuth Lifecycle Reconciliation E2E

**UTC:** 2026-11-24T14:30:00Z  
**Repo:** `ruanlima-devops/both-calendar-sync`  
**Mode:** RECONCILE → IMPLEMENT → TEST → DRAFT PR → STOP  
**No merge · No remote deploy · No live OAuth**

---

## A. Autorização e limites

PO authorization for local reconciliation of M3-003 onto develop after PR #45.

**Authorized:** isolated worktree/branch, selective cherry-pick of OAuth security commits, tests, Draft PR if CI push-safe.  
**Forbidden:** modify/merge PR #15, merge reconciliation, deploy, live OAuth, alter #46/#26/#30, expand Deploy Safety allowlist, release gate ON.

```
M3_003_MERGE_AUTHORIZED=NO
M3_003_REMOTE_DEPLOY_AUTHORIZED=NO
M3_003_OAUTH_LIVE_CERTIFIED=NO
```

---

## B. Preflight

| Check | Result |
|---|---|
| origin | `git@github.com:ruanlima-devops/both-calendar-sync.git` |
| gh auth | PASS |
| develop HEAD | `383adb8b902a40f8ecfd30c7e9acfafd49b7ab34` (#45) |
| #42/#43/#44/#45/#48/#49 ancestors | PASS |
| PR #15 | OPEN · HEAD `78979549cad61438de751584a0ad895855781b8b` · branch `feat/m3-003-oauth-lifecycle` |
| Merge-base #15↔develop | `344a4b74b047fe0cf98d0477a981aec63e1f1300` |
| PR #46 | OPEN DRAFT · HEAD `822bcc28…` intact |
| Issues #26/#30 | OPEN / CLOSED intact |
| Original worktree | `/Users/ruan/Documents/work12` on #15 branch — **dirty, preserved, not cleaned** |
| Prior recon worktree | `work12-int-oauth-recon` (stale vs develop) — **not reused** |
| New worktree | `/Users/ruan/Documents/work12-m3-003-oauth-reconciliation` |
| New branch | `feat/m3-003-oauth-lifecycle-reconciled` |
| Release gate | OFF |
| SEC-07 | `sec07_tombstone_ok` |
| Branch protection | Application + Supabase strict |
| Deploy STAGE trigger | **push `develop` only** (+ workflow_dispatch unused) |
| Feature/PR push deploy | **NO** |

**M3_003_PREFLIGHT=PASS**

---

## C. Develop baseline

Post-#45 product surface on develop:

- Auth Web (#42)
- Onboarding 4-step (#43)
- Calendar UX `disconnectConfirmCopy` / `confirmAction` (#44)
- Paywall entitlement gate (#45)
- Deploy Safety exact-path recoveries (#48/#49)
- SEC-07 sync-calendar v22 tombstone

---

## D. PR #15 inventory

### Commits (5)

| SHA | Message | Action |
|---|---|---|
| `8182b96` | feat(m3): stabilize oauth connection lifecycle | **CHERRY-PICKED** |
| `d7624c9` | fix(m3): bind oauth completion to authenticated session and browser | **CHERRY-PICKED** |
| `5d0673d` | ci(stage): deploy explicit commit… | **EXCLUDED** (deploy CI) |
| `ce79d98` | ci(stage): Cloudflare Workers static assets | **EXCLUDED** |
| `7897954` | ci(stage): wrangler + stage.bothcalendar.com | **EXCLUDED** |

### Security-relevant surfaces (kept)

- `supabase/functions/_shared/oauth.ts` — state, nonce hash, ticket, finalize
- `supabase/functions/_shared/oauth-finalize.test.ts` — Attacks A–G
- `supabase/functions/google-oauth` / `microsoft-oauth` — callback ticket-only; finalize JWT
- `supabase/migrations/20261001000001_oauth_completion_ticket.sql`
- `lib/oauth.ts` / `lib/oauth-complete.ts` — client nonce 256-bit, ticket strip
- disconnect helpers + delete-user revocation path
- watch-policy / runtime sync helpers

### Deploy surfaces (not taken)

- `.github/workflows/deploy-stage.yml`
- `wrangler.jsonc`
- `.node-version` (CI-era)

**M3_003_PR15_SOURCE_AUDIT=PASS**

---

## E. Conflict matrix

`git merge-tree` develop × PR15 HEAD — textual conflicts:

| File | Type | Resolution |
|---|---|---|
| `.github/workflows/deploy-stage.yml` | TEXT + CI | **Keep develop** (never apply #15 CI commits) |
| `app/(app)/(tabs)/calendars.tsx` | TEXT + SEMANTIC | Keep Calendar UX `disconnectConfirmCopy`; keep OAuth `consumeOAuthComplete` |
| `app/(onboarding)/index.tsx` | TEXT + SEMANTIC | Keep 4-step onboarding + `classifyProviderConnectError` + `ActivityIndicator`; keep `connectCalendar` |

Semantic non-text risks resolved by strategy: develop base + OAuth security commits only.

**M3_003_CONFLICT_MAPPING=PASS**  
**M3_003_DEVELOP_COMPATIBILITY=PASS**

---

## F–H. Compatibility

| Area | Result |
|---|---|
| Auth Web | PASS — session/routing helpers additive; no auth route rewrite |
| Onboarding | PASS — 4 steps, gates, connect error classification preserved |
| Calendar UX | PASS — disconnect confirm copy preserved |
| Paywall | PASS — `_layout` / `paywall.tsx` untouched vs develop |

---

## I. Security invariants

| Invariant | Evidence |
|---|---|
| State bound user/provider/verifier/TTL | `createOAuthState` + oauth.test.ts |
| Client nonce CSPRNG 256-bit (32 bytes) | `Crypto.getRandomBytesAsync(32)` + encode test |
| Nonce stored as SHA-256 only | oauth-finalize.test.ts |
| Callback ≠ link account | ticket-only 302; no connection write |
| Ticket opaque, single-use, TTL 5m | `TICKET_TTL_MS=5*60_000`; Attacks C/D |
| Finalize requires JWT user | `userFromRequest` before finalize |
| Cross-user / wrong browser denied | Attacks A/B |
| Provider mismatch denied | Attack E |
| No tokens in app URL | oauthCallbackRedirect tests |
| Ticket stripped from history | `withoutOAuthTicket` |
| SEC-07 untouched | no sync-calendar path in diff |

---

## J. Account-linking CSRF A–G

Mapped to `oauth-finalize.test.ts`:

| Label | Coverage |
|---|---|
| A | Cross-user ticket+nonce → 403; ticket burnt |
| B | Wrong/missing nonce (other browser) → 403 |
| C | Replay + concurrent double finalize → ≤1 success |
| D | Expired ticket → 403 |
| E | Provider swap Google↔Microsoft → 403 |
| F | Malformed/missing/hash-as-ticket → 403 |
| G | Same user + nonce + provider → connect once |

**M3_003_ACCOUNT_LINKING_CSRF=PASS** (unit/fixtures; not live)

---

## K. Additional negatives

Covered in suite: cancel burns state, legacy state without nonce rejected, token_exchange_failed burns retry, disconnect tests, delete-user path.  
Scenarios H–V that need live multi-tab/session or STAGE: **not live-executed** (authorization forbids).

---

## L. Local implementation

Worktree: `/Users/ruan/Documents/work12-m3-003-oauth-reconciliation`  
Branch: `feat/m3-003-oauth-lifecycle-reconciled`  
Base: `383adb8…`  

Commits:

1. `9ab39ba` — feat(m3): stabilize oauth connection lifecycle (reconciled)
2. `c4f14ea` — fix(m3): bind oauth completion to authenticated session and browser
3. *(docs/test clarification commit follows)*

**M3_003_RECONCILIATION_IMPLEMENTED=PASS**  
**M3_003_SOURCE_BRANCH_CREATED=YES**

---

## M. Local Auth/Postgres integration

Docker: unavailable · `pg_isready`: no response · no local DATABASE_URL  

**M3_003_LOCAL_INTEGRATION=NOT_EXECUTED**

---

## N. Playwright

No `@playwright/test` / no e2e suite in package.

**M3_003_PLAYWRIGHT=NOT_EXECUTED**

---

## O. TypeScript / Vitest

| Suite | Result |
|---|---|
| Focused OAuth/auth/onboarding/calendars/billing | 114 PASS |
| Vitest full | **736 PASS** |
| Typecheck | PASS |
| Deploy Safety unit | 109 PASS |

**M3_003_UNIT_TESTS=PASS**  
**M3_003_TYPECHECK=PASS**

---

## P. SEC-07

```json
{"ok":true,"reason":"sec07_tombstone_ok"}
```

No sync-calendar modification. **M3_003_SEC07=PASS**

---

## Q. Deploy Safety

Diff includes:

- Edge Functions (google/microsoft oauth, disconnect, shared oauth, …)
- Migration `20261001000001_oauth_completion_ticket.sql`
- Frontend client OAuth paths **outside** `FRONTEND_CLIENT_SAFE_SKIP_EXACT`

Classifier output (honest, classifier **not** modified):

```json
{
  "decision": "UNKNOWN_BLOCKED",
  "reasons": ["unclassified_paths", "app/oauth.tsx", "context/session.tsx", "lib/auth/routing.*", "lib/errors.ts", "lib/oauth*"],
  "matched": {
    "migrations": ["…oauth_completion_ticket.sql"],
    "functions": ["…google-oauth…", "…microsoft-oauth…", "…"],
    "safe_skip": ["app/(app)/(tabs)/calendars.tsx"]
  },
  "run_db": false,
  "run_functions": false,
  "may_skip_remote_deploy": false
}
```

**Interpretation:** fail-closed because OAuth client paths are unclassified **and** functions/migration are present. Correct operational stance is **DEPLOY_CANDIDATE_FUNCTIONS + DEPLOY_CANDIDATE_DB** pending separate Deploy Safety path classification recovery (PO) — **not** SAFE_SKIP. Allowlist/classifier intentionally untouched.

**M3_003_DEPLOY_SAFETY=UNKNOWN_BLOCKED** (documented; blocks merge/deploy, not Draft)

---

## R. Security review (independent)

| # | Question | Answer |
|---|---|---|
| 1 | Callback links without JWT? | **No** — ticket only |
| 2 | State bound user/browser? | **Yes** — user_id + nonce hash |
| 3 | Nonce strong/unique? | **Yes** — 256-bit CSPRNG; read-once |
| 4 | Ticket reusable? | **No** — single-use + concurrent test |
| 5 | Race on consume? | **Covered** — ≤1 success |
| 6 | Finalize validates provider/user? | **Yes** |
| 7 | Login CSRF? | N/A calendar-link; auth separate |
| 8 | Account-linking CSRF? | **Mitigated** (A–G) |
| 9 | Open redirects? | Redirect from bound state |
| 10 | Token leakage URL? | **No** |
| 11 | Sensitive logs? | logSafe patterns; no raw ticket |
| 12 | Disconnect authz? | connection scoped helpers |
| 13 | Reconnect cross-account? | finalize user binding |
| 14 | Account deletion revokes? | delete-user + disconnect path |
| 15 | Old insecure code? | **No** — ticket model kept |
| 16 | SEC-07 impact? | **None** |
| 17 | Import break? | typecheck PASS |
| 18 | Priv-esc? | No evidence in review |
| 19 | RLS bypass? | admin client only in functions after auth |
| 20 | JWT verify unexpected? | sync-calendar untouched |

**M3_003_SECURITY_REVIEW=PASS** (code/unit; not live)

---

## S. New branch / commits

See section L. Original PR #15 branch/commits **unchanged**.

**M3_003_PR15_ORIGINAL_PRESERVED=PASS**

---

## T. PR Draft / CI

Push gate: feature branch does **not** trigger Deploy STAGE.  
Draft PR against develop → CI Application + Supabase only.

*(URL filled after open)*

---

## U. Deployment impact

| Class | Paths |
|---|---|
| Functions | google-oauth, microsoft-oauth, disconnect-calendar, `_shared/oauth*`, account/*, sync helpers |
| DB | `20261001000001_oauth_completion_ticket.sql` |
| Frontend | oauth.tsx, oauth client libs, session touch, calendars consume |

Remote: **NOT AUTHORIZED**

---

## V. STAGE live gate plan (future PO)

A. Already on develop: Auth/Onboarding/Calendar/Paywall  
B. This Draft: OAuth lifecycle reconciled  
C. Functions deploy candidate (google/microsoft/disconnect + shared)  
D. Migration apply candidate (completion ticket columns)  
E. Secrets: existing Google/Microsoft OAuth client secrets (STAGE) — verify only, do not rotate here  
F. Redirect URIs: existing `GOOGLE_REDIRECT_URI` / Microsoft equivalents — dashboard verify only  
G–H. Provider consents: manual QA accounts  
I. Supabase Auth JWT for finalize  
J. verify_jwt per function as currently configured — do not flip sync-calendar  
K. Canary: single STAGE user connect Google then Microsoft  
L. Manual consent gates  
M. Live negatives A–G with synthetic STAGE users  
N. Observability: existing logs (no SYN-05)  
O. Rollback: disable finalize routes / pause function versions  
P. Go/No-Go: SEC-07 PASS, migration applied, functions deployed under release gate, CSRF live suite PASS  

**M3_003_RELEASE_PLAN=CONDITIONAL** (code ready; live gates pending PO)

---

## W. Residual risks

1. Deploy Safety UNKNOWN_BLOCKED until OAuth client paths classified in a **separate** recovery PR.  
2. Local Postgres / Playwright not executed.  
3. Live CSRF / multi-tab races not certified.  
4. PR #15 remains OPEN/CONFLICTING as historical source — do not close automatically.  
5. #46 billing still DEPLOY_CANDIDATE separate track.

---

## X. Next PO decision

1. Review Draft PR; keep Ready-for-Review **off** until Deploy Safety recovery for OAuth client paths **or** supervised DEPLOY_CANDIDATE authorization.  
2. Authorize STAGE migration + functions deploy separately (release gate).  
3. Authorize live OAuth consent QA.  
4. Keep PR #15 open as archive or close only after explicit PO instruction.  
5. Do not merge this reconciliation under current UNKNOWN_BLOCKED without further PO scope.

---

## Final gates

```
M3_003_PREFLIGHT=PASS
M3_003_PR15_SOURCE_AUDIT=PASS
M3_003_DEVELOP_COMPATIBILITY=PASS
M3_003_CONFLICT_MAPPING=PASS
M3_003_RECONCILIATION_IMPLEMENTED=PASS
M3_003_AUTH_WEB_COMPATIBILITY=PASS
M3_003_ONBOARDING_COMPATIBILITY=PASS
M3_003_CALENDAR_COMPATIBILITY=PASS
M3_003_STATE_SECURITY=PASS
M3_003_CLIENT_NONCE=PASS
M3_003_COMPLETION_TICKET=PASS
M3_003_AUTHENTICATED_FINALIZE=PASS
M3_003_ACCOUNT_LINKING_CSRF=PASS
M3_003_RECONNECT_DISCONNECT=PASS
M3_003_SECURITY_NEGATIVES=PASS
M3_003_UNIT_TESTS=PASS
M3_003_LOCAL_INTEGRATION=NOT_EXECUTED
M3_003_PLAYWRIGHT=NOT_EXECUTED
M3_003_TYPECHECK=PASS
M3_003_SEC07=PASS
M3_003_DEPLOY_SAFETY=UNKNOWN_BLOCKED
M3_003_SECURITY_REVIEW=PASS
M3_003_SOURCE_BRANCH_CREATED=YES
M3_003_LOCAL_COMMITS=3+
M3_003_PR_DRAFT=<see GitHub>
M3_003_REQUIRED_CI=<observe>
M3_003_RELEASE_PLAN=CONDITIONAL
M3_003_PR15_ORIGINAL_PRESERVED=PASS
M3_003_PR46_PRESERVED=PASS
M3_003_ISSUES_PRESERVED=PASS
M3_003_NO_REMOTE_DEPLOY=PASS

M3_003_RECONCILIATION_CERTIFIED=PASS
  (code+security unit+typecheck+SEC-07+semantic conflict resolution;
   excludes live OAuth, local Postgres, Playwright, merge, deploy)

M3_003_MERGE_AUTHORIZED=NO
M3_003_REMOTE_DEPLOY_AUTHORIZED=NO
M3_003_OAUTH_LIVE_CERTIFIED=NO
SYN05=NO-GO
STG07=NO-GO
PROD=NO-GO
BETA=NO-GO
```

STOP.
