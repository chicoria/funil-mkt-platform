# Plano Satélite 1 — Credenciais e Config Multi-Tenant (Schema v5)

> **Satélite** de [`PLANO-MASTER-MULTI-TENANT.md`](./PLANO-MASTER-MULTI-TENANT.md) (Slice 2.11A)
> **Pré-requisito:** PLANO-2 Slice 2.10 (isolamento de dados por tenant) concluído ✅
> **Slice ID:** 2.11A — dividido em sub-slices 2.11A.0 a 2.11A.9 + 2.11T.* (testes de regressão)

---

## 1. Objetivo

Eliminar TODO hardcode de tenant/produto nos 5 workers. Mover credenciais (Brevo, Hotmart, n8n, Plano de Voo, sGTM, GA4, Meta CAPI) para `tenants.{id}.credentials` + `tenants.{id}.integrations` + `tenants.{id}.tracking` no catálogo (schema v5). Usar Cloudflare Secrets Store como source of truth runtime. Permitir onboarding de novo tenant via apenas catálogo + secrets + DNS + (se aplicável) wrangler.toml routes.

## 2. Convenção de naming de secrets

```
Tenant-only:     {SECRET}_{TENANT}             ex: BREVO_API_KEY_DECOLE
Tenant+product:  {SECRET}_{TENANT}_{PRODUCT}   ex: META_PIXEL_ID_DECOLE_PLANOVOO
```

**Critérios para escolher escopo:**
- **Por TENANT:** credencial compartilhada entre produtos do mesmo tenant
  (Brevo API key, Hotmart webhook token, GA4 measurement_id+api_secret, sGTM endpoint, GTM container ID, reply-to email, Meta CAPI access token, n8n webhook)
- **Por PRODUTO:** identificador que diferencia produto dentro do mesmo tenant
  (Meta Pixel ID, Hotmart product_id/checkoutCode, Meta Ad Account ID)

**Casos especiais documentados:**
- `PLANOVOO_API_BASE_URL` / `PLANOVOO_HOOK_SECRET`: integration por tenant; **exclusivo DECOLE** (ver seção 10.7).
- `N8N_WEBHOOK_URL`: hoje global; vira por tenant.
- GTM container `GTM-58CQ9K7X` é compartilhado entre produtos DECOLE → fica em `tenants.decole.tracking.gtm`.

## 3. Avaliação crítica do catálogo atual

**O que está bom (manter):**
- `tenants.{id}.credentials.{brevo_api_key_env, hotmart_token_env}` já tem a forma certa, só precisa repointar valor.
- `tenants.{id}.products.{code}.tracking.metaPixel.pixelIdEnvVar` está por produto.

**O que precisa evoluir:**
1. `tracking.ga4.measurementIdEnvVar` e `apiSecretEnvVar` hoje apontam para `GA4_MEASUREMENT_ID` e `GA4_API_SECRET` (globais). **Decisão:** GA4 é POR TENANT. Mover para `tenants.{id}.tracking.ga4`.
2. **sGTM é redundância acidental hoje**: catálogo tem `SGTM_ENDPOINT_URL_DECOLE_ESG` e `SGTM_ENDPOINT_URL_PLANOVOO` mas é o mesmo container. Consolidar em `tenants.{id}.tracking.sgtm.endpointEnvVar` → `SGTM_ENDPOINT_URL_DECOLE`.
3. Catálogo não tem seção `integrations` — todas as integrações estão como secrets soltos. Introduzir `tenants.{id}.integrations.{integration_name}`.
4. `global.brevo.replyToEmailEnvVar` é redundante com `tenants.decole.credentials.replyToEmail`. Eliminar a global.
5. `global.hotmart.auth.secretEnvVar` é o fallback global usado pelo ingress hoje. Mover validação para por-tenant.

## 4. Schema v5 — estrutura nova

Diff conceitual:

