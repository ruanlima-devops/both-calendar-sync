# BOTH 1.0 Prioritized Backlog — 2026-11-23

## P0 — launch blockers / data-security

| ID | TITLE | PRODUCT_IMPACT | CURRENT | EXPECTED | ACCEPTANCE | DEPS | RISK | EFFORT | FILES | TEST_PLAN | STATUS |
|----|-------|----------------|---------|----------|------------|------|------|--------|-------|-----------|--------|
| P0-01 | Email/password + recovery web | First-use web | Missing on develop | Full native auth UX | Login/signup/forgot/update + anti-enum messages | SMTP STAGE | Med | M | `app/(auth)/*`, `lib/auth/*` | unit + Playwright later | **DONE_OFFLINE** (overnight) |
| P0-02 | OAuth completion ticket lifecycle | Secure connect | Legacy connected= | Ticket+nonce+finalize | PR #15 criteria | PR #15 merge | High | L | oauth surfaces | PR tests | **BLOCKED_ON_PR15** |
| P0-03 | Web Alert.alert no-op on calendars disconnect | Users can't confirm/errors | Alert.alert | confirmAction/showMessage | Web dialogs work | Avoid PR15 file clash | Med | S | `calendars.tsx` | unit confirm | **DONE_OFFLINE** (conflito futuro c/ PR #15) |
| P0-04 | Billing webhook idempotency + cancel-before-delete | Billing integrity | Weak on develop | Hardened handler + tests | 742 suite includes billing | — | Med | M | `_shared/billing/*` | vitest | **DONE_OFFLINE** |
| P0-05 | Entitlement pause honored by sync | Free users shouldn't sync | pause written unread | gate in runtime/webhooks | entitlement.sync-gate tests | — | High | M | runtime + webhooks | vitest | **DONE_OFFLINE** |
| P0-06 | Onboarding connect errors visible on web | First sync journey | Alert no-op | Inline + showMessage | Cannot finish w/o calendars | — | Med | S | onboarding | journey tests | **DONE_OFFLINE** |

## P1 — fundamental for launch

| ID | TITLE | STATUS |
|----|-------|--------|
| P1-01 | Paywall canceled checkout notice | **DONE_OFFLINE** |
| P1-02 | Entitlement gate pure + wired | **DONE_OFFLINE** |
| P1-03 | Settings alter password entry | **DONE_OFFLINE** |
| P1-04 | PT not-found page | **DONE_OFFLINE** |
| P1-05 | Merge PR #15 after CI + conflict audit | PENDING |
| P1-06 | Legal terms/privacy review | PO/legal |
| P1-07 | SMTP + Auth templates STAGE certification | LIVE_GATE |
| P1-08 | Stripe STAGE webhook E2E re-cert | LIVE_GATE |
| P1-09 | Calendars loading/empty polish | OPEN |
| P1-10 | Deploy Safety always-on in CI include | **DONE_OFFLINE** (vitest include) |

## P2 — experience / reliability

| ID | TITLE | STATUS |
|----|-------|--------|
| P2-01 | Agenda initial loading skeletons | OPEN |
| P2-02 | A11y sweep settings/paywall | PARTIAL |
| P2-03 | Watch channel duplicate on connect | OPEN (careful) |
| P2-04 | Timing-safe webhook compare residual | REVIEW after port |
| P2-05 | Observability structured log port | OPEN |

## P3 — post-launch

| ID | TITLE |
|----|-------|
| P3-01 | Apple Sign-In on web alternatives |
| P3-02 | Advanced conflict merge UI |
| P3-03 | Series master cross-provider mirror |
| P3-04 | SYN-05 collector live activation |

## Next integration order (no push this sprint)
1. Land overnight commits via future PR(s) split: auth → billing → onboarding UX
2. Merge PR #15 separately
3. Fix calendars web confirm post-PR15
4. Live gates SMTP/Stripe/OAuth consent
