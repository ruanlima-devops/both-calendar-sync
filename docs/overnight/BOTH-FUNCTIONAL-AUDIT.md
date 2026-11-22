# BOTH Functional Audit — 2026-11-23

**Truth baseline:** `origin/develop` @ `99e71b745fc59f97dd97efce8f7d5cf8fe2f0e9d`  
**Overnight worktree:** `/Users/ruan/Documents/work12-overnight-sprint` @ `overnight/sprint-2026-11-23` (local product + billing ports)  
**PR #15:** OPEN head `78979549…` — **not modified**  
**Method:** code + local tests only. No STAGE live re-run.

## Summary counts (develop truth before overnight ports)

| Class | Approx |
|-------|--------|
| IMPLEMENTED_VERIFIED | few (delete-account lib, SEC-07 tombstone, sync engine unit areas) |
| IMPLEMENTED_UNVERIFIED | many UI/session/billing surfaces |
| PARTIAL | OAuth complete, disconnect UX web, recurrence masters, webhook timing-safe compare (pre-port) |
| MISSING (develop) | email/password auth, recovery UI, onboarding finish gates, paywall cancel notice |
| BLOCKED | SMTP E2E, live OAuth consent, live Stripe, SYN-05 collector PAT |
| POST_LAUNCH | Apple web N/A, advanced conflict merge UI |

## Domain matrix (condensed A–AV)

See also `_raw-frontend-audit.md` and `_raw-backend-audit.md` for full evidence tables.

### Auth
- **A/D/E/F/G email+recovery:** develop MISSING → **ported overnight** (IMPLEMENTED_OFFLINE, SMTP MANUAL_GATE)
- **B Google auth:** IMPLEMENTED_UNVERIFIED (`lib/auth/google.ts`)
- **H session:** IMPLEMENTED_UNVERIFIED (`context/session.tsx`)
- **I logout:** IMPLEMENTED_UNVERIFIED (settings)

### Onboarding
- Theme/name: IMPLEMENTED_UNVERIFIED
- Connect UX web Alert no-op: PARTIAL → overnight uses `showMessage` + inline errors
- Finish without calendars: PARTIAL → overnight gates via `canFinishOnboarding`
- First-sync confirmation step: MISSING → overnight step "Pronto" with copy helpers

### Calendar OAuth / sync
- Connect Google/MS: IMPLEMENTED_UNVERIFIED (legacy popup on develop)
- Ticket/nonce/finalize: GAP on develop → **PR #15** (do not duplicate)
- Bidirectional sync / anti-loop / idempotency: IMPLEMENTED_VERIFIED (unit)
- Recurrence series masters: PARTIAL (unsupported by design)
- `paused_by_entitlement` unread: BUG on develop → **overnight ported BIL-02 sync gate**
- Watch recreate without last_notification: BUG (documented; not changed — near OAuth watch path)

### Billing
- Trial/checkout/portal: IMPLEMENTED_UNVERIFIED
- Webhook idempotency/signature: PARTIAL on develop → **overnight ported hardening + tests**
- Cancel-before-delete: MISSING on develop → **ported**
- Paywall cancel notice: PARTIAL → **wired overnight**

### Account / security
- Delete account typed + settings: IMPLEMENTED_VERIFIED (lib) / UNVERIFIED UI
- SEC-07 tombstone: IMPLEMENTED_VERIFIED
- RLS SEC-10 migration present locally: IMPLEMENTED_UNVERIFIED (no remote apply this sprint)

### Ops
- SYN-05: NO-GO; Collector secret storage BLOCKED; Watchdog/Observer/Cron/Delivery OFF
- Deploy safety classifier present; now included in default vitest include

## Overnight deltas vs develop (product)

| Area | Status after overnight |
|------|------------------------|
| Email/password + recovery screens | IMPLEMENTED_OFFLINE |
| Onboarding UX gates + a11y progress | IMPLEMENTED_OFFLINE |
| Billing webhook hardening + BIL-02/05 | IMPLEMENTED_OFFLINE |
| Entitlement gate helper wired | IMPLEMENTED_OFFLINE |
| Collector isolation policy module | IMPLEMENTED_OFFLINE (docs+tests) |
| PR #15 OAuth lifecycle | UNTOUCHED |

## Risks preserved
- Do not merge overnight OAuth-adjacent files against PR #15 without audit (`onboarding/index.tsx` will conflict lightly).
- Primary dirty worktree `/Users/ruan/Documents/work12` still holds overlapping WIP — do not overwrite.

## Follow-up from audit agents (2026-11-22T06:10Z)

- Web calendars Alert.alert → confirmAction/showMessage: **FIXED** overnight.
- Collector token name alignment (LOGS_READ preferred): **FIXED** offline; storage still BLOCKED.
- Still open / PR15-owned: OAuth callback ticket (D2), watch-policy (D6), disconnect shared module.
- Still open offline candidates (not done this follow-up): profiles.plan_tier RLS (D13), scheduling tables RLS (D14), MS revoke skipped (D15).
- Billing D5/D7/D12 addressed in overnight port; signature already timing-safe.
