# Both — PROD Bootstrap Log

**UTC start:** 2026-11-26T03:55:21Z  

## Attempted actions

| Step | Result |
|------|--------|
| Inventory Supabase projects | Only `Both STAGE` (`qszggrrjhcwltnmxpxcy`) |
| `supabase projects create "Both PROD"` (micro, sa-east-1, org `otaqdspnjsewiymnqbmr`) | **Forbidden** — token lacks create permission |
| Create CF Worker prod | **Not executed** — waiting PROD Supabase + DNS PO |
| Public DNS `app.bothcalendar.com` | **Not executed** — no records; needs PO |
| Stripe Live | **Not executed** — unauthorized |
| Copy STAGE data | **Not executed** — forbidden by policy |

## Secrets handling

A one-time DB password was generated for the failed create attempt and stored only in local `/tmp` (mode 600). **Not committed. Not a live PROD password.** Rotate/discard; do not reuse if project create later succeeds with a new password.

## Next bootstrap when PO grants org create

1. Create Free/Pro project `Both PROD` in org, region `sa-east-1`.  
2. Store ref + keys in GitHub Environment `production`.  
3. Link CLI; `db push` / Deploy STAGE-equivalent prod workflow for migrations.  
4. Deploy Edge Functions with PROD secrets.  
5. Configure Auth Site URL + SMTP.  
6. Create Google/Microsoft PROD OAuth clients.  
7. Deploy Worker with approved hostname **or** workers.dev + Cloudflare Access.  
8. Set `beta_enrollment_required=true` only when inviting.  
9. Internal smoke only.