```jsonc
{
  "schemaVersion": 5,
  "global": {
    // Reduzir: manter só o que é genuinamente compartilhado entre tenants
    "hotmart": {
      "docs": { /* ... */ },
      "auth": {
        // Mantém constantes do provedor; remove secretEnvVar (vai para credentials por tenant)
        "acceptedHeaders": ["X-HOTMART-HOTTOK", "X-HOTMART-TOKEN", "X-WEBHOOK-TOKEN"],
        "acceptedQueryParams": ["hottok", "token"]
      }
    }
    // n8n removido daqui — sobe para tenant.integrations.n8n
    // brevo.replyToEmailEnvVar removido — sobe para tenant.credentials
  },
  "tenants": {
    "decole": {
      "name": "DECOLE sua Carreira ESG",
      "domains": [
        "api.decolesuacarreiraesg.com.br",
        "links.decolesuacarreiraesg.com.br",
        "decolesuacarreiraesg.com.br"
      ],
      "allowedOrigins": ["https://decolesuacarreiraesg.com.br"],   // NOVO — sobe de wrangler.toml
      "credentials": {
        "brevo_api_key_env": "BREVO_API_KEY_DECOLE",
        "hotmart_token_env": "HOTMART_WEBHOOK_TOKEN_DECOLE",
        "replyToEmail": "contato@decolesuacarreiraesg.com.br",
        "app_events_hmac_env": "APP_EVENTS_HMAC_DECOLE"
      },
      "tracking": {                                                 // NOVO — POR TENANT
        "gtm": { "containerPublicId": "GTM-58CQ9K7X" },
        "sgtm": { "endpointEnvVar": "SGTM_ENDPOINT_URL_DECOLE" },
        "ga4": {
          "measurementId": "G-BQQB6X5XN1",
          "measurementIdEnvVar": "GA4_MEASUREMENT_ID_DECOLE",
          "apiSecretEnvVar": "GA4_API_SECRET_DECOLE"
        },
        "metaCapi": { "accessTokenEnv": "META_CAPI_ACCESS_TOKEN_DECOLE" }
      },
      "integrations": {                                             // NOVO — POR TENANT
        "n8n": {
          "baseUrl": "https://n8n.decolesuacarreiraesg.com.br",
          "webhookUrlEnv": "N8N_WEBHOOK_URL_DECOLE",
          "disableForwardEnv": "N8N_DISABLE_FORWARD_DECOLE"
        },
        "planovoo": {                                               // exclusivo DECOLE — ver 10.7
          "baseUrlEnv": "PLANOVOO_API_BASE_URL_DECOLE",
          "hookSecretEnv": "PLANOVOO_HOOK_SECRET_DECOLE",
          "scope": ["DECOLE_PLANOVOO"],
          "appWebhooks": [                                          // NOVO — substitui rota hardcoded em api-funnel-ingress
            {
              "path": "/webhooks/v1/planovoo/app/event",
              "productCode": "DECOLE_PLANOVOO",
              "requiresHmac": true
            }
          ]
        },
        "brevo": {
          "baseUrl": "https://api.brevo.com/v3",
          "timeoutMsEnv": "BREVO_TIMEOUT_MS_DECOLE"
        }
      },
      "dashboard": {                                                // NOVO — POR TENANT (satélite 4)
        "ga4": {
          "propertyIdEnv": "GA4_PROPERTY_ID_DECOLE",
          "serviceAccountKeyEnv": "GA4_SERVICE_ACCOUNT_KEY_DECOLE"
        },
        "metaAds": {
          "accessTokenEnv": "META_ACCESS_TOKEN_DECOLE"
        }
      },
      "links": {                                                    // NOVO — POR TENANT (satélite 3)
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
          "hotmart": {
            "productId": "5083704",
            "checkoutCode": "K98068530F",
            "urlSlugs": ["decole-esg"]                              // NOVO — substitui switch hardcoded em api-hotmart-ingress
          },
          "tracking": {
            "productCode": "DECOLE_ESG_MENTORIA",
            "metaPixel": {
              "pixelIdEnvVar": "META_PIXEL_ID_DECOLE_ESG",
              "pixelId": "1329973348435032"
            },
            "differentiation": {
              "produto": "DECOLE_ESG_MENTORIA",
              "product_code": "DECOLE_ESG_MENTORIA"
            }
            // GA4, GTM, sGTM SAEM do produto — sobem para tenant.tracking
          },
          "dashboard": {                                            // NOVO — POR PRODUTO
            "metaAds": {
              "adAccountIdEnv": "META_AD_ACCOUNT_ID_DECOLE_ESG"
            }
          },
          "links": {
            "checkoutBaseUrl": "https://pay.hotmart.com/K98068530F?off=3j6lto4t",
            "offerPathTemplate": "/decole-esg/checkout/offer/{offerCode}"
          }
        },
        "DECOLE_PLANOVOO": {
          "hotmart": {
            "productId": "...",
            "checkoutCode": "R105463680A",
            "urlSlugs": ["planodevoo", "planovoo", "plano-de-voo"]  // NOVO
          },
          "tracking": {
            "productCode": "DECOLE_PLANOVOO",
            "metaPixel": {
              "pixelIdEnvVar": "META_PIXEL_ID_DECOLE_PLANOVOO",
              "pixelId": "2220600768748665"
            },
            "differentiation": {
              "produto": "DECOLE_PLANOVOO",
              "product_code": "DECOLE_PLANOVOO"
            }
          },
          "dashboard": {
            "metaAds": {
              "adAccountIdEnv": "META_AD_ACCOUNT_ID_DECOLE_PLANOVOO"
            }
          },
          "links": {
            "checkoutBaseUrl": "https://pay.hotmart.com/R105463680A?off=f3yweqek",
            "offerPathTemplate": "/plano-de-voo/checkout/offer/{offerCode}"
          },
          "n8nForward": {                                           // NOVO — substitui isPlanovooProductCode hardcoded
            "enrichPayload": true
          }
        }
      }
    }
  }
}
```

### 4.1 Decisão sobre GA4 (consolidada)

**Decisão:** GA4 sobe de `tenants.{id}.products.{code}.tracking.ga4` para `tenants.{id}.tracking.ga4`.

**Justificativa:**
- Uma única GA4 property por tenant (já é a realidade: G-BQQB6X5XN1 para DECOLE_ESG e DECOLE_PLANOVOO).
- Diferenciação entre produtos é feita via custom dimension `produto`, já declarada em `tracking.differentiation`.
- Manter GA4 por produto duplica configuração e abre porta para drift.

### 4.2 Decisão sobre sGTM (consolidada)

**Decisão:** sGTM endpoint sobe para `tenants.{id}.tracking.sgtm.endpointEnvVar` (substitui `SGTM_ENDPOINT_URL_DECOLE_ESG` + `SGTM_ENDPOINT_URL_PLANOVOO` antigos por **único** `SGTM_ENDPOINT_URL_DECOLE`).

