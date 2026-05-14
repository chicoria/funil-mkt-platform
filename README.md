# funil-mkt-platform

Repositório da **plataforma FunilMKT** (Cloudflare Workers, catálogo multi-tenant, scripts operacionais e testes E2E).

Extraído do monorepo `decolesuacarreiraesg` via `git subtree split` (Slice 2.0 do Plano 2). O histórico de `backend/cloudflare/` preserva-se nesta árvore.

## Requisitos

- Node.js 20+
- Conta Cloudflare + `wrangler` para deploy

## Comandos úteis

```bash
# Testes unitários (todos os workers com Vitest no pacote raiz)
cd "$(dirname "$0")" && npx vitest run

# Só dispatcher (rápido)
cd workers/funnel-dispatcher && npm ci && npm test
```

Na raiz do clone:

```bash
npx vitest run
```

## Estrutura

| Caminho | Conteúdo |
|---------|----------|
| `workers/` | Workers (`funnel-dispatcher`, ingress, `links-redirect`, `dashboard-sync`) |
| `packages/shared/` | Tipos, normalizers, email transacional |
| `config/` | `products.catalog.json`, templates, D1 SQL, diagramas |
| `scripts/` | Deploy, replay, cleanup, greenfield |
| `tests/` | Cenários E2E e `verify.sh` |

## CI

Workflows em `.github/workflows/` (deploy dispatcher, deploy incremental hotmart, E2E staging). Configure os mesmos **secrets** Cloudflare usados no monorepo (nomes podem variar: `CF_API_TOKEN` / `CF_ACCOUNT_ID` vs `CLOUDFLARE_*` conforme workflow).

## Origem

Ver repositório do site/tenant: [decolesuacarreiraesg](https://github.com/chicoria/decolesuacarreiraesg).
