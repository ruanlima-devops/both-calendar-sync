# BOTH — Deploy Safety OAuth Exact-Path Recovery

**UTC:** 2026-11-25  
**Purpose:** Unblock PR #50 classification without SAFE_SKIP on migrations/functions.

## Change

- Add 8 OAuth **client** paths to `FRONTEND_CLIENT_SAFE_SKIP_EXACT` (44 total).
- Add SAFE_SKIP prefixes `scripts/oauth-local/` and `e2e/oauth/` (local harness only).
- Add SAFE_SKIP exact: `wrangler.jsonc`, `.gitignore`, `vitest.oauth-local.config.ts`.

## Expected PR #50 decision after merge

`DEPLOY_CANDIDATE_BOTH` (`run_db=true`, `run_functions=true`) when package.json is not in the diff (or handled separately).

Migrations + Edge Functions remain deployable — never SAFE_SKIP.

## Guards preserved

- No `app/**` / `lib/**` / `lib/oauth/**` prefix allowlist.
- Content sniff still blocks SQL/secret markers on allowlisted frontend paths.
- Path traversal still UNKNOWN_BLOCKED.