**Confirmar antes da migração:** ambos os antigos `SGTM_ENDPOINT_URL_*` apontavam para a mesma instância? Se forem instâncias distintas, requer migração de container sGTM antes (ver satélite 2).

## 5. Mudanças por worker

### 5.1 funnel-dispatcher

**Arquivo:** [`workers/funnel-dispatcher/wrangler.toml`](../workers/funnel-dispatcher/wrangler.toml)

- **REMOVER** de `[vars]`: `PLANOVOO_API_BASE_URL` (vira secret `PLANOVOO_API_BASE_URL_DECOLE`).

**Secrets a CRIAR no Cloudflare Secrets Store** (account-level, não per-worker):

**Por tenant (todos tenants têm):**
- `BREVO_API_KEY_DECOLE` (valor atual de `BREVO_API_KEY`)
- `HOTMART_WEBHOOK_TOKEN_DECOLE` (valor atual de `HOTMART_WEBHOOK_TOKEN`)
- `SGTM_ENDPOINT_URL_DECOLE` (consolida `_ESG` e `_PLANOVOO` antigos)
- `GA4_MEASUREMENT_ID_DECOLE`
- `GA4_API_SECRET_DECOLE`
- `META_CAPI_ACCESS_TOKEN_DECOLE`

**Por tenant (opcionais — apenas se tenant usa a integração):**
- `N8N_WEBHOOK_URL_DECOLE` (DECOLE usa n8n)
- `PLANOVOO_API_BASE_URL_DECOLE` + `PLANOVOO_HOOK_SECRET_DECOLE` (**exclusivos DECOLE** — ver seção 10.7)

**Por produto:**
- `META_PIXEL_ID_DECOLE_ESG` (rename de `META_PIXEL_ID_DECOLE_ESG`)
- `META_PIXEL_ID_DECOLE_PLANOVOO` (rename de `META_PIXEL_ID_PLANOVOO`)

**Secrets que continuam globais:**
- `BREVO_BASE_URL` (default em código se ausente)
- `BREVO_SANDBOX` (flag de teste)

**Pontos no código a refatorar:**

- [`workers/funnel-dispatcher/src/dispatcher.ts:19`](../workers/funnel-dispatcher/src/dispatcher.ts) — interface `DispatcherEnv`: refactor para `[key: string]: string` (chaves dinâmicas) + tipos explícitos para bindings fixos (queue, D1, KV, Secrets Store). Remover `PLANOVOO_API_BASE_URL` e `PLANOVOO_HOOK_SECRET` da interface — worker lê via lookup `env[catalog.event.product_api.url_env]`.
- [`workers/funnel-dispatcher/src/handlers/index.ts:24`](../workers/funnel-dispatcher/src/handlers/index.ts) — `const LINKS_BASE_URL = "https://links.decolesuacarreiraesg.com.br"` — URL DECOLE hardcoded. Refactor: helper `getLinksBaseUrl(tenantId, catalog)` resolve via `tenants.{id}.links.linksDomain`.
- `handlers/index.ts:222-224` — `isPlanovooProductCode` switch hardcoded — anti-agnostic. Refactor: `buildN8nForwardPayload` checa flag `products.{code}.n8nForward.enrichPayload` do catálogo em vez de switch por nome.
- `handlers/index.ts:646` — `resolveTrackingConfig`: sGTM endpoint + GA4 measurement/api_secret + Meta CAPI token vêm de `tenants.{id}.tracking`; Meta Pixel ID continua de produto.
- `handlers/index.ts:1258, 1361, 1422` — handlers Brevo (`send_cart_abandonment_email`, `send_brevo_doi`, `update_brevo_funnel`): `env.BREVO_API_KEY` → `ctx.credentials.brevoApiKey`.
- `handlers/index.ts:1552` — `forwardN8n`: `env.N8N_WEBHOOK_URL` → resolver via `tenants.{id}.integrations.n8n.webhookUrlEnv`.
- `handlers/index.ts:1585` — mesma `isPlanovooProductCode` usada — mesmo refactor.
- `handlers/index.ts:1650` — `replyToEmail: "contato@decolesuacarreiraesg.com.br"` fallback hardcoded. **Remover fallback.** Resolve só via `tenants.{id}.credentials.replyToEmail`. Se ausente: log warning + skip envio.

### 5.2 api-hotmart-ingress

**Mudanças críticas** em [`workers/api-hotmart-ingress/src/index.ts`](../workers/api-hotmart-ingress/src/index.ts):

- **CRÍTICO — inverter ordem:** hoje `isAuthorized` (linha 96) roda ANTES de `resolveTenantIdFromHostname` (linha 119). Multi-tenant exige resolver tenant primeiro (via hostname + path), DEPOIS validar token via `credentials.hotmart_token_env` do tenant resolvido. Sem isso é impossível ter tokens diferentes por tenant.
- **Linhas 59-63 (`productCodeFromSlug`):** switch hardcoded (`decole-esg`, `planodevoo`, `planovoo`, `plano-de-voo`) deve virar **lookup catalog-aware**: iterar `tenants.{id}.products.{code}.hotmart.urlSlugs[]` procurando match.
- **Linha 119:** fallback string hardcoded `env.DEFAULT_TENANT_ID || "decole"` deve logar warning + retornar 400 se nenhum método resolve tenant.
- Remover `HOTMART_WEBHOOK_TOKEN` global da interface `Env` após Fase 4.

