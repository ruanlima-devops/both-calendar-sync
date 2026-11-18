# STG-07 / SYN-05 — GATE B Watchdog Certification Gates

**Data:** 2026-11-18  
**Esta rodada:** apenas certificação **LOCAL** (sem C0 remoto)

---

## Status atual

| Gate | Descrição | Status |
|------|-----------|--------|
| **LOCAL** | Código + YAML local + testes fakes + docs | **PASS** |
| **C0 LOCAL** | Auditoria segurança + YAML + testes + plano publish | **PASS** · `STG-07-SYN-05-C0-RELEASE-READINESS.md` |
| C0 remote / publish | Workflow no remoto (ainda dry-run) | **BLOCKED** — exige auth PO + commit/push/merge isolado; **não autorizado** |
| C1 | Read-only Supabase Logs API real | **BLOCKED** — auth PO + secret + network flag |
| C2 | Thresholds/parser certificados em STAGE | **BLOCKED** |
| C3 | GitHub Issues write autorizado | **BLOCKED** — permission + opt-in |
| C4 | Issue criada por incidente sintético seguro | **BLOCKED** |
| C5 | Deduplicação entre runs reais | **BLOCKED** |
| C6 | Recovery fecha Issue corretamente | **BLOCKED** |
| C7 | Self-monitoring operacional (workflow separado + schedule) | **BLOCKED** |
| C8 | Monitor indisponível detectado | **BLOCKED** |
| C9 | Runbooks executáveis em incidente real | **BLOCKED** |
| C10 | Evidence/PII sanitized em Issues reais | **BLOCKED** |

---

## Critérios LOCAL PASS (checklist)

1. Workflow criado localmente, schedule comentado — **PASS**
2. Cliente Supabase RO testado com fakes — **PASS**
3. Evaluator integrado — **PASS**
4. Issues adapter mock — **PASS**
5. Dedupe persistente projetada/testada (memória + fingerprint) — **PASS**
6. Recovery seguro (2× HEALTHY; no close UNKNOWN/unavailable) — **PASS**
7. 429/backoff/timeout — **PASS**
8. Self-monitoring projetado + testes locais — **PASS** (remoto BLOCKED)
9. Least privilege documentado — **PASS**
10. Testes PASS — `npm test` → **595 PASS** (2026-11-18)
11. Nenhuma escrita remota — **PASS**
12. Nenhuma notificação real — **PASS**

---

## Separação de vereditos

| Veredito | Estado |
|----------|--------|
| WATCHDOG LOCAL | **PASS** |
| WATCHDOG REMOTE | **BLOCKED** |
| ALERT DELIVERY | **BLOCKED** |
| SELF-MONITORING REMOTE | **BLOCKED** |
| STG-07 | **NO-GO** |
| PROD | **NO-GO** |

---

## Próxima autorização PO (NEXT)

1. **Não** tratar C0 como feito sem auth explícita de publish.
2. Ordem sugerida: C0 (publish dry-run, schedule ainda off) → secret Management RO → C1 → calibração C2 → workflow delivery com `issues: write` (C3) → sintético seguro C4–C6 → self-monitor schedule C7–C8 → runbooks C9–C10.
3. Owners de secrets e canal de page humano ainda pendentes.
4. Custos Actions/API a confirmar antes de schedule contínuo.
