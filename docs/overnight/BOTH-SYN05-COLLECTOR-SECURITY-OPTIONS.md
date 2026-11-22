# BOTH SYN-05 Collector Security Options — 2026-11-23

## Certified / known state (unchanged)
- GitHub App `both-stage-syn05-observer-ro` PASS (Actions+Metadata read)
- Cloudflare observer OFF (`crons=[]`, workers_dev=false)
- Better Stack heartbeat PAUSED
- Supabase Logs PAT **not issued**
- `COLLECTOR_SECRET_STORAGE=BLOCKED`
- Watchdog remote NO, Observer remote NO, C3-D OFF, Delivery OFF
- SYN-05 = **NO-GO**

## Options (no provision this sprint)

| Option | Isolation | Cost | Recommendation |
|--------|-----------|------|----------------|
| A Status quo BLOCKED | Max | 0 | **Keep** |
| B Dedicated `SUPABASE_LOGS_READ_TOKEN` contract | High when provisioned | 0 | Align code names offline |
| C Reuse deploy `SUPABASE_ACCESS_TOKEN` | Weak | 0 | **Reject** |
| D Workflow YAML isolation (collector-only secret refs) | Med-High | 0 | Prepare; don't create |
| E Manual operator inject oneshot | Strong | 0 | Supervised only |
| F External vault | High | maybe | Defer |
| G OIDC machine identity | Ideal | 0 | Not available yet |

## Overnight local artifact
- `scripts/syn05-collector/secret-isolation.ts` + tests
- `scripts/syn05-watchdog/collector-secret-policy.ts` + tests
- `scripts/syn05-watchdog/collector-token-env.ts` — prefers `SUPABASE_LOGS_READ_TOKEN`; legacy `SUPABASE_ACCESS_TOKEN` flagged as residual risk
- `run.ts` wired to dedicated name (Option B offline alignment; storage still BLOCKED)
- Fail-closed asserts for remote flags
- Prefer: no PAT + GitHub App metadata only until vault/OIDC proof

## Do not
- Create GitHub Environment
- Emit PAT
- Unpause Better Stack
- Enable cron/delivery/observer
- Place Supabase tokens on Cloudflare Observer (adapter already refuses)
