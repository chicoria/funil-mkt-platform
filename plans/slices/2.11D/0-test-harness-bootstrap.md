# Slice 2.11D.0 — dashboard-sync test harness mínimo

> Satélite: 2.11D — primeiro test suite do worker (antes: zero testes)

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 ~08:07 por Claude Code |
| Completed | 2026-05-18 ~08:10 por Claude Code |
| Commit final | (incluído no commit de Fase 0.5) |

## Contexto

Worker dashboard-sync tinha zero testes. Antes de refatorar em 2.11D.2 (multi-tenant), precisava de harness para detectar regressões.

## Entregável

`workers/dashboard-sync/test/unit/sync-runner.test.ts` (8 testes passando, 1 skipped):
- Auth 401/200, health check, métodos HTTP (405)
- Schema migration bootstrapped (verifica `__funilmkt_schema_migrations`)
- `it.skip` para validação de `?tenant=unknown` (TDD Red para 2.11D.2)

`workers/dashboard-sync/vitest.config.ts` + vitest como devDependency.

## Revisão G.12

APROVADO COM RESSALVAS (agente separado): teste de auth aceitar status 500 como válido foi corrigido para `!= 401`; teste de ?tenant= desconhecido convertido para `it.skip`.