### 5.3 api-funnel-ingress

**Mudanças** em [`workers/api-funnel-ingress/src/index.ts`](../workers/api-funnel-ingress/src/index.ts):

- CORS por tenant via catálogo (`tenants.{id}.allowedOrigins`); remover `ALLOWED_ORIGINS` de `[vars]`.
- **Linha 24:** fallback string hardcoded `?? "decole"` em `withTenantId` — substituir por warning log + erro 400 quando nenhum método resolve tenant.
- **Linha 59:** fallback URL hardcoded `|| "https://decolesuacarreiraesg.com.br"` em `corsHeaders` — remover. Sem origin permitido = 403 explícito.
- **Linha 63:** `"access-control-allow-headers": "content-type, x-app-signature"` — manter como denominador comum (todos tenants podem aceitar `x-app-signature`; só usa quem tem integração de app). Adicionar comentário no código explicitando.
- **Linha 192:** rota `/webhooks/v1/planovoo/app/event` hoje hardcoded. **Refactor para catalog-aware:** iterar `tenants.{id}.integrations.{integration}.appWebhooks[]` no catálogo; cada entrada tem `path` + `productCode` + `requiresHmac`. Hoje só `tenants.decole.integrations.planovoo.appWebhooks[]` existe. Worker fica genérico.

### 5.4 links-redirect

Sem mudança em 2.11A — tratado integralmente no **satélite 3 (Slice 2.11C)**. Esse worker tem muito hardcode (paths, URLs Hotmart, número WhatsApp Elizete, fallbacks para tenant DECOLE) e ganha refactor próprio para mover tudo para `tenants.{id}.links` e `products.{code}.links` no catálogo v5. Pode rodar em paralelo com 2.11A.

### 5.5 dashboard-sync

Coberto integralmente no satélite 4 — não é mexido por 2.11A.

## 6. Cutover sem downtime

**Princípio:** nenhum rename de secret é destrutivo dentro do MESMO worker. Adicionamos o secret novo com mesmo valor, fazemos deploy do código que LÊ os dois (novo preferido, antigo como fallback), confirmamos, e só depois removemos o antigo.

**Ordem por worker (funnel-dispatcher):**

1. Criar secrets no Cloudflare Secrets Store com mesmo valor dos antigos (sliz 2.11A.2)
2. Adicionar bindings `[[secrets_store_secrets]]` em wrangler.toml
3. Deploy do código com helper wrapper que lê Store primeiro, cai para `env.X` antigo
4. Smoke E2E nos dois produtos (GENERATE_LEAD, BEGIN_CHECKOUT, PURCHASE_APPROVED)
5. Monitorar 48h logs `handler_warn` (especialmente cart_abandonment 24h depois)
6. Remover worker secrets antigos via `wrangler secret delete` (slice 2.11A.9)
7. Deploy final sem fallbacks

**Janela de transição esperada:** 24-48h por worker. Total: 2-3 semanas com folga.

## 7. Checklist de validação

- [ ] `npx vitest run` em `workers/funnel-dispatcher` passa (mocks atualizados para `ctx.credentials.brevoApiKey`)
- [ ] `npx vitest run` em `workers/api-hotmart-ingress` passa (auth por tenant)
- [ ] `npx vitest run` em `workers/api-funnel-ingress` passa (CORS por tenant)
- [ ] `npm run typecheck` em cada worker
- [ ] Teste novo (`cross-tenant-isolation.test.ts`): tenant fake "superare" com `credentials.brevo_api_key_env = "BREVO_API_KEY_SUPERARE"` — handler `update_brevo_funnel` lê chave correta, não vaza para DECOLE
- [ ] Teste novo: `resolveTrackingConfig` com tenant DECOLE + produto PLANOVOO devolve GA4 do tenant (G-BQQB6X5XN1) e sGTM endpoint do tenant
- [ ] Smoke prod: enviar test event (`test_event_code`) para cada produto e confirmar chegada no GA4 + Meta CAPI
- [ ] **Validar no sGTM** (UI ou logs) que eventos do GA4 chegam com `produto` correto E que o roteamento para Meta CAPI escolhe o pixel certo (ESG vs PLANOVOO)

## 8. Riscos e rollback

| # | Risco | Mitigação |
|---|---|---|
| 1 | Secret deletado antes do deploy do código novo → handler 500 silencioso | Ordem do cutover: delete só após smoke OK (passo 11 só depois de 10). Logs `handler_warn` no Workers Logs; alertas de queue retry crescendo |
| 2 | Catálogo v5 quebra `scripts/generated/*` | Rodar `npm run validate` antes do merge |
| 3 | GA4 migration: `GA4_MEASUREMENT_ID_DECOLE` não setado e fallback removido cedo → `emit_tracking` pula → perda de conversão server-side | Log `handler_skip reason=missing_product_tracking_config`. Alerta no Logpush filtrando essa string |
| 4 | Hotmart webhook auth: novo `HOTMART_WEBHOOK_TOKEN_DECOLE` tem valor diferente do antigo, ingress rejeita webhook → cart abandonment e purchase approved param | Confirmar passo 1 do cutover: novo secret = mesmo valor exato do antigo. Smoke com webhook real Hotmart sandbox |
| 5 | **Consolidação sGTM em endpoint único exige confirmar que ambos os antigos `SGTM_ENDPOINT_URL_*` apontavam para a mesma instância** | Se forem instâncias distintas: migração de container sGTM antes (ver satélite 2) |
| 6 | `workerViews.funnel-dispatcher.secrets` fica desatualizado | Marcar como derivado / removed em v5 com nota explícita; idealmente gerar via script |

