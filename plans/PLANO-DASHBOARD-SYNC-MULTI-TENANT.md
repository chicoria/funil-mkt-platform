# Plano Satélite 4 — dashboard-sync Multi-Tenant

> **Satélite** de [`PLANO-MASTER-MULTI-TENANT.md`](./PLANO-MASTER-MULTI-TENANT.md) (Slice 2.11D)
> **Pode rodar em paralelo** com 2.11A (não há dependência forte além de naming convention já decidida)
> **Pré-requisito:** Cloudflare Secrets Store + helper wrapper (slice 2.11A.0); migration D1 com `tenant_id` (slice 2.11D.1 dentro da Fase 0)

---

## 1. Objetivo

dashboard-sync descobre tenants/produtos via catálogo; pode rodar em paralelo com 2.11A. Hoje tem `productMap` hardcoded e secrets sem escopo de tenant. Refactor para iterar `Object.keys(catalog.tenants)` e por tenant iterar `Object.keys(tenants[id].products)`, removendo todo hardcode.

## 1.5 Princípio operacional: dashboard-sync é agnóstico de tenant/produto

(mesma regra do satélite 1, seção 8.1)

**O que worker PODE conhecer (acceptable hardcode):**
- Endpoints fixos: GA4 API (`https://analyticsdata.googleapis.com/v1beta/properties/`), Meta Graph (`https://graph.facebook.com/v21.0/`), OAuth (`https://oauth2.googleapis.com/token`)
- Schemas D1 fixos: `ga4_daily_metrics`, `meta_daily_metrics`, `dashboard_sync_runs`, `dashboard_sync_control`
- Convenções de evento GA4: `page_view`, `cta_click` (lista de eventos a sincronizar)
- Nomes de bindings: `EVENT_STORE_DB`, `SYNC_SECRET`
- Lógica de retry com backoff exponencial e detecção de rate limit

**O que worker NÃO PODE conhecer (vem do catálogo):**
- Quais tenants/produtos existem (iterar `Object.keys(catalog.tenants)` e `Object.keys(tenants[id].products)`)
- GA4 property ID, service account, Meta access token, Meta ad account ID — todos via lookup catalog → Secrets Store
- `productMap` hardcoded com `DECOLE_ESG_MENTORIA` e `DECOLE_PLANOVOO` — substituído por reverse lookup do catálogo (aliases inclusos)
- Hardcoded `"DECOLE_ESG_MENTORIA"` e `"DECOLE_PLANOVOO"` em `syncMeta` calls — substituído por loop sobre `tenants.{id}.products`

**Critério de aceite (consolidado com seção 8.1 do satélite 1 — mesmo grep cobre todos os 5 workers):**

```bash
grep -rE "DECOLE|PLANOVOO|ESG|SUPERARE|decolesuacarreiraesg|productMap" \
  workers/dashboard-sync/src/
# Esperado: 0 matches após 2.11D.4 (Fase 4)
```

Adição de tenant futuro = catálogo + secrets no Store + (se aplicável) bindings novos no wrangler.toml = dashboard-sync sincroniza automaticamente na próxima rodada.

## 2. Decisões

- **GA4 property é POR TENANT** (uma property GA4 por tenant; produtos diferenciados via custom dimension `produto`)
- **Meta Ad Account é POR PRODUTO**
- **META_ACCESS_TOKEN:** hoje global. Promovido para POR TENANT (`META_ACCESS_TOKEN_DECOLE`) — token de System User pertence ao Business Manager do tenant, não a um produto individual
- **Cron** sincroniza TODOS os tenants em cada run. **HTTP manual** aceita `?tenant=` opcional para sync seletivo

## 3. Nova estrutura no catálogo (parte do schema v5)

```jsonc
{
  "tenants": {
    "decole": {
      "dashboard": {                                          // NOVO
        "ga4": {
          "propertyIdEnv": "GA4_PROPERTY_ID_DECOLE",
          "serviceAccountKeyEnv": "GA4_SERVICE_ACCOUNT_KEY_DECOLE",
          "customDimensions": {
            "product": "customEvent:produto"
          }
        },
        "metaAds": {
          "accessTokenEnv": "META_ACCESS_TOKEN_DECOLE"
        }
      },
      "products": {
        "DECOLE_ESG_MENTORIA": {
          "dashboard": {                                       // NOVO — por produto
            "metaAds": {
              "adAccountIdEnv": "META_AD_ACCOUNT_ID_DECOLE_ESG"
            }
          }
        },
        "DECOLE_PLANOVOO": {
          "dashboard": {
            "metaAds": {
              "adAccountIdEnv": "META_AD_ACCOUNT_ID_DECOLE_PLANOVOO"
            }
          }
        }
      }
    }
  }
}
```

