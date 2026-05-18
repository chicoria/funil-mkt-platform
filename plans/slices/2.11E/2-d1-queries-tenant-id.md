# Slice 2.11E.2 — lib/d1.ts com tenant_id em todas as queries

> Satélite: 2.11E ([`../../PLANO-MKT-DASHBOARD-MULTI-TENANT.md`](../../PLANO-MKT-DASHBOARD-MULTI-TENANT.md))
> Estimativa: 3–4 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 por Claude Sonnet 4.6 |
| Completed | 2026-05-18 por Claude Sonnet 4.6 |
| Commit final | `dc8aeab` (Red: `a027949`) (repo mkt-dashboard) |

## Contexto

`lib/d1.ts` não filtra por `tenant_id` e usa SQL injection (`AND product_code = '${product}'`). `functions/scheduled.ts` duplica a lógica do worker e seus D1 INSERTs não incluem `tenant_id`, conflitando com o índice único `(tenant_id, date, product_code, event_name)` criado em 2.11D.1. Este slice corrige ambos e extrai a resolução do tenant ativo em `lib/tenant.ts`.

## Mudança

| Arquivo | Ação |
|---|---|
| `lib/d1.ts` | Todas as query functions recebem `tenantId: string`; queries parametrizadas; fix SQL injection |
| `lib/tenant.ts` | CREATE — `getActiveTenantId()` transitória (env `TENANT_ID` → fallback `'decole'`) |
| `lib/env.ts` | Adicionar `TENANT_ID?: string` à interface `Env` |
| `lib/d1.test.ts` | CREATE — testes Red: tenant_id nos binds, sem SQL injection, isolamento |
| `app/dashboard/page.tsx` | Passar `tenantId` às funções D1 |
| `app/dashboard/attribution/page.tsx` | Idem |
| `app/dashboard/user/page.tsx` | Idem |
| `functions/scheduled.ts` | Adicionar `tenant_id` nos INSERTs; marcar como `@deprecated` |

## Decisões de design

- **`ProductCode`** vira `string` (tipo genérico) — a union `"DECOLE_ESG_MENTORIA" | "DECOLE_PLANOVOO"` é DECOLE-specific
- **`getUserJourney`** recebe `tenantId` (isolamento por tenant)
- **`findProfileByEmailHash`** sem `tenant_id` — `IDENTITY_DB` é identidade cross-tenant
- **`functions/scheduled.ts`** mantida funcionando mas com `tenant_id = 'decole'` hardcoded e marcada `@deprecated` — será substituída por chamada ao worker em slice de cleanup
- **SQL injection fix** incluído neste slice (corrige bug de segurança encontrado)

## Validação executável

```bash
cd /Users/chicoria/git/mkt-dashboard

# Red (antes da implementação)
npx vitest run
# Esperado: testes em lib/d1.test.ts falham

# Green (após implementação)
npx vitest run
# Esperado: todos passed

# Typecheck
npx tsc --noEmit
# Esperado: 0 errors

# Audit grep
grep -rn "product_code = '" lib/ app/ functions/
# Esperado: 0 matches (SQL injection eliminado)
```

## Smoke checklist

- [x] Testes Green — **9/9 passed** (Red commit `a027949` → Green commit `dc8aeab`)
- [x] `tsc --noEmit` limpo
- [x] **0 matches** de SQL injection (`product_code = '`)
- [x] Nenhum deploy executado

## Revisão G.12

(a preencher — agente separado após implementação)

---

## Execução (append-only)

### 2026-05-18 por Claude Sonnet 4.6

- Recovery point: commit `46d7e89` (funil-mkt-platform); `5ac0432` (mkt-dashboard).
- Problemas identificados: SQL injection em 4 queries; tenant_id ausente; scheduled.ts conflita com índice único D1.
- Red commit `a027949`: 9 testes falhando — tenant_id ausente, SQL injection, isolamento cross-tenant.
- Implementação: `lib/d1.ts` reescrito (funções com `tenantId`, `productWhere` helper, queries parametrizadas); `lib/tenant.ts` criado; `lib/env.ts` com `TENANT_ID?`; 3 pages atualizadas; `functions/scheduled.ts` com tenant_id nos INSERTs e marcada `@deprecated`.
- Green commit `dc8aeab`: 9/9 passed; 0 SQL injection matches.

## Gotchas / lições aprendidas

- `functions/scheduled.ts` usa o índice `(date, product_code)` sem `tenant_id` — conflitaria com o novo índice `(tenant_id, date, product_code)` criado em 2.11D.1. A correção foi obrigatória para manter a cron funcionando.
- SQL injection era pré-existente — nunca havia `product_code` vindo de input de usuário (era enum fixo no código), mas o padrão correto com `?` foi aplicado.
- TDD Red commit separado (`a027949`) antes do Green (`dc8aeab`) — aplicando feedback da revisão G.12 dos slices anteriores.

## Gotchas / lições aprendidas

(a preencher)

## Decisões tomadas

- SQL injection fix incluído (bug de segurança — não aguardar slice separado)
- `functions/scheduled.ts` kept functional com transitional `'decole'` hardcode em vez de remover (remoção em cleanup slice)