**Rollback:** cada slice tem versão imediatamente anterior do código e do catálogo no git. Re-deploy do commit anterior + recriação do secret antigo se foi deletado.

## 8.1 Princípio operacional: TODOS os workers são agnósticos de tenant/produto

**Regra:** os 5 workers (`api-funnel-ingress`, `api-hotmart-ingress`, `funnel-dispatcher`, `links-redirect`, `dashboard-sync`) são genéricos do funil. Conhecem CONVENÇÕES do protocolo, NÃO conhecem TENANTS nem PRODUTOS hardcoded. Tudo específico vem do catálogo.

**Workers conhecem (acceptable hardcode):**
- Caminhos de convenção: `/funnel/*`, `/webhooks/v1/*/hotmart/*`, `/health`, paths estruturais `/checkout`
- Headers padrão de provedor: `x-hotmart-hottok`, `x-app-signature`, etc.
- Formato de payload de eventos do funil (schema `FunnelEvent`)
- Nomes de bindings: `FUNNEL_EVENTS`, `DEFAULT_TENANT_ID`

**Workers NÃO conhecem (devem vir do catálogo):**
- Quais tenants existem (`Object.keys(catalog.tenants)`)
- Qual hostname pertence a qual tenant (`tenants.{id}.domains[]`)
- Quais produtos cada tenant tem (`tenants.{id}.products`)
- Qual slug Hotmart roteia para qual produto (`products.{code}.hotmart.urlSlugs[]`)
- Qual CORS origin é permitido por tenant (`tenants.{id}.allowedOrigins`)
- Qual token Hotmart valida cada tenant (`tenants.{id}.credentials.hotmart_token_env`)
- Quais rotas de app webhook existem por tenant (`tenants.{id}.integrations.{integration}.appWebhooks[]`)

**Critério de aceite (validado por script em CI ao final de Fase 4 — aplica a TODOS os 5 workers):**

```bash
grep -rE "DECOLE|PLANOVOO|ESG|SUPERARE|ELIZETE|decolesuacarreiraesg|planodevoo|plano-de-voo|decole-esg|isPlanovoo|351915787088|contato@decolesuacarreiraesg" \
  workers/api-funnel-ingress/src/ \
  workers/api-hotmart-ingress/src/ \
  workers/funnel-dispatcher/src/ \
  workers/links-redirect/src/ \
  workers/dashboard-sync/src/
# Esperado: 0 matches (exceto em comentários explicativos de design decisions)
```

Esse script vira `scripts/audit-workers-agnostic.sh`, parte de 2.11A.9 (Fase 4) e roda em CI antes de cada deploy daquele ponto em diante.

**Adição/remoção de tenant ou produto** = mudança APENAS no catálogo + secrets + DNS + (se aplicável) wrangler.toml routes. Workers não precisam de mudança de código.

**Exceções honestas (acceptable hardcode, mesmo após Fase 4):**
- `wrangler.toml` `routes`: declarativa estática (Cloudflare exige no momento do deploy). Onboarding requer route nova + deploy do worker (mas zero mudança de código).
- Caminhos de convenção do protocolo: `/funnel/*`, `/webhooks/v1/*/hotmart/*`, `/checkout`, `/health` — fazem parte do contrato público do worker.
- Headers padrão de provedor: `x-hotmart-hottok`, `x-app-signature` — vêm do contrato Hotmart/CORS.
- **Comentários documentando design decisions** podem mencionar produtos/tenants específicos.

## 8.2 Onde os secrets vivem (inventário + storage)

**Status atual:** secrets descentralizados por plataforma. Cada worker tem sua cópia local via `wrangler secret put` (per-worker store). Drift possível entre dev local (`.env.local`), CI/CD (GitHub Secrets) e prod (Cloudflare). Multi-tenant amplifica: N tenants × M workers = matriz grande de criação/rotação manual.

**Arquitetura alvo — cada plataforma é fonte de verdade do que roda nela:**

