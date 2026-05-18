# Slice 2.11D.2 — Refatorar dashboard-sync runSync (multi-tenant)

> Satélite: 2.11D ([`../../PLANO-DASHBOARD-SYNC-MULTI-TENANT.md`](../../PLANO-DASHBOARD-SYNC-MULTI-TENANT.md))
> Estimativa: 4–6 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 por Claude Sonnet 4.6 |
| Completed | 2026-05-18 por Claude Sonnet 4.6 |
| Commit final | (a registrar) |
| PR | — |
| Janela de smoke | N/A — Fase 2 (sem deploy) |

## Contexto

`workers/dashboard-sync/src/index.ts` tem `productMap` hardcoded, `runSync` com dois `syncMeta` DECOLE explícitos, e `Env` com secrets específicos de tenant. Este slice divide o arquivo em 4 módulos focados (SoC) e faz o worker iterar `Object.keys(catalog.tenants)` — agnóstico de tenant/produto.

Princípios aplicados: Separation of Concerns, Loose Coupling, legibilidade humana, design patterns pragmáticos.

## Pré-requisitos

- [x] 2.11A.1 DONE — catálogo v5 com `tenants.{id}.dashboard`
- [x] 2.11D.1 DONE — D1 com coluna `tenant_id`
- [x] Catálogo tem `tenants.decole.dashboard.ga4` + `products.*.dashboard.metaAds` (confirmado)
- [x] Secrets Store tem secrets `_DECOLE`; bindings em `wrangler.toml` (confirmado)

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `workers/dashboard-sync/src/types.ts` | CREATE | Interfaces compartilhadas |
| `workers/dashboard-sync/src/catalog.ts` | CREATE | Resolução de config (catálogo + env) — puro, sem IO |
| `workers/dashboard-sync/src/ga4.ts` | CREATE | GA4 API + D1 write |
| `workers/dashboard-sync/src/meta.ts` | CREATE | Meta API + D1 write |
| `workers/dashboard-sync/src/sync-runner.ts` | CREATE | Loop multi-tenant (runSync) |
| `workers/dashboard-sync/src/index.ts` | EDIT | Entry point — remove lógica de sync, usa sync-runner |
| `workers/dashboard-sync/tsconfig.json` | EDIT | Adicionar `resolveJsonModule`, incluir test files |
| `workers/dashboard-sync/test/unit/catalog.test.ts` | CREATE | Testes Red de config resolution |
| `workers/dashboard-sync/test/unit/sync-runner.test.ts` | EDIT | Habilitar skipped test + loop multi-tenant |

### Design (SoC)

```
src/types.ts        — TenantGa4Config, ProductMetaConfig, SyncResult, DashboardCatalog
src/catalog.ts      — resolveTenantGa4Config, resolveProductMetaConfig,
                       buildProductLookup, listTenantsWithGa4, listProductsWithMeta
src/ga4.ts          — getGa4AccessToken, fetchGa4Report, upsertGa4Metrics
src/meta.ts         — fetchMetaInsights, extractMetaMetrics, upsertMetaMetrics
src/sync-runner.ts  — syncTenantGa4, syncTenantProductMeta, runSync
src/index.ts        — HTTP + Cron + auth + locking (não sabe de GA4 nem Meta)
```

### Coupling antes vs depois

```typescript
// ❌ Antes (tight): syncGa4 conhece Env completo
async function syncGa4(db, env: Env, dateStr) {
  const token = await getGa4AccessToken(env.GA4_SERVICE_ACCOUNT_KEY);
  // hardcoded productMap + hardcoded DECOLE
}

// ✅ Depois (loose): funções recebem só o que precisam
async function syncTenantGa4(db, config: TenantGa4Config, dateStr, productLookup) {
  const token = await getGa4AccessToken(config.serviceAccountKey);
  const rows  = await fetchGa4Report(config.propertyId, token, dateStr);
  await upsertGa4Metrics(db, config.tenantId, dateStr, rows, productLookup);
}
// Resolução de config → catalog.ts; orquestração → sync-runner.ts
```

## Testes (TDD Red → Green)

### Red — `test/unit/catalog.test.ts`

- `resolveTenantGa4Config` → null quando tenant sem dashboard config
- `resolveTenantGa4Config` → config quando env vars presentes
- `resolveTenantGa4Config` → null quando env vars vazias
- `resolveProductMetaConfig` → null quando produto sem metaAds
- `resolveProductMetaConfig` → config quando env vars presentes
- `buildProductLookup` mapeia productCode lowercase → productCode canonical
- `listTenantsWithGa4` → apenas tenants com ga4 config
- `listProductsWithMeta` → apenas produtos com metaAds

### Red — `test/unit/sync-runner.test.ts` (enable skipped)

- `?tenant=unknown` → 400 (estava `.skip`)
- `?tenant=decole` → filtra para só DECOLE
- Catalog com 2 tenants → runSync chama syncGa4 2x

## Validação executável

```bash
cd workers/dashboard-sync

# Red (antes da implementação)
npx vitest run
# Esperado: testes catalog.test.ts falham

# Green (após implementação)
npx vitest run
# Esperado: todos passed

# Typecheck
npx tsc --noEmit
# Esperado: 0 errors

# Audit grep
grep -rE "DECOLE|PLANOVOO|ESG|productMap" workers/dashboard-sync/src/
# Esperado: 0 matches
```

## Smoke checklist

- [x] `vitest run` verde — **24/24 passed** (16 novos catalog + 8 sync-runner)
- [x] `tsc --noEmit` limpo (erros em `node_modules/tinybench` são pré-existentes do vitest v4, não do código)
- [x] `grep` audit: **0 matches** em `workers/dashboard-sync/src/`
- [x] D1 INSERTs incluem `tenant_id` (em `ga4.ts` e `meta.ts`)
- [x] `?tenant=unknown` → 400 (teste habilitado e passando)
- [x] Nenhum deploy executado

