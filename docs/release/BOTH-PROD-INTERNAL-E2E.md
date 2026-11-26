# Both — Internal PROD E2E

**Status:** NOT EXECUTED  

## Blockers

1. No PROD Supabase project.  
2. No PROD Worker / hostname.  
3. PROD OAuth clients not registered.  
4. PROD SMTP not configured.  

## Planned smoke (internal only, after provision)

1. FE loads; build SHA present.  
2. Auth signup blocked without invite when `beta_enrollment_required=true`.  
3. Authorized invite → signup → email confirm.  
4. Google connect (if PROD client ready) else INTERNAL_OAUTH_SMOKE=BLOCKED.  
5. Microsoft same.  
6. SEC-07 sync-calendar → 410.  
7. Stripe Live absent; Test not shown as commercial live.  
8. No STAGE ref in FE/Worker config.  

**PROD_INTERNAL_SMOKE=BLOCKED**
