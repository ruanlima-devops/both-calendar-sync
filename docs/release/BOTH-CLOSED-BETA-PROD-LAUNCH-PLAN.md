# Both — Closed Beta on PROD Launch Plan

**Policy:** STAGE = internal QA only. External / closed-beta users = PROD only.  
**Execute launch:** NO until PO explicit approval.

## Recommended cohort

- Size: 5–10 invited users  
- Duration: 2–4 weeks  
- Access: invitation-only (`beta_enrollment_required=true` + `beta_invites`)  

## Conflict with 14-day commercial trial

Do **not** change trial unilaterally. PO choose one:

| Option | Notes |
|--------|-------|
| A | Beta cohort limited to 14 days (aligns with trial) |
| B | Server-side beta entitlement override (no Stripe Live) |
| C | Other non-billing arrangement (PO written approval) |

Default recommendation until PO decides: **B** with Stripe Live off and free beta entitlement server-side.

## Pre-launch checklist (do not execute invites yet)

1. Legal Privacy/Terms approved and published  
2. Google OAuth external + publishing/verification path OK for multiweek tokens  
3. Microsoft audience + publisher/consent documented  
4. Beta entitlement/billing policy approved  
5. Ops ownership + daily log review cadence  
6. Hostname + access policy approved  
7. PROD internal smoke PASS  
8. Security audit no HIGH/CRITICAL open  
9. Cohort list approved  
10. Explicit PO: EXTERNAL_ACCESS=YES  

## Daily ops (during beta)

- Review sync errors / last_sync_error  
- Review Auth/email failures  
- Pause beta if systemic OAuth or sync outage  
- Revoke invite / disable cohort via `beta_enrollment_required` or invite revoke RPC  

## Explicitly deferred

- Public signup  
- External invite send  
- Stripe Live  
- SYN-05 paid alerting  