| Secret | Runtime | Storage / fonte de verdade | Justificativa |
|---|---|---|---|
| `BREVO_API_KEY_{TENANT}`, `HOTMART_WEBHOOK_TOKEN_{TENANT}`, `N8N_WEBHOOK_URL_{TENANT}`, `META_PIXEL_ID_{TENANT}_{PRODUCT}`, `SGTM_ENDPOINT_URL_{TENANT}`, `PLANOVOO_API_BASE_URL_{TENANT}`, `PLANOVOO_HOOK_SECRET_{TENANT}`, `META_CAPI_ACCESS_TOKEN_{TENANT}`, `GA4_MEASUREMENT_ID_{TENANT}`, `GA4_API_SECRET_{TENANT}`, `APP_EVENTS_HMAC_{TENANT}` (consumidos pelos 5 workers) | Cloudflare Workers | **Cloudflare Secrets Store (account-level)** | Cada secret existe 1× e é binding em N workers. Rotação em 1 lugar propaga. Audit log nativo. |
| `GA4_SERVICE_ACCOUNT_KEY_{TENANT}`, `GA4_PROPERTY_ID_{TENANT}`, `META_ACCESS_TOKEN_{TENANT}`, `META_AD_ACCOUNT_ID_{TENANT}_{PRODUCT}` (consumidos por dashboard-sync) | Cloudflare Workers | **Cloudflare Secrets Store** | Mesma justificativa |
| GA4 measurement_id, api_secret, Meta CAPI access_token, Pixel IDs (consumidos pelo **container sGTM**) | Cloud Run | Lookup tables internas do workspace GTM (encriptadas pelo Google) | Já é nativo do GTM. Ver satélite 2 (seção 4) |
| Secrets para smoke tests E2E e script audit-secrets (consumidos por **GitHub Actions**) | GitHub Actions | **Cloudflare Secrets Store via API** (com CF_API_TOKEN bootstrap em GitHub Secrets) | Reduz GitHub Secrets de N para 2 |
| `CF_API_TOKEN` (bootstrap), `CF_ACCOUNT_ID` | GitHub | GitHub Secrets | Token de bootstrap obrigatório (chicken-and-egg). Escopo mínimo: `Secrets Store:Read` + `Workers Scripts:Edit` |
| `PLANOVOO_HOOK_SECRET`, `DATABASE_URL`, `ADMIN_SECRET`, `N8N_NOTIFY_SECRET` (consumidos pela **app Plano de Voo**) | VPS DigitalOcean | `.env` no docker-compose **(status quo)** | App Next.js no VPS — manter `.env` até houver gatilho |
| SA Google `acesso-api@gtm-k6q4h6br-ndq3n` (dev local) | Filesystem dev | `~/secrets/decole/*.json` apontado por `.env.local` | Não migra. Conveniência de dev |

**Migração Worker secrets → Cloudflare Secrets Store (parte de 2.11A):**
- **Slice 2.11A.0:** criar Secrets Store no account Cloudflare; popular com valores atuais via API; ajustar wrangler.toml com bindings `[[secrets_store_secrets]]`; **manter compatibilidade** (helper wrapper).
- **Após estabilização (slice 2.11A.9):** deletar Worker secrets antigos.
- **Vantagem operacional para multi-tenant:** adicionar SUPERARE = criar secrets no Secrets Store 1× (não em cada worker); workers só ganham binding novo no `wrangler.toml`.

**Script `scripts/audit-secrets.sh`** (entregável de 2.11A):
- Lê catálogo: extrai todos os `*_env` declarados em `tenants.{id}.credentials`, `integrations.*`, `tracking.*`, `dashboard.*`
- Lê Secrets Store via Cloudflare API: lista secrets existentes
- Reporta: declarados-no-catálogo-mas-faltam-no-store (erro de config); store-mas-não-declarados (órfãos)
- Roda em CI antes de cada deploy

**Não usar Google Secret Manager para secrets de worker:** seria over-engineering. Cloudflare Secrets Store cobre o caso multi-tenant de workers nativamente, sem latência de rede e sem precisar de SA Google em runtime de worker.

## 9. Referências cruzadas

2.11A apenas declara no catálogo o campo `tenants.{id}.tracking.sgtm.endpointEnvVar` apontando para o domínio do tenant (`sgtm.decolesuacarreiraesg.com.br`). A **implementação real** do sGTM compartilhado (container único, lookup tables, custom domains) vive no satélite 2 (Slice 2.11B). Decisão futura sobre provedor de infra (Cloud Run atual vs DigitalOcean vs reescrita em Workers) fica documentada lá como "decisão parqueada".

## 10. Compatibilidade com staging (PLANO-STAGING-FUNIL-LANDING-PLANOVOO.md)

**Contexto:** o documento [`PLANO-STAGING-FUNIL-LANDING-PLANOVOO.md`](./PLANO-STAGING-FUNIL-LANDING-PLANOVOO.md) foi escrito em 2026-05-15 propondo "catálogo base + overlay staging" como modelo. Foi escrito antes do detalhamento multi-tenant de 2.11 e assume estrutura achatada (1 tenant). 2.11A precisa garantir que o overlay funciona com schema v5 sem retrabalho.

### 10.1 Overlay staging respeita estrutura multi-tenant

Overlay (`config/environments/staging.json`) usa estrutura `tenants.{id}.*`:

```json
{
  "environment": "staging",
  "tenants": {
    "decole": {
      "domains": ["stg-api.decolesuacarreiraesg.com.br", "stg-links.decolesuacarreiraesg.com.br", "staging.decolesuacarreiraesg.com.br"],
      "tracking": {
        "ga4": { "measurementIdEnvVar": "GA4_MEASUREMENT_ID_DECOLE_STG", "apiSecretEnvVar": "GA4_API_SECRET_DECOLE_STG" },
        "sgtm": { "endpointEnvVar": "SGTM_ENDPOINT_URL_DECOLE_STG" }
      },
      "integrations": {
        "n8n": { "webhookUrlEnv": "N8N_WEBHOOK_URL_DECOLE_STG" },
        "planovoo": { "baseUrlEnv": "PLANOVOO_API_BASE_URL_DECOLE_STG", "hookSecretEnv": "PLANOVOO_HOOK_SECRET_DECOLE_STG" }
      },
      "cloudflare": {
        "queue": "decole-stg-q-funnel-events",
        "d1": { "identity": "decole-stg-d1-identity", "eventStore": "decole-stg-d1-event-store" }
      }
    }
  },
  "safety": { "brevoSandbox": true, "noindex": true }
}
```

