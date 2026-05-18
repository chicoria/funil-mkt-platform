# Slice 2.11A.1 — Catálogo v5 aditivo + helpers de leitura

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | IN_PROGRESS |
| Started | 2026-05-18 ~02:20 por Claude Code (agent) |
| Completed | — |
| Commit final | — |
| PR | — |

## Contexto

Schema v4 atual: `tenants.{id}` tem apenas `{name, domains, credentials, products}`.
Schema v5 adiciona: `tracking` (tenant-level), `integrations`, `allowedOrigins`, `dashboard`, `links` no tenant; e `hotmart.urlSlugs`, `links`, `dashboard.metaAds`, `n8nForward` nos produtos.

**Princípio:** aditivo — campos v4 ficam intactos. Workers existentes continuam funcionando sem mudança. Fase 2 usa os campos novos via helpers com fallback explícito.

## Pré-requisitos

- [x] Slice 2.11A.0 DONE (wrapper de Secrets Store)
- [x] catálogo JSON acessível em `config/products.catalog.json`

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `config/products.catalog.json` | EDIT | Bump schemaVersion 4→5; adicionar campos novos em tenant + produtos (aditivo) |
| `packages/shared/src/catalog-v5.ts` | CREATE | Interfaces TypeScript v5 + helpers de leitura com fallback v4 |
| `packages/shared/test/unit/catalog-v5.test.ts` | CREATE | Testes: leitura v5, fallback v4, overlay staging |

### Campos novos no catálogo (diff conceitual)

```jsonc
// tenants.decole — campos adicionados
{
  "allowedOrigins": ["https://decolesuacarreiraesg.com.br"],
  "tracking": {
    "gtm": { "containerPublicId": "GTM-58CQ9K7X" },
    "sgtm": { "endpointEnvVar": "SGTM_ENDPOINT_URL_DECOLE" },
    "ga4": {
      "measurementId": "G-BQQB6X5XN1",
      "measurementIdEnvVar": "GA4_MEASUREMENT_ID_DECOLE",
      "apiSecretEnvVar": "GA4_API_SECRET_DECOLE"
    },
    "metaCapi": { "accessTokenEnv": "META_CAPI_ACCESS_TOKEN_DECOLE" }
  },
  "integrations": {
    "n8n": { "webhookUrlEnv": "N8N_WEBHOOK_URL_DECOLE", "disableForwardEnv": "N8N_DISABLE_FORWARD_DECOLE" },
    "planovoo": {
      "baseUrlEnv": "PLANOVOO_API_BASE_URL_DECOLE",
      "hookSecretEnv": "PLANOVOO_HOOK_SECRET_DECOLE",
      "scope": ["DECOLE_PLANOVOO"],
      "appWebhooks": [{ "path": "/webhooks/v1/planovoo/app/event", "productCode": "DECOLE_PLANOVOO", "requiresHmac": true }]
    }
  },
  "dashboard": {
    "ga4": { "propertyIdEnv": "GA4_PROPERTY_ID_DECOLE", "serviceAccountKeyEnv": "GA4_SERVICE_ACCOUNT_KEY_DECOLE" },
    "metaAds": { "accessTokenEnv": "META_ACCESS_TOKEN_DECOLE" }
  },
  "links": {
    "linksDomain": "links.decolesuacarreiraesg.com.br",
    "routes": [
      { "path": "/decole-esg/checkout", "type": "checkout", "productCode": "DECOLE_ESG_MENTORIA" },
      { "path": "/plano-de-voo/checkout", "type": "checkout", "productCode": "DECOLE_PLANOVOO" },
      { "path": "/checkout", "type": "checkout", "productCode": "DECOLE_ESG_MENTORIA", "legacy": true, "deprecated": true }
    ],
    "contacts": {
      "elizete-wp": { "type": "whatsapp", "number": "351915787088", "defaultText": "Olá Elizete, estou no site do decolesuacarreiraesg.com.br e tenho uma dúvida. :)" }
    }
  }
}
// products.DECOLE_ESG_MENTORIA — campos adicionados
{
  "hotmart": { "urlSlugs": ["decole-esg"] },
  "links": { "checkoutBaseUrl": "https://pay.hotmart.com/K98068530F?off=3j6lto4t", "offerPathTemplate": "/decole-esg/checkout/offer/{offerCode}" },
  "dashboard": { "metaAds": { "adAccountIdEnv": "META_AD_ACCOUNT_ID_DECOLE_ESG" } }
}
// products.DECOLE_PLANOVOO — campos adicionados
{
  "hotmart": { "urlSlugs": ["planodevoo", "planovoo", "plano-de-voo"] },
  "links": { "checkoutBaseUrl": "https://pay.hotmart.com/R105463680A?off=f3yweqek", "offerPathTemplate": "/plano-de-voo/checkout/offer/{offerCode}" },
  "dashboard": { "metaAds": { "adAccountIdEnv": "META_AD_ACCOUNT_ID_DECOLE_PLANOVOO" } },
  "n8nForward": { "enrichPayload": true }
}
```

## Execução (append-only)

### 2026-05-18 ~02:20 by Claude Code
- Criado slice file; início de implementação TDD

## Revisão G.12 (Code + Architecture + Tests)

(preencher após conclusão)
