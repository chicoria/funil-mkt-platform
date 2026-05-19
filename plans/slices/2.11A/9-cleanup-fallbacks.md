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
