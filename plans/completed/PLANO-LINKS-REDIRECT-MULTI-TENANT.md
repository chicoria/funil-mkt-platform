# Plano Satélite 3 — links-redirect Multi-Tenant

> **Satélite** de [`PLANO-MASTER-MULTI-TENANT.md`](../PLANO-MASTER-MULTI-TENANT.md) (Slice 2.11C)
> **Pode rodar em paralelo** com 2.11A/B/D
> **Pré-requisito:** schema v5 do catálogo (slice 2.11A.1) — campos `tenants.{id}.links` e `products.{code}.links`

---

## 1. Objetivo

Remover hardcode do `workers/links-redirect` (paths, URLs Hotmart, contatos WhatsApp, fallbacks DECOLE) e tornar tudo configurável via `tenants.{id}.links` e `products.{code}.links` no catálogo. Habilita onboarding de novo tenant **sem mudar código do worker** — apenas catálogo + DNS + secret de WhatsApp opcional.

## 1.5 Princípio operacional: links-redirect é agnóstico de tenant/produto

(mesma regra do satélite 1, seção 8.1)

**O que worker PODE conhecer (acceptable hardcode):**
- Caminhos de convenção genéricos: `/health`, paths estruturais `/checkout`, `/checkout/offer/{offerCode}`
- Parâmetros padrão de recuperação: `CHECKOUT_RECOVERY_PARAM_KEYS` (email, name, utm_*, fbp, gclid, etc. — convenção universal)
- Tipos de contato genéricos: `whatsapp`, `telegram`, etc.
- Nomes de bindings: `FUNNEL_EVENTS`, `IDENTITY_KV`, `DEFAULT_TENANT_ID`
- Helpers de URL: `buildWhatsAppUrl`, `appendQueryParams`, `withOfferCode`

**O que worker NÃO PODE conhecer (vem do catálogo):**
- Quais tenants existem (resolve via hostname + `tenants.{id}.domains[]`)
- Quais paths de checkout existem por tenant (`tenants.{id}.links.routes[]`)
- Quais contatos (WhatsApp, etc.) cada tenant tem (`tenants.{id}.links.contacts[slug]`)
- Números de WhatsApp, texto default, URL Hotmart base, offer paths
- Slugs de produto (`DECOLE_ESG_MENTORIA`, `DECOLE_PLANOVOO`, etc.)
- Que `/checkout` legacy aponta para DECOLE_ESG_MENTORIA (sai do código, vira route no catálogo com `legacy: true`)

**Critério de aceite (validado por script em CI ao final de 2.11C.3):**

```bash
grep -rE "DECOLE|PLANOVOO|ESG|SUPERARE|ELIZETE|decolesuacarreiraesg|planodevoo|plano-de-voo|decole-esg|351915787088" \
  workers/links-redirect/src/
# Esperado: 0 matches (exceto comentários explicativos de design decisions)
```

Adição/remoção de tenant, produto, contato ou rota = mudança APENAS no catálogo + (se aplicável) wrangler.toml routes para novo hostname. Worker sem deploy.

## 2. Inventário do hardcode atual

(em `workers/links-redirect/`)

**wrangler.toml:**
- `ELIZETE_WHATSAPP_NUMBER = "351915787088"`
- `ELIZETE_WHATSAPP_DEFAULT_TEXT`
- `DECOLE_MENTORIA_CHECKOUT_URL`
- `PLANO_DE_VOO_CHECKOUT_URL`
- `LINKS_PRODUCTS` (JSON array)
- `routes = ["links.decolesuacarreiraesg.com.br/*"]` — só DECOLE

**src/index.ts:**
- **Linha 59:** `DEFAULT_TENANT_ID = "decole"` hardcoded
- **Linhas 260-264** `inferProductCodeByPath`: switch hardcoded para slugs DECOLE
- **Linhas 278-291** `resolveCheckoutProductByPath`: fallback hardcoded para 2 produtos DECOLE
- **Linhas 320-322** `handlers`: map estático com `"elizete-wp"`
- **Linha 262:** path `"checkout"` legacy → `DECOLE_ESG_MENTORIA`

## 3. Estrutura no catálogo (parte do schema v5)

```jsonc
{
  "tenants": {
    "decole": {
      "links": {
        "linksDomain": "links.decolesuacarreiraesg.com.br",
        "routes": [
          { "path": "/decole-esg/checkout", "type": "checkout", "productCode": "DECOLE_ESG_MENTORIA" },
          { "path": "/plano-de-voo/checkout", "type": "checkout", "productCode": "DECOLE_PLANOVOO" },
          { "path": "/checkout", "type": "checkout", "productCode": "DECOLE_ESG_MENTORIA", "legacy": true, "deprecated": true }
        ],
        "contacts": {
          "elizete-wp": {
            "type": "whatsapp",
            "number": "351915787088",
            "defaultText": "Olá Elizete, estou no site do decolesuacarreiraesg.com.br e tenho uma dúvida. :)"
          }
        }
      },
      "products": {
        "DECOLE_ESG_MENTORIA": {
          "links": {
            "checkoutBaseUrl": "https://pay.hotmart.com/K98068530F?off=3j6lto4t",
            "offerPathTemplate": "/decole-esg/checkout/offer/{offerCode}"
          }
        },
        "DECOLE_PLANOVOO": {
          "links": {
            "checkoutBaseUrl": "https://pay.hotmart.com/R105463680A?off=f3yweqek",
            "offerPathTemplate": "/plano-de-voo/checkout/offer/{offerCode}"
          }
        }
      }
    }
  }
}
```

