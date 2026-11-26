# BOTH OAuth PR #15 Integration Gaps — 2026-11-23

**PR #15:** OPEN — `feat/m3-003-oauth-lifecycle` head `78979549cad61438de751584a0ad895855781b8b`  
**Base:** `develop` @ `99e71b7`  
**Overnight:** did **not** modify PR #15 branch, commits, or primary worktree.

## What develop already has
- Authenticated OAuth start + PKCE/state (TTL ~10m)
- Redirect allowlist (with known pathname looseness)
- Token refresh + AUTH_REQUIRED
- Disconnect + best-effort revoke (MS revoke skipped)
- Migration `20261001000001_oauth_completion_ticket.sql` present on develop tip (verify content vs PR before merge)

## What PR #15 adds (from diff name-stat)
- Hardened `oauth.ts` finalize + tests
- Google/Microsoft oauth function rewrites
- Client `oauth-complete` ticket/nonce flow
- `disconnect` shared module + tests
- Watch policy updates
- UI calendars/onboarding/oauth.tsx/session routing tweaks
- deploy-stage.yml + wrangler.jsonc changes (review carefully for deploy safety)

## Conflicts / collision risk with overnight
| File | Overnight touched? | Notes |
|------|--------------------|-------|
| `app/(onboarding)/index.tsx` | YES | Expect merge conflict — both UX + PR small delta |
| `calendars.tsx` / `oauth.tsx` / `lib/oauth*` | NO | Safe |
| `google-oauth` / `microsoft-oauth` | NO | Safe |
| `delete-user.ts` | YES (BIL-05 only) | Audit vs PR15 revoke changes |
| `sync/runtime.ts` | YES (entitlement gate) | Audit vs PR15 watch changes |

## Manual gates still required after merge
1. STAGE OAuth consent Google + Microsoft
2. Ticket TTL expiry / replay rejection live
3. Disconnect revoke Google; document MS skip
4. Popup/browser binding checks
5. Deploy classifier decision on PR files (SAFE_SKIP vs FUNCTIONS)

## Integration plan (future)
1. Merge PR #15 alone
2. Rebase overnight auth/billing/onboarding onto new develop
3. Resolve onboarding + delete-user + runtime manually
4. Port calendars web `confirmAction` immediately after
5. Re-run unit + Deploy Safety + SEC-07 asserts
6. Only then STAGE OAuth E2E

## Independent overnight tests near OAuth
- Allowed: auth password, onboarding journey, calendar lifecycle dry-run
- Forbidden this sprint: competing ticket/finalize implementation
