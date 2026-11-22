# BOTH 1.0 Launch Roadmap Updated — 2026-11-23

Historical launch date 02/11/2026 was **not met**. No new calendar promise without evidence.

## Pillars

| Pillar | State |
|--------|-------|
| PRODUCT | Auth password + onboarding UX improved offline; OAuth lifecycle waiting PR #15 |
| BILLING | Hardening offline DONE; live STAGE re-cert pending |
| SECURITY | SEC-07 PASS; OAuth ticket pending PR #15; Collector BLOCKED |
| RELIABILITY | Sync engine strong unit; SYN-05 observability NO-GO |
| INFRASTRUCTURE | STAGE project `qszggrrjhcwltnmxpxcy`; deploy safety present |
| BETA | Not started as formal cohort |
| LAUNCH | NO-GO |

## Milestone board

| Milestone | Class | Evidence |
|-----------|-------|----------|
| Web email auth | DONE_UNVERIFIED (overnight) | code+unit; SMTP gate open |
| Calendar OAuth secure finalize | IN_PROGRESS | PR #15 OPEN |
| Bidirectional sync core | DONE_VERIFIED | unit suite |
| Billing entitlements + webhook | DONE_UNVERIFIED | overnight tests; live pending |
| Account deletion | DONE_UNVERIFIED | unit; E2E live pending |
| SYN-05 watchdog/observer | BLOCKED | intentional OFF |
| Legal/compliance copy | NOT_STARTED | placeholders |
| Beta cohort | NOT_STARTED | — |
| PROD provision | NOT_STARTED | forbidden this sprint |

## Scenarios (hypotheses explicit)

### Optimistic (~2–3 eng-weeks after gates unblock)
- PR #15 merges week 1
- SMTP+Stripe STAGE cert week 1–2
- Overnight PRs land
- Closed beta week 3
Assumes: no OAuth regressions, legal copy ready, no collector required for launch.

### Realistic (~4–6 eng-weeks)
- PR #15 + conflict resolution + calendars web fix
- Auth SMTP + OAuth consent E2E
- Billing webhook live cert
- Soft beta
Assumes: SYN-05 remains OFF for launch (acceptable if product SLOs don't require it).

### Conservative (~8–12 eng-weeks)
- Includes SYN-05 collector isolation proof, fuller recurrence support, legal, support runbooks, PROD cutover drills
Assumes: collector becomes launch gate (currently **not** — product can launch with SYN-05 NO-GO if accepted).

## Critical path (product launch without SYN-05)
1. Merge PR #15
2. Land auth+billing overnight branches
3. Fix calendars web confirms
4. SMTP + OAuth consent STAGE
5. Stripe webhook STAGE
6. Beta
7. PROD checklist execution

## Parallelizable
- Legal copy review
- Support docs
- UX polish loading/empty
- Deploy safety CI expansion
- Collector design (non-blocking)

## What actually blocks launch vs deferrable
**Blocks:** secure OAuth finalize, auth recovery usable, billing webhook trust, web disconnect UX, legal minimum, STAGE certs.  
**Defer:** SYN-05 live, series-master mirroring, Apple web, advanced conflict UI.
