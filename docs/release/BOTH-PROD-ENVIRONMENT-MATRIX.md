# Both — PROD Environment Matrix

| COMPONENT | STAGE_RESOURCE | PROD_RESOURCE | CURRENT_STATUS | OWNER | EST_COST | CREDENTIAL_ISOLATION | REQUIRED_ACTION |
|-----------|----------------|---------------|----------------|-------|----------|----------------------|-----------------|
| Supabase project | qszggrrjhcwltnmxpxcy | **djxulqyuafhihmuyzvvk** | Both PROD exists (Free/nano) | PO/ops | $0 Free | isolated | Apply migrations; secrets |
| DB migrations | applied STAGE | empty PROD | not executed | eng | $0 | N/A | PROD_INTERNAL when approved |
| Edge Functions | deployed STAGE | none | not executed | eng | $0 | new secrets | After OAuth clients |
| CF Worker | both-calendar-sync-stage | both-calendar-sync-prod (planned) | config only | eng | $0 | separate | After DNS/PO |
| DNS app/auth | — | app./auth. | **no records** | PO | $0 | N/A | Approve hostname |
| Custom Domain | n/a | auth.bothcalendar.com | **blocked on Free**; +$10/mo on Pro | PO | Pro+$10 | official only | COST approval |
| Google Cloud | both-stage | **both-production** | project created | eng/PO | $0 | separate | Consent + 2 clients |
| Google Sign-In / Calendar clients | STAGE Auth + Calendar | pending | not created | eng | $0 | separate | Console |
| Microsoft Entra | STAGE | pending | az on wrong tenant (EAF) | PO | $0 | separate | Both tenant admin |
| SMTP | STAGE | TBD | — | PO | varies | separate | Domain auth |
| Stripe | Test | Live OFF | unauthorized | PO | fees | separate | Keep off |
| Auth signup | STAGE QA | **disabled** (session) | Google/Azure off | eng | $0 | — | Keep until invites |
| GitHub Actions | Deploy STAGE | Deploy PROD Internal | guards + verified ref | eng | $0 | env production | Add secrets |
