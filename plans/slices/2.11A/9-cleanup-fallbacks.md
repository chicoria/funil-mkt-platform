# Slice 2.11A.9 — Remover dead code + secrets antigos + audit grep

> Satélite: 2.11A
> Estimativa: 2 horas

## Status

| Campo | Valor |
|---|---|
| Estado | IN_PROGRESS |
| Started | 2026-05-19 por Claude Sonnet 4.6 |
| Completed | — |
| Commit final | — |

## Contexto

Dead code marcado como `@deprecated` em 2.11A.2/A.5 precisa ser removido:
- `forwardN8n()`, `buildN8nForwardPayload()`, `isPlanovooProductCode()` em `handlers/index.ts`
- `N8N_WEBHOOK_URL`, `N8N_DISABLE_FORWARD`, `PLANOVOO_API_BASE_URL`, `PLANOVOO_HOOK_SECRET` em `dispatcher.ts`

Estes são os únicos matches que impedem grep audit de passar com 0 matches no funnel-dispatcher.

## Execução (append-only)

### 2026-05-19 por Claude Sonnet 4.6

- Recovery point: `2151012`
- Dead code identificado nas linhas 278–280 (isPlanovooProductCode), 1773–1810 (forwardN8n/buildN8nForwardPayload), 2008–2011 (forward_n8n handler)
- Campos deprecated em dispatcher.ts:34-46

### 2026-05-19 por Codex (GPT-5)

- Fase A (runtime): removidos fallbacks legados no `funnel-dispatcher` para KV unscoped (`checkout_recovery:*` sem tenant) e fallback de secrets legacy em `resolveTrackingConfig`/`resolveContextCredentials`.
- Fase A (runtime): `resolveEventTenantId` passou a priorizar `event.tenant_id`; fallback secundário infere tenant pelo prefixo do `product_code` canônico (`DECOLE_*` → `decole`) para manter compatibilidade com catálogos antigos sem `tenants`.
- Fase A (tests): ajustes em `test/unit/index.test.ts` para refletir remoção de deleção de chaves legacy unscoped e exigência de `BREVO_API_KEY_DECOLE` quando o catálogo é multi-tenant.
- Fase A (validation): `npm run typecheck` + `npx vitest run` no `workers/funnel-dispatcher` verdes (`182 passed, 3 skipped`).
- Fase B (catalog): removidos `global.n8n`, `handlers.forward_n8n`, `product.tracking.productCode` redundantes e secrets legados em `workerViews.funnel-dispatcher`; consolidado bloco único `links` por produto (fim dos warnings de duplicate key).
- Fase B (validation): `catalog-v5.test.ts` (shared) e `catalog-adapter.test.ts` (dispatcher) verdes; `wrangler deploy --dry-run` em `links-redirect` sem warning de duplicate key.