### 10.2 Secrets Store — 2 stores separados (prod + staging)

- `funilmkt-prod-secrets` (store_id A): contém `BREVO_API_KEY_DECOLE`, etc.
- `funilmkt-staging-secrets` (store_id B): contém `BREVO_API_KEY_DECOLE_STG`, etc.
- **Convenção:** secrets staging carregam sufixo `_STG` no nome
- **API tokens separados:** read-only-prod e read-only-staging

### 10.3 sGTM staging — container separado

- Cloud Run: 2 services no mesmo projeto GCP — `sgtm-platform-prod` e `sgtm-platform-staging`
- Custom domains: `sgtm.decolesuacarreiraesg.com.br` (prod) e `stg-sgtm.decolesuacarreiraesg.com.br` (staging)
- Workspaces GTM independentes: experimentação em staging não pode contaminar prod tags
- `META_TEST_EVENT_CODE` configurável apenas em staging

### 10.4 wrangler.toml com `[env.staging]` override

Exemplo (`workers/funnel-dispatcher/wrangler.toml`):

```toml
name = "decole-funnel-dispatcher"

[vars]
ENVIRONMENT = "production"

[[secrets_store_secrets]]
binding = "BREVO_API_KEY_DECOLE"
store_id = "<prod-store-id>"
secret_name = "brevo_api_key_decole"

[env.staging]
name = "decole-funnel-dispatcher-stg"

[env.staging.vars]
ENVIRONMENT = "staging"

[[env.staging.secrets_store_secrets]]
binding = "BREVO_API_KEY_DECOLE"
store_id = "<staging-store-id>"
secret_name = "brevo_api_key_decole_stg"

[[env.staging.queues.consumers]]
queue = "decole-stg-q-funnel-events"
```

Deploy: `wrangler deploy --env staging` cria/atualiza worker staging; `wrangler deploy` (sem flag) deploya prod.

### 10.5 Multi-tenant + staging no futuro (SUPERARE)

Quando SUPERARE for onboardado:
- Catálogo base ganha `tenants.superare` com produção
- Overlay staging ganha `tenants.superare` com staging
- Secrets Store staging ganha entradas `BREVO_API_KEY_SUPERARE_STG`, etc.
- sGTM container staging ganha domain `stg-sgtm.superare.com.br` + lookup table superare
- Workers staging continuam servindo ambos os tenants (mesma instância, isolamento por tenant_id)

### 10.6 Follow-up: revisão do PLANO-STAGING

Após 2.11A estar concluído, o documento `PLANO-STAGING` precisa de revisão cirúrgica atualizando:
- Seção do overlay (snippet JSON) para refletir estrutura `tenants.{id}.*`
- Naming dos secrets staging com sufixo `_STG` (não mais valores hardcoded)
- sGTM staging passa a ser container separado (não endpoint genérico)
- Wrangler.toml staging usa `[env.staging]` + Secrets Store bindings

Esse follow-up **não bloqueia 2.11A** — pode rodar em paralelo ou depois.

### 10.7 Premissa: Plano de Voo é produto exclusivo de DECOLE (single-tenant)

**Decisão formal:** o produto **Plano de Voo** (e a app Next.js correspondente em `decole-plano-de-voo-app`, hospedada em VPS DigitalOcean) é exclusivo do tenant DECOLE. Outros tenants que vierem a oferecer produto similar criarão **app própria**, não compartilharão.

**Implicações para o schema v5:**
- `tenants.{id}.integrations.planovoo` é declarado **APENAS** em `tenants.decole.integrations.planovoo`
- Secrets `PLANOVOO_API_BASE_URL_DECOLE`, `PLANOVOO_HOOK_SECRET_DECOLE` existem só no contexto DECOLE
- Handler `call_product_api` no funnel-dispatcher dispara apenas para eventos cujo produto declara `product_api` no catálogo
- DB do Plano de Voo (Postgres no VPS) não recebe coluna `tenant_id` (single-tenant por design)
- Hooks `/api/hooks/{purchase,refund,protest}` na app Next.js continuam validando apenas HMAC

**Princípio mais amplo: integrações por tenant são opcionais**

O schema v5 trata `tenants.{id}.integrations.*` como **opcional**. Cada tenant declara apenas as integrações que usa:
- Todos tenants terão `credentials.brevo_api_key_env` e `credentials.hotmart_token_env`
- Todos terão `tracking.{gtm,sgtm,ga4,metaCapi}`
- `integrations.n8n` pode ser opcional
- `integrations.planovoo` é exclusivo DECOLE

Catalog adapter trata campos ausentes como "feature não habilitada", sem erro.

**Coordenação com `decole-plano-de-voo-app/docs/PLANO-MIGRACAO-N8N-TS.md`:**

PLANO-N8N-TS **não precisa de revisão** por multi-tenant — fica como está, single-tenant. Único ajuste de coordenação pendente: referências stale a `decolesuacarreiraesg/backend/cloudflare/packages/planovoo/` (caminho não existe — pasta vazia).

