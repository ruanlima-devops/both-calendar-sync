# Both — Minimum Operations for Closed Beta (5–10 users)

**SYN-05:** OFF (do not enable without PO)  
**Audience:** Internal operators during PROD closed beta

## Detect

| Signal | Where | Cadence |
|--------|-------|---------|
| Sync failures | `last_sync_error` UI + Edge logs | Daily |
| Failed jobs | Supabase function logs (sync-now / reconcile) | Daily |
| OAuth reconnect | Auth + OAuth Edge logs | Daily |
| Stripe webhooks | Stripe Dashboard (Test only until Live auth) | On beta if billing used |
| Auth email | SMTP provider bounce/delivery | On signup wave |
| Availability | FE HTTPS + Auth health | Spot check |

## Respond

1. **Owner:** Named by PO (see BOTH-PO-LAUNCH-DECISIONS.md).  
2. **Alerts:** Email/Slack manual until SYN-05 authorized — critical errors must be found via daily log pull, not only user reports → **OPS_READINESS=PARTIAL**.  
3. **Isolate:** Pause sync for affected user (disconnect OAuth / revoke invite).  
4. **Pause beta:** Set `beta_enrollment_required=true` and stop issuing invites; optionally revoke open invites.  
5. **Rollback:** Redeploy prior Worker SHA; Edge Functions previous version; DB migrations are forward-only — feature-flag off for beta gate.  
6. **Communicate:** Support contact from approved legal pack only.

## Backup / restore

- Rely on Supabase project backups once PROD exists (document PITR if Pro).  
- Never restore STAGE dump into PROD.

## Emergency disable

- Disable Worker route / Cloudflare Access deny.  
- Flip beta flag / revoke cohort.  
- Do **not** disable RLS or JWT checks.
