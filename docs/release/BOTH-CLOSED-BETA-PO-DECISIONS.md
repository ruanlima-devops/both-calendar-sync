# Both — Closed Beta — Product Owner Decision Checklist

**Status:** Awaiting PO.  
**Technical recommendation:** CONDITIONAL_GO (see readiness report).  
**BETA_READY:** remains **NO** until you flip it explicitly.  
**CLOSED_BETA_EXTERNAL_ACCESS_AUTHORIZED:** **NO** by default.  
**PRODUCTION_RELEASE_AUTHORIZED:** **NO**.

---

## Decisions required (check each)

### A. Launch posture

- [ ] **A1.** Approve `BETA_READY=YES` for invitation-only closed beta on STAGE-certified builds.  
- [ ] **A2.** Or keep beta internal (employee/QA only) until privacy/legal/provider items clear.  
- [ ] **A3.** Explicitly forbid production deploy until a separate GO.

### B. Cohort

- [ ] **B1.** Approve cohort size (recommended 5–10).  
- [ ] **B2.** Approve invite channel (manual email list; no public signup).  
- [ ] **B3.** Approve beta duration and pause criteria (see operations doc).  
- [ ] **B4.** Designate support owner + response SLA.

### C. Legal / privacy / providers

- [ ] **C1.** Legal review of Privacy + Terms drafts (`app/(auth)/privacy.tsx`, `terms.tsx`) — currently marked **REVISÃO JURÍDICA NECESSÁRIA**.  
- [ ] **C2.** Fill support/privacy contact placeholders.  
- [ ] **C3.** Confirm Google OAuth consent screen / verification status for broader testers.  
- [ ] **C4.** Confirm Microsoft app registration audience / admin consent needs.  
- [ ] **C5.** Confirm LGPD DPA / subprocessors list for beta disclosure.

### D. Commercial

- [ ] **D1.** Keep Stripe **Test** for beta (recommended) **or** authorize Live (separate, high risk — not recommended for first cohort).  
- [ ] **D2.** Confirm trial 14d and pricing copy remain unchanged (no silent change).

### E. Observability

- [ ] **E1.** Accept manual ops for first cohort **or**  
- [ ] **E2.** Authorize SYN-05 / Better Stack activation (separate ticket; not done here).

### F. Governance already applied (ack)

- [ ] **F1.** Acknowledge PR #62 landed on `main` by mistake; **no PROD deploy** found.  
- [ ] **F2.** Acknowledge `main` now has branch protection + `Main PR Guard` + `allow-main` label requirement (after merge of governance PR).  
- [ ] **F3.** Confirm STAGE remains `develop`-driven.

### G. Optional sync of main

- [ ] **G1.** Approve a labeled `allow-main` PR to sync `main` tip with `develop` docs (#64) — cosmetic history hygiene only.

---

## Suggested first cohort parameters (proposal only)

| Parameter | Proposal |
|-----------|----------|
| Size | 5–10 |
| Access | Invite-only STAGE or staging-branded build |
| Billing | Stripe Test or trial-only |
| Duration | 2–4 weeks |
| Success | ≥80% connect both providers; ≥1 successful bidirectional sync; zero P0 security incidents |
| Pause if | Cross-user leak, billing false-grant, sync duplication storm |

---

## Signature

| Field | Value |
|-------|--------|
| PO name | |
| Date | |
| Decision | GO / CONDITIONAL / NO-GO |
| Notes | |
