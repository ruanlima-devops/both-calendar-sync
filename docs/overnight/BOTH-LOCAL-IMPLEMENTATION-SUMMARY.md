# BOTH Local Implementation Summary — Overnight 2026-11-23

## Worktree
- Path: `/Users/ruan/Documents/work12-overnight-sprint`
- Branch: `overnight/sprint-2026-11-23` (from `origin/develop` @ `99e71b7`)
- `node_modules` symlinked to primary worktree (disk ~13Gi free)

## Preserved
- Primary `/Users/ruan/Documents/work12` dirty PR #15 worktree **untouched**
- PR #15 remote head untouched
- Issues #26/#30 untouched
- No push / PR / merge / deploy / PAT / Logs API / Cron / Better Stack / Stripe live / sync live

## Implementations

### Auth (P0)
- Email/password sign-in/up, forgot, confirm, update password
- Password policy + classified errors (anti-enumeration)
- Identity-safety helpers + tests

### Onboarding (P0/P1)
- Step progress UI, connect loading, web-safe errors (`showMessage`)
- Finish gates (`canFinishOnboarding`)
- Journey helpers + tests
- Calendar step pure toggles

### Billing / account (P0/P1)
- Webhook hardening + signature/idempotency tests
- Cancel-before-delete
- Entitlement sync gate (BIL-02)
- Paywall canceled notice
- Entitlement gate wiring in app layout
- Settings password entry

### Platform
- Vitest includes `scripts/deploy-safety` + `scripts/syn05-collector`
- Collector secret-isolation policy module + fail-closed tests
- PT not-found page

## Quality
| Check | Result |
|-------|--------|
| Vitest baseline develop | 510 / 47 files |
| Vitest after overnight | **742 / 66 files** |
| Typecheck | **PASS** |
| SEC-07 local | **PASS** |
| Deploy Safety tests | included & green via vitest |
| Build (`expo export`) | **NOT RUN** (script may be heavy; not in package as `build`) |

## Risks
- `onboarding/index.tsx` will conflict with PR #15
- `delete-user.ts` / `runtime.ts` need merge audit vs PR #15
- Auth SMTP not live-certified
- calendars web Alert gap deferred (PR #15 file)

## Local commits (`overnight/sprint-2026-11-23`, ahead of `origin/develop`)
- `e24a74d` feat(auth): add native email/password login and recovery
- `fc17767` fix(onboarding): clarify connect steps and finish gates
- `8f2be03` fix(billing): harden Stripe webhooks and entitlement sync gates
- `825e020` docs(overnight): record audit backlog and collector NO-GO policy
- `f145ad7` feat(auth): add web email/password login and recovery (settings entry)
- `d5248a3` fix(billing): wire entitlement gate + paywall cancel notice
- `3003128` feat(onboarding): PT not-found page
- `12ecb7b` docs(overnight): progress checkpoint

## Recommended future PRs (not created)
1. `feat/overnight-auth-password`
2. `feat/overnight-billing-hardening`
3. `feat/overnight-onboarding-ux` (after PR #15)
4. docs overnight pack
