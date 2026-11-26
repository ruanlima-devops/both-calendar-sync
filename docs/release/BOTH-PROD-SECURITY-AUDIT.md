# Both — PROD Security Audit (pre-provision)

**Kind:** Independent technical review — **not** a penetration test.  
**PROD project:** Not created yet.

## Findings

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| SEC-P1 | HIGH | No isolated PROD Supabase yet — cannot claim PROD secret isolation | OPEN |
| SEC-P2 | HIGH | Google Calendar scopes are sensitive; Testing apps limit refresh tokens (~7d) — multiweek beta risk | OPEN / PO |
| SEC-P3 | MEDIUM | Microsoft publisher/consent not verified in accessible Entra tenant | OPEN / PO |
| SEC-P4 | MEDIUM | Privacy/Terms still DRAFT | OPEN / LEGAL |
| SEC-P5 | MEDIUM | Ops rely on manual logs (SYN-05 OFF) | PARTIAL |
| SEC-P6 | LOW | `main` now protected + Main PR Guard (from #65) | DONE |
| SEC-P7 | — | Beta enrollment server gate implemented (default OFF) | DONE code |
| SEC-P8 | — | Deploy PROD Internal workflow refuses STAGE/legacy refs + Live Stripe without flag | DONE code |

## Isolation checklist (when PROD exists)

- [ ] Distinct project ref ≠ STAGE/legacy  
- [ ] Distinct anon/service_role  
- [ ] Distinct OAuth clients/redirects  
- [ ] Distinct webhook secrets  
- [ ] Distinct Stripe keys; Live off  
- [ ] `beta_enrollment_required=true` before external invites  
- [ ] SEC-07 410 on sync-calendar  
- [ ] No STAGE data import  

**PROD_SECURITY_AUDIT=PARTIAL** (architecture + code controls; live PROD N/A).