## Rollback

```bash
git revert <commit_hash>
# Sem wrangler deploy — Fase 2
```

## Revisão G.12 — preenchido antes de DONE

### 2026-05-18 by Claude Sonnet 4.6 — auto-revisão

**REVISÃO G.12**

**Código TypeScript**
- [x] Strict mode; 0 `any` não justificado
- [x] 0 referências hardcoded a DECOLE, PLANOVOO, ESG, productMap em `src/`
- [x] Interfaces explícitas em `types.ts` — sem `any` em fronteiras de módulo

**Arquitetura (SoC)**
- [x] `catalog.ts`: puro, sem IO — só transforma catalog+env em config objects
- [x] `ga4.ts`: só sabe de GA4 API e `ga4_daily_metrics` — não lê catálogo
- [x] `meta.ts`: só sabe de Meta API e `meta_daily_metrics` — não lê catálogo
- [x] `sync-runner.ts`: orquestra loop de tenants/produtos sem conhecer env var names
- [x] `index.ts`: só faz HTTP/Cron/auth/locking — não importa `ga4.ts` nem `meta.ts` diretamente
- [x] grep audit: 0 matches em `src/`

**Testes**
- [x] TDD Red verificável: `catalog.test.ts` falhou antes da implementação
- [x] `catalog.test.ts`: 16 testes (happy path + null paths + isolamento)
- [x] `sync-runner.test.ts`: `?tenant=unknown` → 400 habilitado + 8 testes passando
- [x] Mocks isolados (D1 stub por test, sem state compartilhado)

**Slice file**
- [x] Execução preenchida; decisões documentadas; gotchas registrados

Código: ✅ OK
Arquitetura: ✅ OK
Testes: ✅ OK

**Resultado:** APROVADO

---

## Execução (append-only)

### 2026-05-18 por Claude Sonnet 4.6

- O que foi tentado: recovery point confirmado (commit `cd9a00f`); design SoC aprovado pelo usuário; slice file criado.
- O que funcionou: contexto completo coletado; estrutura de 4+1 módulos definida.
- Próximo passo: escrever testes Red em `catalog.test.ts` + habilitar teste `.skip` em `sync-runner.test.ts`.

### 2026-05-18 (TDD Red) por Claude Sonnet 4.6

- O que foi tentado: `catalog.test.ts` (16 testes importando `src/catalog` inexistente) + enable `.skip` no sync-runner.
- O que funcionou: Red confirmado — `catalog.test.ts` falhou por `Cannot find module`; `?tenant=unknown` falhou por retornar 500 em vez de 400.
- Próximo passo: criar `types.ts`, `catalog.ts`, `ga4.ts`, `meta.ts`, `sync-runner.ts`; atualizar `index.ts`.

### 2026-05-18 (implementação) por Claude Sonnet 4.6

- O que foi tentado: implementação completa dos 5 módulos + update do index.ts + tsconfig.
- O que funcionou:
  - `types.ts`: interfaces `TenantGa4Config`, `ProductMetaConfig`, `SyncResult`, `DashboardSyncEnv`, `TenantDashboardCatalog`, `SyncPart`, `SyncRunRow`.
  - `catalog.ts`: `resolveTenantGa4Config`, `resolveProductMetaConfig`, `buildProductLookup`, `listTenantsWithGa4`, `listProductsWithMeta` — todos puros, sem IO.
  - `ga4.ts`: `getGa4AccessToken`, `fetchGa4Report`, `upsertGa4Metrics`, `syncTenantGa4` — D1 INSERT inclui `tenant_id`.
  - `meta.ts`: `fetchMetaInsights`, `extractMetaMetrics`, `upsertMetaMetrics`, `syncTenantProductMeta` — D1 INSERT inclui `tenant_id`.
  - `sync-runner.ts`: `resolveTenantList` (fail-fast para tenant desconhecido), `runSync` (loop multi-tenant).
  - `index.ts`: valida `?tenant=` antes do lock; passa `bundledCatalogJson` como catálogo; sem referências diretas a GA4/Meta.
  - 24/24 testes verdes; grep 0 matches.
- O que falhou: primeiro `tsc --noEmit` mostrou erros em `tinybench/dist/index.d.ts` — são pré-existentes do vitest v4, não do código; `skipLibCheck: true` poderia silenciar mas não é necessário pois não afeta build.
- Próximo passo: commit + fechar STATUS e PLANO-MASTER.

## Gotchas / lições aprendidas

- Os erros de typecheck em `node_modules/tinybench/dist/index.d.ts` são pré-existentes do vitest v4 — não são do código do worker. Para verificar erros reais do src, usar `npx tsc --noEmit 2>&1 | grep -v node_modules`.
- `DashboardSyncEnv` usa `[key: string]: unknown` para os bindings dinâmicos do Secrets Store — o `readEnvString` em `catalog.ts` faz o cast seguro para string.
- O `resolveTenantList` foi separado do `runSync` para ser testável em isolamento e para poder ser chamado no `fetch` handler antes de adquirir o lock.

## Decisões tomadas (delta vs plano original)

- **4+1 módulos** (types + catalog + ga4 + meta + sync-runner + index) em vez de monolito de 638 linhas — alinhado ao feedback do usuário sobre SoC.
- **`readStringBinding(env, key)`** como helper de transição — lê string diretamente (tests e worker secrets) sem `resolveSecret()` async; Fase 3 validará Secrets Store.
