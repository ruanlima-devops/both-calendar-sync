# BOTH — Deploy Safety Calendar + Paywall Classification Recovery E2E

**UTC start:** 2026-11-24T04:02:52Z  
**PO authorization:** exact-path classifier recovery for #44/#45 — no merge of those PRs  
**Mode:** fail-closed; no Supabase deploy

## A. PO authorization

Expand `FRONTEND_CLIENT_SAFE_SKIP_EXACT` only with paths proven client-only from PR #44/#45 audits. Do not merge #44/#45.

## B. Preflight

| Item | Value |
| --- | --- |
| develop | `8abd380` |
| #42/#48/#43 | MERGED |
| #44 | DRAFT HEAD `12f95dd` MERGEABLE |
| #45 | DRAFT HEAD `9514845` MERGEABLE |
| #15/#46/#26/#30 | preserved |
| release gate | OFF |
| SEC-07 | `sec07_tombstone_ok` |
| PREFLIGHT | **PASS** |

## C. PR #44 diff audit

| Path | Status | Runtime | Deploy target | Evidence |
| --- | --- | --- | --- | --- |
| `app/(app)/(tabs)/calendars.tsx` | M | Expo client | none | Alert→confirmAction; still may invoke existing disconnect-calendar at runtime — source change does not republish EF |
| `app/+not-found.tsx` | M | Expo client | none | PT copy only |
| `lib/calendars/disconnect-confirm.ts` | A | pure UI copy | none | no network |
| `lib/calendars/disconnect-confirm.test.ts` | A | vitest | none | — |

Importers of disconnect-confirm: calendars.tsx + its test only.  
Edge Function imports of these paths: **none**.

## D. PR #45 diff audit

| Path | Status | Runtime | Deploy target |
| --- | --- | --- | --- |
| `app/(app)/_layout.tsx` | M | Expo client | none |
| `app/(app)/paywall.tsx` | M | Expo client | none |
| `lib/billing/entitlement-gate.ts` | A | pure client routing | none |
| `lib/billing/entitlement-gate.test.ts` | A | vitest | none |
| `lib/billing/entitlement.test.ts` | M | vitest | none |
| `lib/billing/paywall-params.ts` | A | query helpers | none |
| `lib/billing/paywall-params.test.ts` | A | vitest | none |
| `lib/billing/paywall-scenarios.ts` | A | fixtures | none |
| `lib/billing/paywall-scenarios.test.ts` | A | vitest | none |

## E. Import graph

Static grep on develop + PR heads: **no** `supabase/functions/**` imports of `@/lib/billing`, `@/lib/calendars`, or `@/app`.  
Functions do not use `@/` aliases.  
`GRAPH`: PASS for static importers; residual risk documented (dynamic imports not exhaustively proven).

## F. Billing boundary

Audited modules are **client entitlement UX helpers**, not Stripe secret handling, not webhook, not Edge Function.  
`lib/billing/client.ts` / `purchases.ts` remain **outside** allowlist.  
SAFE_SKIP ≠ commercial/live Stripe certification.

## G. Exact paths matrix

Added 13 exact paths (4+#44 + 9+#45). Allowlist size **36**.  
No `lib/billing/**` prefix. Content sniff extended: `sk_live_` / `sk_test_` / `whsec_` / `service_role`.

## H–O. Tests / gates (local)

Deploy Safety suite: **109 PASS**.  
Typecheck PASS. SEC-07 PASS.  
Replays: #42/#43/#44/#45/SELF → SAFE_SKIP, run_*=false.

Bootstrap: self-diff under pre-existing `scripts/deploy-safety/` + `docs/` SAFE_SKIP prefixes (C0.5).

## P–W. Filled after PR/merge

See certification update after CI/merge.
