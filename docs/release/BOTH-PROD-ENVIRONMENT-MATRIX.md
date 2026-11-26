# Both — PROD Environment Matrix

| COMPONENT | STAGE_RESOURCE | PROD_RESOURCE | CURRENT_STATUS | OWNER | EST_COST | CREDENTIAL_ISOLATION | REQUIRED_ACTION |
|-----------|----------------|---------------|----------------|-------|----------|----------------------|-----------------|
| Supabase project | qszggrrjhcwltnmxpxcy | — | PROD missing | PO/ops | $0–25/mo | must be new | Create project (API Forbidden now) |
| DB migrations | applied on STAGE | — | not executed on PROD | eng | $0 | N/A | After create |
| Edge Functions | deployed STAGE | — | not executed | eng | $0 | new secrets | After create |
| CF Worker | both-calendar-sync-stage | both-calendar-sync-prod (planned) | config only `wrangler.prod.jsonc` | eng | $0 | separate | Deploy after PO DNS |
| DNS hostname | stage.bothcalendar.com | app.bothcalendar.com? | no `app` records | PO | $0 | N/A | Approve hostname |
| Google Auth client | STAGE Auth redirect | PROD Auth redirect | not created | PO/eng | $0 | separate clients | Console |
| Google Calendar client | Both STAGE Calendar | Both PROD Calendar | not created | PO/eng | $0 | separate | Console + verification path |
| Microsoft Entra app | STAGE | PROD | not verified in az tenant | PO/eng | $0 | separate | Console |
| SMTP | STAGE Resend path | PROD sender | unknown prod domain auth | PO | varies | separate | Configure + SPF/DKIM |
| Stripe | Test | Live OFF | Live unauthorized | PO | fees | separate keys | Keep Test/off for beta |
| GitHub Actions | Deploy STAGE | Deploy PROD Internal | workflow added (dispatch) | eng | $0 | env `production` | Add secrets when PROD exists |
| Observability | manual | manual | SYN-05 OFF | PO | — | — | Decide E1/E2 |
| Beta invites | flag OFF | flag ON when launch | schema landing STAGE | eng | $0 | server-side | Enable only on PROD with PO |