## 4. Mudanças no código

**Arquivo:** [`workers/dashboard-sync/src/index.ts`](../workers/dashboard-sync/src/index.ts)

### 4.1 Bundling do catálogo

Hoje dashboard-sync não importa o catálogo. Adicionar:

```typescript
import bundledCatalogJson from "../../../config/products.catalog.json";
```

(mesmo pattern do funnel-dispatcher/src/handlers/index.ts).

### 4.2 Remover productMap hardcoded (linhas 174–179)

Substituir por reverse lookup do catálogo:

```typescript
function buildProductSlugMap(catalog): Record<string, {tenant: string, product: string}> {
  // GA4 retorna a dimension 'produto' com o valor que o site enviou
  // (DECOLE_ESG_MENTORIA, DECOLE_PLANOVOO etc.). Aceitar também lowercase e aliases.
  const map = {};
  for (const [tid, t] of Object.entries(catalog.tenants)) {
    for (const [pcode, p] of Object.entries(t.products)) {
      const keys = [pcode, ...(p.aliases ?? [])];
      for (const k of keys) {
        map[k.toLowerCase()] = { tenant: tid, product: pcode };
      }
    }
  }
  return map;
}
```

### 4.3 syncGa4 — agora recebe tenant

Função vira: `syncGa4(db, env, tenantId, dateStr)`.
- Lê `propertyIdEnv` e `serviceAccountKeyEnv` de `catalog.tenants[tenantId].dashboard.ga4`
- `env[propertyIdEnv]` e `env[serviceAccountKeyEnv]` em vez de `env.GA4_PROPERTY_ID` e `env.GA4_SERVICE_ACCOUNT_KEY`
- INSERT no D1 inclui `tenant_id` como coluna (ver seção 5)

### 4.4 syncMeta — agora recebe tenant + produto

Função vira: `syncMeta(db, env, tenantId, productCode, dateStr)`.
- Lê `accessTokenEnv` de `catalog.tenants[tenantId].dashboard.metaAds`
- Lê `adAccountIdEnv` de `catalog.tenants[tenantId].products[productCode].dashboard.metaAds`
- Pula silenciosamente (`handler_skip`) se o produto não tem `dashboard.metaAds` declarado
- INSERT no D1 inclui `tenant_id`

### 4.5 runSync — loops aninhados

```typescript
async function runSync(env, dateStr, part, opts: { tenantFilter?: string }) {
  const catalog = parseBundledCatalog();
  const tenants = Object.keys(catalog.tenants).filter(
    t => !opts.tenantFilter || t === opts.tenantFilter
  );

  for (const tenantId of tenants) {
    if (part === "all" || part === "ga4") {
      try { await syncGa4(db, env, tenantId, dateStr); }
      catch (e) { errors.push(`ga4:${tenantId}:${msg}`); }
    }
    if (part === "all" || part === "meta") {
      const products = Object.keys(catalog.tenants[tenantId].products);
      for (const productCode of products) {
        const hasMetaAds = !!catalog.tenants[tenantId].products[productCode]
                                  ?.dashboard?.metaAds?.adAccountIdEnv;
        if (!hasMetaAds) continue;
        try { await syncMeta(db, env, tenantId, productCode, dateStr); }
        catch (e) { errors.push(`meta:${tenantId}:${productCode}:${msg}`); }
      }
    }
  }
}
```

### 4.6 fetch handler — adicionar ?tenant=

```typescript
const tenantFilter = url.searchParams.get("tenant") || undefined;
```

- Valida contra `Object.keys(catalog.tenants)` — 400 se desconhecido
- POST body também aceita `{ tenant?: string }`

### 4.7 Interface Env — remover/renomear

- **REMOVER:** `GA4_SERVICE_ACCOUNT_KEY`, `GA4_PROPERTY_ID`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID_ESG`, `META_AD_ACCOUNT_ID_PLANOVOO`
- **ADICIONAR:** campos dinâmicos. Interface com `[key: string]: string | D1Database` e tipos explícitos para os bindings fixos (`EVENT_STORE_DB`, `SYNC_SECRET`). Pattern já usado em `DispatcherEnv`

## 5. D1 schema migration

Hoje `ga4_daily_metrics` e `meta_daily_metrics` **NÃO têm `tenant_id`**.

**Risco:** se um segundo tenant for adicionado, `product_code` não é suficiente para PK porque diferentes tenants podem reusar codes (improvável, mas arquiteturalmente possível). Mesmo sem reuso, queries do dashboard precisam saber tenant para isolamento.

**Migration runtime** (mesmo padrão do Slice 2.10 — `__funilmkt_schema_migrations`):

```sql
ALTER TABLE ga4_daily_metrics ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'decole';
ALTER TABLE meta_daily_metrics ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'decole';

