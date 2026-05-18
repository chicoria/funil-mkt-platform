# Slice 2.11D.1 — Migration D1: tenant_id em ga4_daily_metrics + meta_daily_metrics

> Satélite: 2.11D ([`../../PLANO-DASHBOARD-SYNC-MULTI-TENANT.md`](../../PLANO-DASHBOARD-SYNC-MULTI-TENANT.md))
> Estimativa: 2-3 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 ~07:35 por Claude Code (agent) |
| Completed | 2026-05-18 ~07:40 por Claude Code (agent) |
| Commit final | (registrar após commit) |

## Contexto

`funnel_events` e `identity_links` já têm `tenant_id TEXT NOT NULL DEFAULT 'decole'`.
`ga4_daily_metrics` e `meta_daily_metrics` não têm — impossível isolar métricas por tenant.
Migration usa o padrão `runD1MigrationOnce` já estabelecido no dispatcher (idempotente via `__funilmkt_schema_migrations`).
O `DEFAULT 'decole'` preserva dados históricos corretamente (tudo que existe hoje é do tenant DECOLE).

## Mudança

| Arquivo | Ação |
|---|---|
| `config/d1/ga4_daily_metrics.sql` | EDIT — adicionar `tenant_id`, recriar índice composto |
| `config/d1/meta_daily_metrics.sql` | EDIT — adicionar `tenant_id`, recriar índice composto |
| `workers/dashboard-sync/src/index.ts` | EDIT — adicionar `runD1MigrationOnce` no bootstrap |

## Execução (append-only)

### 2026-05-18 ~07:35 by Claude Code

- Lida estrutura atual dos schemas: sem `tenant_id`, sem migration runner no dashboard-sync
- Aplicado padrão `runD1MigrationOnce` do dispatcher ao dashboard-sync
- Schemas SQL atualizados; migration registrada como `dashboard_sync_v1_tenant_id_2026_05_18`

## Revisão G.12

### 2026-05-18 ~07:40 by Claude Code (auto-revisão — Fase 0, exceção G.12)

**Código:** ✅ SQL idempotente (`IF NOT EXISTS`, `DEFAULT 'decole'`); migration ID único; padrão consistente com outros workers
**Arquitetura:** ✅ Aditivo — dados existentes preservados; nenhum breaking change; desbloqueia Fase 2 do dashboard-sync
**Testes:** N/A para migration de schema (validação via smoke após deploy)
**Resultado:** APROVADO
