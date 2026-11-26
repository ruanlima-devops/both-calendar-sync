# STG-07 / SYN-05 — Inert Infrastructure Provisioning E2E

**Preflight UTC:** 2026-11-22T03:49:49Z  
**SHA LOCK:** `3654e04e9f8b22dcabb678d43baa2b93f8efc85b`  
**Branch:** `feat/syn-05-inert-infrastructure`  
**Worktree:** `/Users/ruan/Documents/work12-syn05-inert-infrastructure`  
**Financial ceiling:** US$ 5/mo new services — prefer **CF Free ($0)** for inert Worker; Paid only with spend hard-cap.

---

## A. Product Owner authorization

Inert adapters + SAFE_SKIP merge + optional inert external resources. No Cron ON, no live heartbeats/alerts, no Logs API live, no Issues write, no Supabase deploy.

## B. Initial preflight

PASS — SHA lock, PR #15 OPEN `78979549…`, #26 OPEN / #30 CLOSED, release gate OFF, SEC-07 ok, STAGE 24 functions sync-calendar v22.

## C. Develop SHA

Lock: `3654e04e9f8b22dcabb678d43baa2b93f8efc85b`

## D. Worktree / branch

`feat/syn-05-inert-infrastructure` @ worktree `work12-syn05-inert-infrastructure`

## E. Code changes

| Path | Purpose |
|------|---------|
| `scripts/syn05-watchdog/github-app-jwt.ts` | RS256 JWT via Web Crypto (PKCS#8) |
| `scripts/syn05-watchdog/github-app-jwt.test.ts` | Offline negatives |
| `scripts/syn05-watchdog/cloudflare-scheduled-adapter.ts` | `scheduled`/`fetch` inert adapters |
| `scripts/syn05-watchdog/cloudflare-scheduled-adapter.test.ts` | Offline negatives |
| `scripts/syn05-watchdog/observer-worker/wrangler.toml` | `crons=[]`, gate OFF |
| This report | Certification |

## F–G. Cloudflare adapter / Web Crypto

- Fail-closed gate OFF → `DISABLED_INTENTIONALLY`  
- Supabase PAT on Worker env → rejected  
- Host pin `api.github.com`  
- No heartbeat send in inert handler  
- `fetch` stub returns inert JSON  
- JWT PKCS#8 only (PKCS#1 rejected)

## H. Offline tests

| Suite | Count |
|-------|-------|
| Watchdog (incl. adapters) | **298 PASS** |
| New adapter tests | 29 PASS |
| Deploy Safety | **90 PASS** |
| SEC-07 legacy | **17 PASS** |

## I. TypeScript / SEC-07

Typecheck PASS · `assertSec07TombstonePresent` → `sec07_tombstone_ok`

## J. Deploy Safety

Changeset under `scripts/syn05-watchdog/` + `docs/` → **SAFE_SKIP** · `run_db=false` · `run_functions=false`

## K–W

*(filled after PR/merge/provisioning)*
