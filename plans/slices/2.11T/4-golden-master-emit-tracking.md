# Slice 2.11T.4 — emit-tracking-payload.test.ts (golden master)

> Satélite: 2.11A seção 11.4.4 — captura payload exato antes dos refactors Fase 2

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 ~08:05 por Claude Code |
| Completed | 2026-05-18 ~08:10 por Claude Code |
| Commit final | `9fa1c94` |

## Contexto

Golden master: captura a estrutura exata do payload que `emit_tracking` envia ao sGTM/GA4. Se a Fase 2 mudar inadvertidamente qualquer campo crítico (URL, measurement_id, params.produto, event name mapping), esses testes quebram antes do deploy.

## Entregável

`workers/funnel-dispatcher/test/snapshot/emit-tracking-payload.test.ts` (11 testes):
- Estrutura URL (measurement_id, api_secret)
- client_id e timestamp_micros (formato, não valor exato)
- events array (name = "purchase"/"begin_checkout")
- params críticos (produto, currency, value, transaction_id, source)
- Diferenciação por produto (params.produto por alias)
- Campos de atribuição presentes e ausentes

## Revisão G.12

APROVADO COM RESSALVAS — ressalva documentada: catálogo de fixture em formato v4 (sem wrapper tenants). Aceitável para Fase 0.5; alinhar com v5 em Fase 2 se parser migrar.
