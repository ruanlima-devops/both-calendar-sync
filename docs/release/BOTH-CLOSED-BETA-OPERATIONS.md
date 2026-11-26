# Both — Closed Beta Operations Runbook

**Audience:** Operator / PO / on-call for STAGE closed beta.  
**SYN-05 / Better Stack / Cron observers:** **OFF** — do not activate without separate PO approval.

---

## 1. Ownership

| Role | Responsibility |
|------|----------------|
| Product Owner | Cohort invites, pause/expand, legal/provider approvals |
| Technical operator | STAGE health, deploy, rollback decision, QA accounts |
| Support (PO-designated) | User tickets, bug triage |

---

## 2. What exists today (implemented)

- Supabase Edge Function logs (dashboard) for OAuth, sync-now, billing-webhook.  
- `calendar_connections.last_sync_error` / status (`AUTH_REQUIRED`, etc.) in product UI.  
- Stripe Test webhook delivery dashboard.  
- GitHub Actions: CI + Deploy STAGE (fail-closed Deploy Safety).  
- SEC-07 tombstone on `sync-calendar` (410).  
- Account deletion path (Conta → Excluir / `delete-account`).  
- Incident detection is **manual** until SYN-05 authorized.

---

## 3. What is prepared but NOT active

- SYN-05 watchdog workflows (inert / OFF).  
- Better Stack paused monitors.  
- External collector / PATs — **do not create**.

---

## 4. Incident response (minimum viable)

1. **Classify:** Auth / OAuth / Sync / Billing / FE.  
2. **Contain:** Pause cohort invites; if sync storm, stop QA event generation.  
3. **Diagnose:** Function logs + Stripe Test events + connection `last_sync_error` (no calendar content in tickets).  
4. **Fix:** PR → `develop` → required CI → Deploy STAGE.  
5. **Verify:** Focused E2E on QA accounts only.  
6. **Communicate:** Cohort channel with limitation + ETA.  
7. **Postmortem:** Link PR + run IDs in release docs.

**Emergency pause conditions:** cross-user data suspicion, billing entitlement false-grant, sync duplication storm, secret exposure.

---

## 5. Deploy / rollback

| Action | How |
|--------|-----|
| Forward deploy | Merge to `develop` → Deploy STAGE workflow |
| FE rollback | Re-publish previous Worker asset via official STAGE path (do not guess preview) |
| Functions rollback | Redeploy previous known-good SHA via Deploy STAGE (same gates) |
| Migration rollback | Often **not** reversible — prefer forward fix; no destructive restore on STAGE |

---

## 6. Backup / restore

- Supabase managed backups: treat as available at platform level.  
- **BACKUP_RESTORE_READINESS=PARTIAL** — no destructive restore drill executed in this certification.  
- Do not run restore against live STAGE without PO + explicit plan.

---

## 7. Support diagnostics (privacy-safe)

Collect: user id prefix, timestamp UTC, flow (oauth/sync/billing), UI screenshot without event titles if sensitive, connection status, HTTP status of functions (not tokens).  
Never collect: JWTs, refresh tokens, confirmation links, calendar event bodies in tickets.

---

## 8. Secret rotation (checklist)

Documented procedure exists conceptually via Supabase/Stripe dashboards. Rotation not executed in this RC. Owner: technical operator after PO schedule.

---

## 9. Health smoke (every deploy)

```
GET https://stage.bothcalendar.com/ → expect entry-*.js
POST sync-calendar + anon → 410 SYNC_CALENDAR_DEPRECATED
Login QA → Google ✓ Microsoft ✓
Conta → entitlement label coherent
```

---

## 10. Monitoring authorization gate

If external closed beta proceeds without SYN-05: accept **manual** log review + Stripe dashboard + user reports.  
If PO requires automated alerts: open separate authorization for SYN-05 / Better Stack — **NEEDS_PO_ACTION**.
