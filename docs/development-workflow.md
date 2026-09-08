# Fluxo de desenvolvimento

## Branches

```text
main
```

Representa código aprovado para produção.

```text
develop
```

Representa a versão integrada que será implantada em STAGE.

```text
feature/*
```

Branches temporárias para desenvolvimento.

## Fluxo

```text
feature/*
   ↓
Pull Request
   ↓
develop
   ↓
STAGE
   ↓
validação
   ↓
Pull Request
   ↓
main
   ↓
PROD
```

## Regra de desenvolvimento

Novas features não devem ser desenvolvidas diretamente em `main`.

O fluxo normal será:

```bash
git checkout develop
git pull
git checkout -b feature/nome-da-feature
```

Após desenvolvimento:

```text
feature → PR → develop
```

Depois da homologação:

```text
develop → PR → main
```

Hotfixes de produção serão tratados futuramente conforme necessidade.

Este projeto é mantido por um desenvolvedor; o fluxo permanece simples, sem release branches ou GitFlow completo.
