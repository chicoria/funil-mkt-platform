# Slice 2.11T.1 — catalog-adapter.test.ts (campos v5)

> Satélite: 2.11A seção 11.4.1

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 ~08:12 por Claude Code |
| Completed | 2026-05-18 ~08:15 por Claude Code |
| Commit final | `6e54f70` |

## Entregável

Expandido `workers/funnel-dispatcher/test/unit/catalog-adapter.test.ts` (16→24 testes):

8 testes novos verificando que o catálogo bundled foi corretamente bumped para v5:
- `schemaVersion` = 5
- `allowedOrigins` presente em tenant
- `tracking` por tenant (sgtm, ga4, metaCapi)
- `integrations.planovoo.appWebhooks`
- `hotmart.urlSlugs` em ESG e PLANOVOO
- `n8nForward.enrichPayload` em PLANOVOO
- Campos v4 ainda presentes (backward compat)

## Revisão G.12

Auto-revisão (Fase 0.5 — testes de regressão, sem lógica nova). Aprovado.