**Decisão sobre WhatsApp number:** dado público (não secret) → fica direto no catálogo (`number`). Se tenant futuro tiver razão de privacidade, oferecemos opção `numberEnv` apontando para Secrets Store.

## 4. Refactor do código

- Bundle catálogo via `import bundledCatalogJson from "../../../config/products.catalog.json"` (mesmo pattern do dispatcher/dashboard-sync)
- Resolver tenant via hostname: `tryResolveTenantIdFromHostname` do `packages/shared/tenant-from-hostname.ts`
- `resolveCheckoutProductByPath`: lookup em `catalog.tenants[tenant].links.routes[]` em vez de switch hardcoded
- `handlers`: derivar dinamicamente de `catalog.tenants[tenant].links.contacts` em vez de map estático
- `checkoutBaseUrl`: resolver via `catalog.tenants[tenant].products[productCode].links.checkoutBaseUrl`
- Remover: função `inferProductCodeByPath`, branches fallback hardcoded, `DEFAULT_TENANT_ID` const
- Interface `Env`: remover `DECOLE_MENTORIA_CHECKOUT_URL`, `PLANO_DE_VOO_CHECKOUT_URL`, `ELIZETE_WHATSAPP_NUMBER`, `ELIZETE_WHATSAPP_DEFAULT_TEXT`, `LINKS_PRODUCTS`

## 5. wrangler.toml multi-tenant

```toml
name = "decole-links-redirect"
routes = [
  { pattern = "links.decolesuacarreiraesg.com.br/*", zone_name = "decolesuacarreiraesg.com.br" },
  # Quando SUPERARE for onboardado, adicionar:
  # { pattern = "links.superare.com.br/*", zone_name = "superare.com.br" }
]
# [vars] vazio (ou só com flags operacionais)

[env.staging]
name = "decole-links-redirect-stg"
routes = [
  { pattern = "stg-links.decolesuacarreiraesg.com.br/*", zone_name = "decolesuacarreiraesg.com.br" }
]
```

## 6. Testes

- Adicionar `test/unit/` (worker hoje tem cobertura mínima)
- `test/unit/route-resolver.test.ts`: lookup correto de `links.routes` por hostname + path; tenant errado não vê routes
- `test/unit/contact-handler.test.ts`: contato `elizete-wp` resolve em hostname DECOLE; retorna 404 em hostname SUPERARE
- Reusa `cross-tenant-isolation.test.ts` do shared (já cobre worker via lookup catálogo)

## 7. Cutover sem downtime

- Catálogo v5 ganha campos novos `tenants.{id}.links` + `products.{code}.links` (parte da Fase 0)
- Deploy do código novo com **fallback total para env vars antigas** se catálogo não tem `links`
- Smoke: testar TODAS as URLs conhecidas — `/decole-esg/checkout`, `/plano-de-voo/checkout`, `/checkout`, `/elizete-wp`, com e sem `?off=`, `?email=`, `?rid=` (checkout recovery)
- Janela 24-48h monitorando 302s
- Remover env vars antigas do wrangler.toml
- Deploy final sem fallbacks

## 8. Riscos

| # | Risco | Mitigação |
|---|---|---|
| 1 | **Links em emails/QR codes existentes** com URL antiga | Manter rotas legacy (`/checkout`) flagueadas como `deprecated: true` no catálogo até confirmar zero tráfego (verificar logs por 30 dias) |
| 2 | **Cache `cachedLinksProducts`** stale | No novo design, cache é do catálogo bundled (imutável até deploy) — sem problema |
| 3 | **Checkout link errado = perda direta de venda** | Smoke obrigatório com cada URL conhecida pre-deploy; alerta no Logpush para 302→URL malformada ou status 500 com `reason=link_not_configured` |
| 4 | **Adicionar SUPERARE no futuro** requer 2 mudanças coordenadas: catálogo + wrangler.toml route | Documentar no runbook do satélite 2 (onboarding) |

## 9. Definition of Done

- **Critério grep rigoroso** (mesma regra do satélite 1, seção 8.1): `grep -rE "DECOLE|PLANOVOO|ESG|SUPERARE|ELIZETE|decolesuacarreiraesg|planodevoo|plano-de-voo|decole-esg|351915787088" workers/links-redirect/src/` retorna **0 matches** (exceto comentários explicativos)
- Todas as URLs existentes (checkout, offer, contato) continuam funcionando em produção sem regressão
- Smoke E2E: cada URL conhecida testada com e sem params (offer, recovery)
- Onboarding hipotético de SUPERARE: adicionar `tenants.superare.links` no catálogo + adicionar route no wrangler.toml = links de SUPERARE funcionam, **sem mudar código** (validado via teste integrado)
- Slice 2.11C.3 (Fase 4) só fecha quando grep zera