-- Rebuild para mudar UNIQUE INDEX (date, product_code, event_name) →
-- (tenant_id, date, product_code, event_name):
DROP INDEX IF EXISTS idx_ga4_daily_unique;
CREATE UNIQUE INDEX idx_ga4_daily_unique
  ON ga4_daily_metrics(tenant_id, date, product_code, event_name);

DROP INDEX IF EXISTS idx_meta_daily_unique;
CREATE UNIQUE INDEX idx_meta_daily_unique
  ON meta_daily_metrics(tenant_id, date, product_code);
```

**Atualizar arquivos:**
- `config/d1/ga4_daily_metrics.sql`
- `config/d1/meta_daily_metrics.sql`
  (adicionar `tenant_id NOT NULL DEFAULT 'decole'` + índice composto)

Atualizar queries de leitura do dashboard separado (repo `decole-dashboard`) para filtrar por `tenant_id` quando aplicável. Tarefa documentada como follow-up, mas o INSERT já passa a gravar com `tenant_id`.

## 6. Secrets — rename e cutover

**Worker `decole-dashboard-sync` (Cloudflare Secrets Store):**

Criar:
```bash
# Via API Cloudflare ou wrangler secrets-store put (sintaxe a confirmar)
GA4_SERVICE_ACCOUNT_KEY_DECOLE       (= GA4_SERVICE_ACCOUNT_KEY)
GA4_PROPERTY_ID_DECOLE                (= GA4_PROPERTY_ID)
META_ACCESS_TOKEN_DECOLE              (= META_ACCESS_TOKEN)
META_AD_ACCOUNT_ID_DECOLE_ESG         (= META_AD_ACCOUNT_ID_ESG)
META_AD_ACCOUNT_ID_DECOLE_PLANOVOO    (= META_AD_ACCOUNT_ID_PLANOVOO)
# (SYNC_SECRET fica global — é um secret operacional, não credencial de tenant)
```

Deploy do código novo (lê dos `*_DECOLE` primeiro, cai nos antigos como fallback).

Smoke:
```bash
curl -H "x-sync-secret: $SECRET" "https://.../sync?date=2026-05-15&tenant=decole"
# Verificar D1 ga4_daily_metrics tem rows com tenant_id='decole'
```

Remover antigos:
```bash
wrangler secret delete GA4_SERVICE_ACCOUNT_KEY
wrangler secret delete GA4_PROPERTY_ID
# ... etc.
```

Deploy final removendo fallbacks.

## 7. Cron multi-tenant

**Decisão:** cron sincroniza TODOS os tenants em cada run (loop natural). Aceita falha de UM tenant sem invalidar os outros — erros agregados em `errors: ['ga4:tenant1:msg', 'meta:tenant2:productX:msg']`.

**HTTP manual:** `?tenant=decole` filtra para um tenant. `?part=ga4|meta|all` permanece. `?product=DECOLE_PLANOVOO` é opcional (default = todos os produtos do tenant). Útil para debug.

**Lock atual** (`dashboard_sync_control`) continua sendo soft lock global — só uma sincronização total acontece por vez. Se necessário no futuro: lock por tenant (key `sync_lock:{tenant_id}`).

## 8. Testes e validação

- **Adicionar test suite ao worker** (hoje não tem). Mínimo:
  - `test/unit/sync-runner.test.ts`: mock do catálogo com 2 tenants, verifica que `syncGa4` é chamado 2x e `syncMeta` é chamado N vezes (1 por produto com `metaAds` declarado)
  - `test/unit/auth.test.ts`: `?tenant=unknown` retorna 400
- D1 migration roda idempotente (testar com SQLite no Node, mesmo pattern do `d1-migration.node.test.mts` do dispatcher)
- Smoke prod: backfill manual de uma data recente para DECOLE, verificar contagens batem com GA4 UI

## 9. Riscos

| # | Risco | Mitigação |
|---|---|---|
| 1 | `META_ACCESS_TOKEN` renomeado para POR TENANT, mas o token atual pode ser de BM com acesso a múltiplos ad accounts | Documentar que se um futuro tenant tiver BM separado, ele recebe `META_ACCESS_TOKEN_<TENANT>` próprio |
| 2 | GA4 anti-automation já causa erros transitórios | `normalizeSyncError` trata isso; adicionar `tenant_id` à mensagem de erro para diagnosticar qual tenant falhou |
| 3 | A migração `ADD COLUMN ... DEFAULT 'decole'` aplica DECOLE como default para linhas existentes | Correto hoje (tudo é DECOLE). Para futuro tenant, backfill manual seria necessário se houvesse linhas pré-multi-tenant daquele tenant — não é o caso |
