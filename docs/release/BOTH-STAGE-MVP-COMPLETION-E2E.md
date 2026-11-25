# Both — STAGE MVP Completion + Full Stage Release E2E

**Date:** 2026-11-25  
**Mode:** STAGE only · PROD forbidden · no bypass · no invented PASS  
**Final develop HEAD (docs commit may trail):** see §04

---

## 01. Executive summary

Progress this execution was **executable and verified**, not diagnosis-only:

1. **Frontend STAGE republished** from develop via official Wrangler (`both-calendar-sync-stage` → `stage.bothcalendar.com`), including Auth/Onboarding/Calendar/Paywall and post-#50 OAuth client bundle.
2. **Deploy Safety OAuth recovery (#51)** merged → enables honest SAFE_SKIP for audited client paths.
3. **OAuth #50** integrated after CI fix (exclude real-PG suite from default Vitest) → classify **DEPLOY_CANDIDATE_BOTH**.
4. First Deploy STAGE after #50 **failed** on migration history drift (remote had `20261115`/`20261117` missing from develop).
5. **#52** restored already-applied migration SQL + redeployed OAuth edge entrypoints → Deploy STAGE **SUCCESS** with release gate.
6. **Billing #46** reconciled as **#53**, merged, and Deploy STAGE **SUCCESS** (`DEPLOY_CANDIDATE_FUNCTIONS`) → `billing-webhook` **v16**.
7. **Live Google/Microsoft OAuth, Stripe Test checkout, and bidirectional sync** were **not** certified with live QA providers in this window → launch blockers remain honest.

**STAGE_MVP_CERTIFIED = PARTIAL** (not PASS).  
**BETA_READY = NO**.  
**PRODUCTION_RELEASE_AUTHORIZED = NO**.  
**PRODUCTION_DEPLOY_EXECUTED = NO**.

---

## 02. PO authorization

Covered: local development, PRs, STAGE web + Supabase deploy under official Deploy Safety + `DEPLOY_SAFETY_ALLOW_CANDIDATE` window, Stripe Test only, synthetic users.  
Not covered: PROD, live charges, personal accounts, SYN-05 activation, destructive DB ops.

Release gate was set `1` only for authorized STAGE candidate windows (#52 deploy) and returned to `0` afterward.

---

## 03. Initial baseline

| Item | Value |
|------|-------|
| Last known develop | `383adb8…` then `1d05399` (#51) |
| STAGE project | `qszggrrjhcwltnmxpxcy` |
| Legacy forbidden | `sknpqjodttkpttaytdut` |
| OAuth PR | #50 DRAFT @ `dd85713…` historically |
| Billing PR | #46 DRAFT DEPLOY_CANDIDATE |
| Frontend CF versions | last listed deploy historically 2026-10-02 until this run |
| Docker | degraded / disk pressure — GoTrue native preferred for local OAuth |

---

## 04. Final develop HEAD

Final develop HEAD after billing deploy:

- `95e56da6b98188f08dc3362915509ab8249cf748` — Merge #53 billing reconcile  
- `f2e92230b6e23525c092552d6c2959b073277d03` — Merge #52 history sync + OAuth redeploy  
- `b4f76af…` — Merge #50 OAuth  
- `1d05399…` — Merge #51 Deploy Safety + wrangler

---

## 05. PRs merged (this execution)

| PR | Title | SHA | Notes |
|----|-------|-----|-------|
| #51 | Deploy Safety OAuth exact SAFE_SKIP + wrangler | `1d05399…` | SAFE_SKIP Deploy STAGE |
| #50 | OAuth lifecycle reconciled | `b4f76af…` | CI fixed; first Deploy failed on history drift |
| #52 | STAGE migration history sync + OAuth redeploy | `f2e9223…` | Deploy STAGE SUCCESS |
| #53 | Billing #46 reconcile onto develop | `95e56da…` | Deploy STAGE SUCCESS (functions) |

---

## 06. PRs pending

| PR | State | Notes |
|----|-------|-------|
| #46 | Original billing draft | **Preserved** — do not auto-close |
| #15 | Original OAuth lifecycle | **Preserved** — do not modify/close |
| Issues #26/#30 | Preserved | No change |

---

## 07. Features implemented / advanced

- Deploy Safety exact-path recovery for OAuth client artifacts (#51).
- OAuth lifecycle on develop + STAGE functions google-oauth v25 / microsoft-oauth v24 / disconnect-calendar v20.
- Migration history parity for billing hardening + SEC-10 already on STAGE.
- Frontend STAGE bundle with Auth web + OAuth client code (`entry-878a48c5…`, Worker `64b2e988…`).
- Signup browser path → confirm-email.
- Billing reconcile branch with 830 Vitest PASS.

---

## 08. Features still missing / not certified live

- Live Google Calendar connect/finalize on STAGE (QA consent).
- Live Microsoft Calendar connect/finalize.
- Bidirectional sync E2E with QA calendars.
- Stripe Test checkout / webhook / grace / cancel revalidation this window.
- Full onboarding completion with both providers.
- SYN-05 remote observability (intentionally OFF).

---

## 09. Frontend STAGE releases

| Field | Value |
|-------|-------|
| URL | https://stage.bothcalendar.com |
| Mechanism | `npx wrangler@4 deploy` + `wrangler.jsonc` (STAGE custom domain only) |
| Build | `npx expo export -p web` · `APP_VARIANT=preview` → title **Both STG** |
| Supabase URL in bundle | `https://qszggrrjhcwltnmxpxcy.supabase.co` |
| Asset | `_expo/static/js/web/entry-878a48c53b664f983e4b9f7ae8268256.js` |
| Worker Version ID | `64b2e988-e73b-4c23-a57a-7be8f47d6846` |
| Develop SHA baked | `f2e9223…` |
| HTTP | `/` `/login` `/sign-up` `/forgot-password` `/onboarding` `/calendars` `/paywall` → 200 |

Bug fixed mid-run: first publish used `APP_VARIANT=development` → title “Both DEV”; corrected to `preview`.

---

## 10. OAuth STAGE release

| Field | Value |
|-------|-------|
| Integrated | **YES** (#50) |
| Deploy Safety | **PASS** as DEPLOY_CANDIDATE_BOTH after #51 + drop package.json churn |
| Migration `20261001000001` | Already present Local=Remote on STAGE at #52 deploy |
| Functions | Deployed 2026-11-25T22:46:41Z on `qszggrrjhcwltnmxpxcy` |
| google-oauth | v25 |
| microsoft-oauth | v24 |
| disconnect-calendar | v20 |
| SEC-07 | tombstone assert PASS pre-deploy; sync-calendar bumped to **v23** (tombstone source) |
| Gate | `DEPLOY_SAFETY_ALLOW_CANDIDATE=1` then **0** |

---

## 11. Billing STAGE release

| Field | Value |
|-------|-------|
| #46 original | Still open draft (preserved) |
| Reconcile | PR **#53** merged |
| Migration `20261115000001` | Already on STAGE (history sync #52) |
| Function deploy | Deploy run `45717064772` SUCCESS — `billing-webhook` **v16** |
| Stripe | Test Mode only; live checkout **NOT_EXECUTED** this window |

---

## 12. Database migrations

| ID | Status on STAGE |
|----|-----------------|
| `20261001000001_oauth_completion_ticket` | Present (Local=Remote) |
| `20261115000001_billing_webhook_hardening` | Present (synced into develop #52) |
| `20261117000001_sec10_rls_profile_hardening` | Present (synced into develop #52) |

No destructive migrations. No PROD mutations.

---

## 13. Edge Functions deployed

Full deploy list from run `45715852516` includes 24 functions on STAGE. Notable versions after deploy:

- google-oauth **25**
- microsoft-oauth **24**
- disconnect-calendar **20**
- sync-calendar **23** (SEC-07 tombstone source)
- billing-webhook **16** (post-#53 hardenings)

Unauthenticated probes:

- google-oauth / microsoft-oauth → `401` `UNAUTHENTICATED`
- disconnect-calendar / sync-calendar → `401` missing auth header (verify_jwt gateway)
- billing-webhook → `INVALID_SIGNATURE`

---

## 14–16. Stripe / Google / Microsoft / Sync E2E

| Suite | Result |
|-------|--------|
| Stripe Test checkout/webhook/entitlement | **NOT_EXECUTED** (await #53 + Test credentials runbook) |
| Google live | **BLOCKED** — QA consent / dedicated accounts required |
| Microsoft live | **BLOCKED** — same |
| Sync G↔M live | **NOT_EXECUTED** / **BLOCKED** on live providers |

Local OAuth (prior certification, not re-run as STAGE substitute): GoTrue + PG mocks — do **not** count as STAGE live PASS.

---

## 17–18. Security / regression

| Check | Result |
|-------|--------|
| Vitest on #50 tip | 738 PASS (CI) after exclude fix |
| Vitest billing reconcile | 830 PASS local |
| SEC-07 | PASS assert on deploy |
| CSRF / ticket single-use | Covered in unit/local OAuth suites — STAGE live negatives **NOT_EXECUTED** |
| Required CI on merges | Application + Supabase PASS for #50/#51/#52 |

---

## 19–20. Playwright / CI

| Item | Result |
|------|--------|
| Playwright STAGE | **NOT_EXECUTED** this window (browser MCP smoke only) |
| CI #50 | https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45714854206 SUCCESS |
| Deploy STAGE #52 | https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45715852516 SUCCESS |
| Deploy STAGE #50 attempt | https://github.com/ruanlima-devops/both-calendar-sync/actions/runs/45715193954 FAILURE (history drift) |

---

## 21–22. Deploy Safety / SEC-07

- UNKNOWN_BLOCKED on #50 resolved via #51 exact SAFE_SKIP + removing package.json churn — **not** by masking migrations/functions.
- Candidates require `DEPLOY_SAFETY_ALLOW_CANDIDATE=1`; default OFF restored.
- SEC-07 tombstone preserved through function mass-deploy.

---

## 23. Observability

SYN-05 Observer/Cron/Better Stack remain **OFF/PAUSED** per prior gates. Not activated. Minimum STAGE error signals: function 401/signature failures observable via HTTP probes only.

---

## 24–26. Risks / blockers / costs

**Risks**

- Disk near-full on operator machine (blocked local npm briefly).
- Workers Builds historically flaky; this run succeeded on #50/#53 paths observed.
- sync-calendar version incremented with mass deploy — behavior must remain 410 tombstone under JWT.

**Blockers to launch / beta**

1. Live OAuth Google + Microsoft with dedicated QA accounts.  
2. Stripe Test full lifecycle revalidation after billing function hardenings.  
3. Bidirectional sync E2E on isolated QA calendars.  
4. Email confirmation deliverability for signup.  
5. Remote observability if required for beta ops policy.

**Costs:** Cloudflare Workers STAGE deploy only (existing). No paid plan enablement. Stripe Live unused.

---

## 27. Remaining MVP backlog

**P0:** live OAuth both providers; calendar select+sync loop; Stripe Test entitlement↔paywall; confirm email path.  
**P1:** payment_failed/grace live fixtures; cancel/portal; a11y; disposable delete re-run.  
**P2:** SYN-05 activation (gated); polish/legal.

---

## 28. Launch readiness

| Gate | Value |
|------|-------|
| STAGE_MVP_CERTIFIED | **PARTIAL** |
| BETA_READY | **NO** |
| PRODUCTION_RELEASE_AUTHORIZED | **NO** |
| PRODUCTION_DEPLOY_EXECUTED | **NO** |

---

## 29. Exact next actions

1. Run Stripe Test checkout/webhook/grace against STAGE with `billing-webhook` v16.  
2. Provision/use dedicated QA Google+Microsoft accounts per `docs/BOTH_QA_ACCOUNTS_SETUP.md`.  
3. Run STG-03 style OAuth live + deliberate G↔M sync on QA calendars.  
4. Confirm signup email + trial row for synthetic user.  
5. Keep #15/#46/#26/#30 intact unless PO directs otherwise.

---

## 30. Independent final certification

Revalidated against live URLs, GH runs, function probes, and git SHAs above.  
**No false PASS for live providers or Stripe.**  
**Frontend + OAuth code/functions on STAGE: evidenced.**  
**Product-complete STAGE MVP: NOT certified.**
