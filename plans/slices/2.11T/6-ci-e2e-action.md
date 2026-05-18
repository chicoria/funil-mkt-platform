# Slice 2.11T.6 — ci-multitenant-gates.yml

> Satélite: 2.11A seção G.5

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 ~08:17 por Claude Code |
| Completed | 2026-05-18 ~08:20 por Claude Code |
| Commit final | `6e54f70` |

## Entregável

`.github/workflows/ci-multitenant-gates.yml` — 5 gates:

| Gate | Bloqueia | Quando |
|---|---|---|
| `typecheck` | ✅ sempre | todos os workers/packages |
| `unit-tests` | ✅ sempre | packages/shared, dispatcher, dashboard-sync |
| `workers-agnostic-audit` | ⚠️ `continue-on-error: true` até 2.11A.9 | verifica grep por hardcodes de tenant/produto |
| `catalog-validation` | ✅ sempre | schemaVersion=5, tenants definidos |
| `secrets-audit` | ✅ em push (não em PR) | requer CF_API_TOKEN — skipa se ausente |

## Nota importante

`workers-agnostic-audit` está em `continue-on-error: true` porque hoje há 33 violações em `src/` dos workers (Fase 2 ainda não removeu o hardcode). O `TODO(2.11A.9)` indica quando remover o `continue-on-error`.