## 11. Estratégia de testes e regression detection

### 11.1 Auditoria de cobertura atual

| Worker / módulo | Estado dos testes | Cobre o que muda em 2.11? |
|---|---|---|
| funnel-dispatcher | Tem (`tenant-resolver.test.ts`, handlers, `d1-migration.node.test.mts`) | Parcial — mocks referenciam env globais |
| api-funnel-ingress | Tem | Parcial — não cobre CORS multi-tenant |
| api-hotmart-ingress | Tem | Parcial — não cobre auth por tenant |
| links-redirect | Mínimo | N/A em 2.11A |
| **dashboard-sync** | **Zero testes** | **Refactor às cegas em 2.11D** |
| catalog-adapter (shared) | Parcial | Sem teste explícito de merge base+overlay nem fallback v4→v5 |
| Secrets Store wrapper (novo) | Não existe | Vai ser runtime de TODOS os secrets |

### 11.2 Gaps críticos identificados

1. **dashboard-sync sem testes** — vai ser reescrito sem rede de segurança em 2.11D
2. **catalog-adapter sem testes dedicados** — base do schema v5; bug aqui afeta TODOS os workers
3. **Secrets Store wrapper sem testes** — runtime crítico de secrets, novo código
4. **Cross-tenant isolation sem teste explícito** — risco fundamental: tenant A vazar dados para tenant B nunca foi validado
5. **Sem regression detection de payload** — refactor pode mudar payload de `emit_tracking` sutilmente sem ninguém perceber
6. **CORS multi-tenant sem cobertura**

### 11.3 Cobertura mínima necessária (Fase 0.5 — bloqueante para Fase 2)

Antes de QUALQUER refactor da Fase 2, ganhar a infraestrutura mínima de regressão. Estimativa: **3-5 dias de trabalho concentrado**.

### 11.4 Testes por categoria

**11.4.1 `packages/shared/test/unit/catalog-adapter.test.ts` (novo)**
- Schema v5 com fallback v4
- Merge base + overlay staging: deep merge correto
- Catálogo malformado: erro explícito
- `tenants.{id}.tracking.ga4.measurementIdEnvVar` resolvido corretamente

**11.4.2 `packages/shared/test/unit/secrets-store-wrapper.test.ts` (novo)**
- `await env.X.get()` (Secrets Store binding) funciona
- Fallback para `env.X` string funciona quando binding ausente
- Erro explícito se nenhum dos dois existe
- Cache local

**11.4.3 `packages/shared/test/unit/cross-tenant-isolation.test.ts` (novo) — TESTE MAIS IMPORTANTE**
- Mock catálogo com 2 tenants (decole + superare-test)
- Evento com `tenant_id="decole"` resolve credentials DECOLE, NUNCA SUPERARE
- KV keys, D1 inserts, Brevo API calls, sGTM endpoint, GA4 measurement — TODOS respeitam tenant_id
- Tentativa de spoofing: payload com tenant_id="superare" mas hostname=decolesuacarreiraesg → resolve para decole (hostname wins)
- Tentativa: tenant_id desconhecido → rejeitado

**11.4.4 `workers/funnel-dispatcher/test/snapshot/emit-tracking-payload.test.ts` (novo)**
- Golden master: snapshot do payload exato que `emit_tracking` gera HOJE para cada combinação (GENERATE_LEAD, BEGIN_CHECKOUT, PURCHASE_APPROVED) × (DECOLE_ESG_MENTORIA, DECOLE_PLANOVOO)
- Refactor da Fase 2 deve preservar payload exato (campo a campo)
- Catch para regressão sutil

**11.4.5 `workers/dashboard-sync/test/unit/sync-runner.test.ts` (novo) — primeiro teste DESTE WORKER**
- Setup mínimo de test harness
- Mock catálogo com 2 tenants × 2 produtos
- `syncGa4(tenant)` é chamado uma vez por tenant
- `?tenant=unknown` retorna 400

**11.4.6 Atualização de mocks existentes**
- Handlers Brevo: mocks migram `env.BREVO_API_KEY` → `ctx.credentials.brevoApiKey`
- Handlers de tracking: leituras globais → `tenants.{id}.tracking`
- Handlers de n8n: `env.N8N_WEBHOOK_URL` → `integrations.n8n.webhookUrlEnv`
- api-hotmart-ingress: mock com 2 tenants, valida que token errado de tenant A não autentica tenant B
- api-funnel-ingress: mock com 2 tenants, valida que origin de tenant A não passa CORS de tenant B

**11.4.7 E2E automatizado em CI**
- GitHub Action novo: `pr-e2e-multitenant.yml`
- Sobe `wrangler dev` local em cada worker
- Envia eventos de teste para cada produto
- Roda em cada PR — bloqueia merge se vermelho

### 11.5 Política operacional

- **Nenhum slice da Fase 2 começa sem Fase 0.5 verde.** Gate, não recomendação.
- **Cada refactor da Fase 2 deve passar pelo golden master** sem mudanças não-whitelistadas.
- **Cobertura de cross-tenant isolation só é considerada completa quando passa para os 3 cenários:** prod-only, prod+staging, multi-tenant
- **dashboard-sync ganha test suite primeiro, refactor depois** (2.11D.0 = adicionar testes; 2.11D.2 = refactor com proteção).
