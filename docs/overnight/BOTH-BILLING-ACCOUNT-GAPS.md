# BOTH Billing & Account Gaps — 2026-11-23

## Develop baseline gaps
- Webhook handler thin; limited idempotency/tests
- No cancel-subscription-before-delete
- Entitlement pause flag not enforced in sync path
- Paywall canceled query ignored for UX
- Entitlement gate duplicated inline in layout

## Overnight offline remediation
- Ported `stripe-webhook.ts`, hardened `webhook-handler.ts`, `stripe.ts`, `entitlement.ts`
- Ported `cancel-before-delete` + BIL-05 delete-user path
- Ported BIL-02 entitlement sync gate into `runtime.ts` + provider webhooks
- Added unit tests: stripe.webhook, webhook-handler, entitlement.sync-gate, cancel-before-delete
- Wired paywall canceled notice + entitlement-gate helper

## Remaining gaps
| Gap | Status |
|-----|--------|
| Live Stripe checkout/webhook STAGE re-cert | MANUAL_GATE_REQUIRED |
| RevenueCat native path polish | PARTIAL (not fully ported from WIP) |
| Timing-safe HMAC compare residual review | OPEN |
| Price copy locked to Both Pro R$19,90 fixtures | fixtures only — don't invent prices |
| Account deletion E2E with real providers | LIVE_GATE |
| Portal return UX | UNVERIFIED |

## Strict
- No live Stripe calls, no customers created, no webhook remote changes this sprint.
