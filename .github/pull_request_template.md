## O que mudou

Descreva resumidamente a alteração.

## Branch alvo (obrigatório)

- [ ] **Base = `develop`** (padrão STAGE / beta)
- [ ] Base = `main` **somente** com label `allow-main` + justificativa explícita abaixo

> STAGE e o release candidate beta vivem em `develop`.  
> Merges acidentais em `main` (ex.: PR #62) são incidentes de governança.

## Tipo de alteração

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor
- [ ] Infraestrutura / governança
- [ ] Docs / release evidence
- [ ] Hotfix

## Validação

- [ ] Testado localmente
- [ ] `npm test` / Vitest relevante
- [ ] TypeScript validado
- [ ] Build/export validado quando aplicável
- [ ] Nenhum segredo incluído
- [ ] Migrations revisadas quando aplicável
- [ ] Deploy Safety / SEC-07 considerados se tocar functions

## Ambientes afetados

- [ ] DEV
- [ ] STAGE
- [ ] PROD (**proibido sem autorização PO explícita**)

## Observações

Informações adicionais, riscos ou passos de teste.
