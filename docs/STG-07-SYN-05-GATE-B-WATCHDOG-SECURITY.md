# STG-07 / SYN-05 — GATE B Watchdog Security / Least Privilege

**Data:** 2026-11-18  
**Fase:** LOCAL ONLY — nenhum secret remoto criado nesta rodada  
**C0:** hardening local PASS · publish remoto BLOCKED · `STG-07-SYN-05-C0-RELEASE-READINESS.md`  
**Project allowlist:** `qszggrrjhcwltnmxpxcy` (STAGE) apenas

---

## 1. Princípios

- Read-only Logs API para sinais.
- Sem `service_role` de aplicação no cliente de monitoring.
- Sem Stripe API / replay de webhooks.
- Sem SQL remoto.
- Sem PROD endpoints.
- Dry-run default; escrita GitHub opt-in explícito (PO C3+).
- Nunca logar tokens / payloads completos / PII de calendário.

---

## 2. Allowlists

| Controle | Valor |
|----------|-------|
| Project ref | `qszggrrjhcwltnmxpxcy` hard-fail se divergir |
| API host | `api.supabase.com` |
| Protocol | HTTPS only |
| Redirects | `redirect: 'error'` |
| whereExtra | charset restrito (rejeita `;` etc.) |
| Evidence size | `redactText` max length |

---

## 3. Tokens (pendentes de provisionamento PO)

| Segredo | Escopo desejado | Owner | Status |
|---------|-----------------|-------|--------|
| `SUPABASE_ACCESS_TOKEN` (Actions) | Management API `analytics_logs_read` (mínimo disponível) | Ops / PO | **NÃO criado** |
| `GITHUB_TOKEN` | `issues: write` só em workflow de delivery | GitHub Actions | **permission omitida** no YAML local |
| PAT amplo | Evitar | — | **Não usar** se `GITHUB_TOKEN` bastar |

**Risco residual:** tokens Management frequentemente têm escopo amplo. Compensação: allowlist de ref/host; sem deploy steps; network flag OFF; dry-run; review de secrets owners antes de C1.

---

## 4. Workflow threat model

| Ameaça | Mitigação |
|--------|-----------|
| Merge acidental ativa schedule | Schedule comentado + dry-run default + write=0 + enforce step |
| Fork PR com secrets | Sem `pull_request` / `pull_request_target`; sem inputs; sem secrets no YAML |
| `issues: write` cedo demais | Permission omitida; delivery em workflow separado (recomendado) |
| Dispatch bypass network/write | Inputs removidos no C0; env force OFF |
| Command injection | Sem interpolação de user input em shell além de checks fixos |
| Supply chain Actions | Pin major tags (`checkout@v6`, `setup-node@v7`); preferir SHA pin na ativação remota |
| Leak em Issues | Redaction Bearer/JWT/sk_/whsec_/ghp_/email; títulos truncados |
| Concurrent duplicate Issues | `concurrency` group + bot fingerprint; limitação race documentada |

---

## 5. Sanitização

- `scripts/syn05-watchdog/redact.ts` — secrets + e-mails.
- Issue body: marker + fingerprint + contagens + evidência redacted.
- Erros: `safeErrorMessage` sem token.
- Cliente: Authorization header apenas no fetch; nunca em URL query / logs de resultado.

---

## 6. Opt-in matrix

| Flag | Default | Efeito |
|------|---------|--------|
| `BOTH_WATCHDOG_DRY_RUN` | on (`≠0`) | Plano + memória local; sem GitHub remoto |
| `BOTH_WATCHDOG_GITHUB_WRITE` | off | Write real só se `1` **e** dry-run off |
| `BOTH_WATCHDOG_ENABLE_NETWORK` | off | Sem fetch Supabase |

Gate B local: entrypoint **lança** se write habilitado.

---

## 7. QA / PII

Identidades QA protegidas **não** entram em queries nem Issues.  
Sem conteúdo de calendário em evidências.

---

## 8. Veredito segurança local

**LEAST PRIVILEGE DESIGN PASS** (local).  
**REMOTE SECRETS / PERMISSIONS:** não aplicados — **BLOCKED** até auth PO.
