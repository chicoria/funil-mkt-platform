# RUNBOOK — Onboarding de Novo Tenant

> **Versão:** 1.0 — criado em slice 2.11B.5 (2026-05-19)
> **Audiência:** operador da plataforma `funil-mkt-platform`
> **Pré-requisito:** plataforma multi-tenant completamente deployada (Fase 3 concluída)
> **Tempo estimado:** 2–4 horas (excluindo propagação DNS e aprovação GTM)

---

## Visão geral

Onboarding de um novo tenant na `funil-mkt-platform` envolve **8 frentes** independentes (algumas paralelas):

| # | Frente | Quem faz | Bloqueante para? |
|---|---|---|---|
| 1 | DNS: `sgtm.{tenant_domain}` CNAME | Tenant / operador | Frente 3 (sGTM smoke) |
| 2 | Catálogo: `tenants.{id}` em `products.catalog.json` | Operador | Frentes 4, 5, 6 |
| 3 | sGTM: lookup tables + publish workspace | Operador | Frente 8 (smoke) |
| 4 | Secrets Store workers: todos os secrets `_TENANT` | Operador | Frente 5 |
| 5 | Workers wrangler.toml: bindings + redeploy | Operador | Frente 8 (smoke) |
| 6 | CF Pages secret: `ADMIN_SECRET_{TENANT}` + redeploy | Operador | Frente 8 (smoke) |
| 7 | Cloud Run domain mapping: `sgtm.{tenant_domain}` | Operador | Frente 3 |
| 8 | Smoke checklist executável | Operador | — |

**Exemplo usado neste runbook:** tenant `superare` com domínio `superare.com.br`.

---

## IDs de referência (infraestrutura existente)

| Recurso | ID / Valor |
|---|---|
| Cloudflare Secrets Store | `default_secrets_store` (ID `23bdc9c2e8ca470d82352c53ec8d2e67`) |
| GCP Project | `gtm-k6q4h6br-ndq3n` |
| GTM Account | `6266094107` |
| GTM Container server-side | `GTM-K6Q4H6BR` (containerId `241313282`) |
| Cloud Run service (prod) | `server-side-tagging` em `us-central1` |
| Cloud Run service (preview) | `server-side-tagging-preview` em `us-central1` |
| GCP Service Account | `acesso-api@gtm-k6q4h6br-ndq3n.iam.gserviceaccount.com` |
| SA credentials local | `~/secrets/decole/gtm-k6q4h6br-ndq3n-7525dc924517.json` |
| CF Pages project | `mkt-dashboard` |
| Repositório plataforma | `/Users/chicoria/git/funil-mkt-platform` |
| Repositório dashboard | `/Users/chicoria/git/mkt-dashboard` |

---

## Frente 1 — DNS: `sgtm.{tenant_domain}` CNAME

**Objetivo:** o sGTM compartilhado responde ao domínio do tenant (first-party cookies).

O DNS do tenant está fora do controle do operador — esta etapa requer ação do tenant.

### Instrução ao tenant

```
Criar registro DNS:

Tipo:  CNAME
Host:  sgtm
Valor: ghs.googlehosted.com.
TTL:   300 (ou mínimo disponível)

Resultado: sgtm.superare.com.br → ghs.googlehosted.com.
```

### Verificar propagação (operador)

```bash
# Aguardar propagação (pode levar até 48h; normalmente < 30min)
dig +short sgtm.superare.com.br CNAME
# Esperado: ghs.googlehosted.com.

# Verificar que resolve
dig +short sgtm.superare.com.br
# Esperado: IPs do Google (ex: 216.239.x.x)
```

**Nota:** a frente 7 (domain mapping no Cloud Run) deve ser concluída antes do smoke final. O CNAME pode ser criado antes do domain mapping — o domínio ficará pendente de SSL até o mapping ser configurado.

---

## Frente 2 — Catálogo: `tenants.{id}` em `products.catalog.json`

**Objetivo:** plataforma reconhece o tenant em runtime (workers, dashboard, links-redirect).

Arquivo: `config/products.catalog.json`

### Estrutura mínima para novo tenant

```jsonc
{
  "schemaVersion": 5,
  "tenants": {
    // ... tenants existentes ...

    "superare": {
      "name": "SUPERARE",
      "domains": [
        "api.superare.com.br",
        "links.superare.com.br",
        "superare.com.br"
      ],
      "allowedOrigins": ["https://superare.com.br"],
      "credentials": {
        "brevo_api_key_env": "BREVO_API_KEY_SUPERARE",
        "hotmart_token_env": "HOTMART_WEBHOOK_TOKEN_SUPERARE",
        "replyToEmail": "contato@superare.com.br"
      },
      "tracking": {
        "gtm": { "containerPublicId": "GTM-XXXXXXXX" },           // ID do container GTM web do tenant
        "sgtm": { "endpointEnvVar": "SGTM_ENDPOINT_URL_SUPERARE" },
        "ga4": {
          "measurementId": "G-XXXXXXXXXX",                         // Measurement ID GA4 do tenant
          "measurementIdEnvVar": "GA4_MEASUREMENT_ID_SUPERARE",
          "apiSecretEnvVar": "GA4_API_SECRET_SUPERARE"
        },
        "metaCapi": { "accessTokenEnv": "META_CAPI_ACCESS_TOKEN_SUPERARE" }
      },
      "integrations": {
        "brevo": {
          "baseUrl": "https://api.brevo.com/v3"
        }
      },
      "dashboard": {
        "ga4": {
          "propertyIdEnv": "GA4_PROPERTY_ID_SUPERARE",
          "serviceAccountKeyEnv": "GA4_SERVICE_ACCOUNT_KEY_SUPERARE"
        },
        "metaAds": {
          "accessTokenEnv": "META_ACCESS_TOKEN_SUPERARE"
        }
      },
      "links": {
        "linksDomain": "links.superare.com.br",
        "routes": [
          // Adicionar rotas conforme produtos do tenant
          // { "path": "/produto-x/checkout", "type": "checkout", "productCode": "SUPERARE_PRODUTO_X" }
        ],
        "contacts": {
          // "whatsapp": { "type": "whatsapp", "number": "...", "defaultText": "..." }
        }
      },
      "products": {
        // Adicionar produtos conforme catálogo do tenant
        // "SUPERARE_PRODUTO_X": {
        //   "hotmart": { "productId": "...", "checkoutCode": "...", "urlSlugs": ["produto-x"] },
        //   "tracking": {
        //     "productCode": "SUPERARE_PRODUTO_X",
        //     "metaPixel": { "pixelIdEnvVar": "META_PIXEL_ID_SUPERARE_PRODUTO_X", "pixelId": "..." },
        //     "differentiation": { "produto": "SUPERARE_PRODUTO_X", "product_code": "SUPERARE_PRODUTO_X" }
        //   },
        //   "dashboard": { "metaAds": { "adAccountIdEnv": "META_AD_ACCOUNT_ID_SUPERARE_PRODUTO_X" } },
        //   "links": { "checkoutBaseUrl": "https://pay.hotmart.com/XXXXXXXXXX?off=..." }
        // }
      }
    }
  }
}
```

### Critério de aceite

```bash
cd /Users/chicoria/git/funil-mkt-platform

# Verificar que o tenant está no catálogo
node -e "const c = require('./config/products.catalog.json'); console.log(Object.keys(c.tenants))"
# Esperado: ["decole", "superare"] (ou outro tenant já existente + superare)

# Verificar que catálogo é JSON válido
node -e "require('./config/products.catalog.json')" && echo "JSON válido"
# Esperado: JSON válido
```

**Commit do catálogo:**

```bash
cd /Users/chicoria/git/funil-mkt-platform
git add config/products.catalog.json
git commit -m "feat(catalog): adicionar tenant superare (schema v5)"
```

---

## Frente 3 — sGTM: lookup tables + publish workspace

**Objetivo:** container sGTM roteia eventos do tenant para a propriedade GA4 e pixel Meta corretos.

### 3.1 Criar workspace de trabalho

Usar script existente ou Tag Manager API diretamente.

```bash
# Autenticar SA
export GOOGLE_APPLICATION_CREDENTIALS=~/secrets/decole/gtm-k6q4h6br-ndq3n-7525dc924517.json

# Criar workspace (via API ou UI GTM)
# Account: 6266094107 | Container: 241313282
# Nome sugerido: "onboard-superare-YYYY-MM-DD"
```

Via UI GTM: https://tagmanager.google.com/#/container/6266094107/workspaces

### 3.2 Adicionar entradas nas lookup tables

Em cada lookup table, adicionar linha para o tenant `superare`:

| Lookup Table | Input | Output |
|---|---|---|
| `LT - Tenant ID by Host` | `sgtm.superare.com.br` | `superare` |
| `LT - GA4 Measurement ID by Tenant` | `superare` | `G-XXXXXXXXXX` (measurement ID real) |
| `LT - Meta CAPI Token by Tenant` | `superare` | `{{META_CAPI_ACCESS_TOKEN_SUPERARE}}` (ou valor hardcoded temporário) |
| `LT - Meta Pixel ID by Tenant/Product` | `superare_SUPERARE_PRODUTO_X` | `PIXEL_ID_AQUI` (pixel ID real) |
| `LT - Meta Test Event Code by Tenant/Product` | `superare_SUPERARE_PRODUTO_X` | `TEST12345` (code para smoke) |

**Chave da lookup tenant+produto:** concatenar `{tenant_id}_{product_code}` (ex: `superare_SUPERARE_PRODUTO_X`).

### 3.3 Quick preview (validar sem publicar)

```bash
# Via API — verificar que workspace compila sem erro
node scripts/gtm-publish-workspace-24.mjs --check-only
# Ou criar script análogo para o novo workspace
# Esperado: WORKSPACE_COMPILATION_STATE_OK, sem compilerError
```

Via UI GTM: botão "Preview" → confirmar que container carrega sem erros.

### 3.4 Publicar workspace

```bash
# Criar versão + publicar (adaptar script para novo workspace ID)
# scripts/gtm-publish-workspace-24.mjs foi criado em 2.11B.4 — reutilizar ou adaptar
node scripts/gtm-publish-workspace-24.mjs
# Esperado: versionId impresso, sem compilerError

# O workspace é deletado automaticamente após publish — comportamento esperado (GTM padrão)
```

**Registrar:** versionId publicado + data para referência de rollback.

### 3.5 Rollback do workspace GTM

Se necessário reverter, via UI GTM: Container > Versions > selecionar versão anterior > Publish.

---

## Frente 4 — Secrets Store workers: secrets `_SUPERARE`

**Objetivo:** workers acessam credenciais do tenant via Cloudflare Secrets Store.

Store: `default_secrets_store` (ID `23bdc9c2e8ca470d82352c53ec8d2e67`)

### 4.1 Identificar secrets necessários

**Por tenant (obrigatórios para todos os workers):**

| Secret name (lowercase) | Binding name (UPPER) | Descrição |
|---|---|---|
| `brevo_api_key_superare` | `BREVO_API_KEY_SUPERARE` | API key Brevo do tenant |
| `hotmart_webhook_token_superare` | `HOTMART_WEBHOOK_TOKEN_SUPERARE` | Token webhook Hotmart |
| `sgtm_endpoint_url_superare` | `SGTM_ENDPOINT_URL_SUPERARE` | URL do sGTM: `https://sgtm.superare.com.br` |
| `ga4_measurement_id_superare` | `GA4_MEASUREMENT_ID_SUPERARE` | GA4 Measurement ID |
| `ga4_api_secret_superare` | `GA4_API_SECRET_SUPERARE` | GA4 API Secret |
| `meta_capi_access_token_superare` | `META_CAPI_ACCESS_TOKEN_SUPERARE` | Meta CAPI Access Token |
| `ga4_service_account_key_superare` | `GA4_SERVICE_ACCOUNT_KEY_SUPERARE` | JSON da SA GCP (para dashboard-sync) |
| `ga4_property_id_superare` | `GA4_PROPERTY_ID_SUPERARE` | GA4 Property ID (para dashboard-sync) |
| `meta_access_token_superare` | `META_ACCESS_TOKEN_SUPERARE` | Meta Ads Access Token (para dashboard-sync) |

**Por produto (um por produto do tenant):**

| Secret name | Binding name | Descrição |
|---|---|---|
| `meta_pixel_id_superare_produto_x` | `META_PIXEL_ID_SUPERARE_PRODUTO_X` | Meta Pixel ID por produto |
| `meta_ad_account_id_superare_produto_x` | `META_AD_ACCOUNT_ID_SUPERARE_PRODUTO_X` | Meta Ad Account ID por produto |

**Opcionais (apenas se tenant usa a integração):**

| Secret name | Binding name | Quando usar |
|---|---|---|
| `planovoo_api_base_url_superare` | `PLANOVOO_API_BASE_URL_SUPERARE` | Apenas se tenant tem integração Plano de Voo |
| `planovoo_hook_secret_superare` | `PLANOVOO_HOOK_SECRET_SUPERARE` | Idem |

### 4.2 Criar secrets via API

```bash
# Variáveis de ambiente necessárias
export CF_API_TOKEN="<token com Secrets Store:Edit>"
export CF_ACCOUNT_ID="<cloudflare account id>"
export SECRETS_STORE_ID="23bdc9c2e8ca470d82352c53ec8d2e67"

# Criar secret individual (repetir para cada secret)
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/secrets_store/stores/${SECRETS_STORE_ID}/secrets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '[{"name": "brevo_api_key_superare", "value": "VALOR_REAL_AQUI", "scopes": ["workers"]}]'

# Verificar secrets criados
curl -s \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/secrets_store/stores/${SECRETS_STORE_ID}/secrets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  | jq '.result[] | select(.name | contains("superare")) | .name'
# Esperado: lista de todos os secrets _SUPERARE criados
```

**Alternativa via wrangler (se disponível):**

```bash
# wrangler secrets-store ainda em beta — verificar disponibilidade
wrangler secrets-store secret put --store-id 23bdc9c2e8ca470d82352c53ec8d2e67 \
  brevo_api_key_superare
# Prompt para valor
```

### 4.3 Registrar em `.env.local`

```bash
# Adicionar ao .env.local do repositório (para referência local — NÃO commitar)
cat >> /Users/chicoria/git/funil-mkt-platform/.env.local << 'EOF'
# SUPERARE — adicionado em YYYY-MM-DD
BREVO_API_KEY_SUPERARE=<valor>
HOTMART_WEBHOOK_TOKEN_SUPERARE=<valor>
SGTM_ENDPOINT_URL_SUPERARE=https://sgtm.superare.com.br
GA4_MEASUREMENT_ID_SUPERARE=G-XXXXXXXXXX
GA4_API_SECRET_SUPERARE=<valor>
META_CAPI_ACCESS_TOKEN_SUPERARE=<valor>
GA4_SERVICE_ACCOUNT_KEY_SUPERARE=<json completo>
GA4_PROPERTY_ID_SUPERARE=<valor>
META_ACCESS_TOKEN_SUPERARE=<valor>
META_PIXEL_ID_SUPERARE_PRODUTO_X=<valor>
META_AD_ACCOUNT_ID_SUPERARE_PRODUTO_X=<valor>
EOF
```

---

## Frente 5 — Workers wrangler.toml: bindings + redeploy

**Objetivo:** workers do tenant SUPERARE acessam seus secrets via binding `[[secrets_store_secrets]]`.

Workers afetados: `funnel-dispatcher`, `api-hotmart-ingress`, `api-funnel-ingress`, `dashboard-sync`, `links-redirect`.

### 5.1 Adicionar bindings em cada wrangler.toml

Para cada worker que o tenant usa, adicionar ao `wrangler.toml`:

```toml
# Exemplo: workers/funnel-dispatcher/wrangler.toml
# Adicionar após os bindings _DECOLE existentes:

# ── SUPERARE secrets ──
[[secrets_store_secrets]]
binding = "BREVO_API_KEY_SUPERARE"
store_id = "23bdc9c2e8ca470d82352c53ec8d2e67"
secret_name = "brevo_api_key_superare"

[[secrets_store_secrets]]
binding = "HOTMART_WEBHOOK_TOKEN_SUPERARE"
store_id = "23bdc9c2e8ca470d82352c53ec8d2e67"
secret_name = "hotmart_webhook_token_superare"

[[secrets_store_secrets]]
binding = "SGTM_ENDPOINT_URL_SUPERARE"
store_id = "23bdc9c2e8ca470d82352c53ec8d2e67"
secret_name = "sgtm_endpoint_url_superare"

[[secrets_store_secrets]]
binding = "GA4_MEASUREMENT_ID_SUPERARE"
store_id = "23bdc9c2e8ca470d82352c53ec8d2e67"
secret_name = "ga4_measurement_id_superare"

[[secrets_store_secrets]]
binding = "GA4_API_SECRET_SUPERARE"
store_id = "23bdc9c2e8ca470d82352c53ec8d2e67"
secret_name = "ga4_api_secret_superare"

[[secrets_store_secrets]]
binding = "META_CAPI_ACCESS_TOKEN_SUPERARE"
store_id = "23bdc9c2e8ca470d82352c53ec8d2e67"
secret_name = "meta_capi_access_token_superare"

[[secrets_store_secrets]]
binding = "META_PIXEL_ID_SUPERARE_PRODUTO_X"
store_id = "23bdc9c2e8ca470d82352c53ec8d2e67"
secret_name = "meta_pixel_id_superare_produto_x"
```

**Repetir para `api-hotmart-ingress`, `api-funnel-ingress`.** Para `dashboard-sync` e `links-redirect`, adicionar apenas os secrets relevantes (ver catálogo do tenant).

`dashboard-sync` também precisa dos secrets de dashboard:

```toml
# workers/dashboard-sync/wrangler.toml — adicionar:
[[secrets_store_secrets]]
binding = "GA4_SERVICE_ACCOUNT_KEY_SUPERARE"
store_id = "23bdc9c2e8ca470d82352c53ec8d2e67"
secret_name = "ga4_service_account_key_superare"

[[secrets_store_secrets]]
binding = "GA4_PROPERTY_ID_SUPERARE"
store_id = "23bdc9c2e8ca470d82352c53ec8d2e67"
secret_name = "ga4_property_id_superare"

[[secrets_store_secrets]]
binding = "META_ACCESS_TOKEN_SUPERARE"
store_id = "23bdc9c2e8ca470d82352c53ec8d2e67"
secret_name = "meta_access_token_superare"
```

### 5.2 Adicionar rotas do tenant em api-hotmart-ingress (se necessário)

Se o worker usa `routes` fixas por tenant (padrão atual), adicionar ao `wrangler.toml`:

```toml
# workers/api-hotmart-ingress/wrangler.toml — adicionar rotas do tenant
[[routes]]
pattern = "api.superare.com.br/webhooks/v1/*"
zone_name = "superare.com.br"
```

Verificar se o tenant usa o mesmo padrão de routing ou se o catálogo resolve automaticamente via `tenants.{id}.domains`.

### 5.3 Redeploy dos workers afetados

```bash
cd /Users/chicoria/git/funil-mkt-platform

# Commit das mudanças nos wrangler.toml
git add workers/*/wrangler.toml
git commit -m "feat(workers): Secrets Store bindings para tenant superare"

# Redeploy (usando CLOUDFLARE_API_TOKEN do .env.local se wrangler OAuth expirar)
export CLOUDFLARE_API_TOKEN="$(grep CLOUDFLARE_API_TOKEN .env.local | cut -d= -f2)"

npx wrangler deploy --config workers/funnel-dispatcher/wrangler.toml
npx wrangler deploy --config workers/api-hotmart-ingress/wrangler.toml
npx wrangler deploy --config workers/api-funnel-ingress/wrangler.toml
npx wrangler deploy --config workers/dashboard-sync/wrangler.toml
npx wrangler deploy --config workers/links-redirect/wrangler.toml
```

**Verificar deploy:**

```bash
# Verificar versão deployada para cada worker
npx wrangler deployments list --name decole-funnel-dispatcher | head -5
# Esperado: nova versão com timestamp recente
```

---

## Frente 6 — CF Pages secret: `ADMIN_SECRET_{TENANT}` + redeploy

**Objetivo:** admin do tenant SUPERARE consegue fazer login no `mkt-dashboard`.

> ⚠️ `ADMIN_SECRET_{TENANT}` é um **Cloudflare Pages secret** — NÃO é o Secrets Store de Workers. Criado via `wrangler pages secret put`.

### 6.1 Criar Pages secret

```bash
# Gerar senha segura para o tenant
SENHA=$(openssl rand -base64 24)
echo "Senha SUPERARE: $SENHA"  # Anotar antes de continuar

# Criar Pages secret
echo "$SENHA" | npx wrangler pages secret put ADMIN_SECRET_SUPERARE \
  --project-name mkt-dashboard

# Verificar que o secret aparece na lista
npx wrangler pages secret list --project-name mkt-dashboard
# Esperado: ADMIN_SECRET_SUPERARE na lista
```

### 6.2 Salvar em `.env.local`

```bash
echo "ADMIN_SECRET_SUPERARE=$SENHA" >> /Users/chicoria/git/mkt-dashboard/.env.local
```

### 6.3 Redeploy do mkt-dashboard

O secret só fica disponível após redeploy (Cloudflare Pages não aplica secrets em runtime sem novo deploy).

```bash
cd /Users/chicoria/git/mkt-dashboard

# Build + deploy
npx @cloudflare/next-on-pages
npx wrangler pages deploy .vercel/output/static --project-name mkt-dashboard

# Verificar URL do deploy
# Esperado: URL do projeto mkt-dashboard com novo deployment
```

---

## Frente 7 — Cloud Run domain mapping: `sgtm.{tenant_domain}`

**Objetivo:** Cloud Run aceita requests no domínio `sgtm.superare.com.br` e emite SSL gerenciado.

### 7.1 Adicionar domain mapping via gcloud

```bash
# Autenticar
export GOOGLE_APPLICATION_CREDENTIALS=~/secrets/decole/gtm-k6q4h6br-ndq3n-7525dc924517.json
gcloud auth activate-service-account --key-file="$GOOGLE_APPLICATION_CREDENTIALS"
gcloud config set project gtm-k6q4h6br-ndq3n

# Adicionar domain mapping
gcloud run domain-mappings create \
  --service server-side-tagging \
  --domain sgtm.superare.com.br \
  --region us-central1

# Verificar status (Ready + CertificateProvisioned podem levar 15-30min)
gcloud run domain-mappings describe \
  --domain sgtm.superare.com.br \
  --region us-central1
# Esperado (após propagação):
#   Ready: True
#   CertificateProvisioned: True
#   DomainRoutable: True
```

### 7.2 Alternativa via Cloud Run Admin API

```bash
# Para automatização futura (ver seção 10 do satélite 2.11B)
curl -s -X POST \
  "https://run.googleapis.com/apis/serving.knative.dev/v1/namespaces/gtm-k6q4h6br-ndq3n/domainmappings" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "apiVersion": "serving.knative.dev/v1",
    "kind": "DomainMapping",
    "metadata": { "name": "sgtm.superare.com.br", "namespace": "gtm-k6q4h6br-ndq3n" },
    "spec": { "routeName": "server-side-tagging" }
  }'
```

**Nota:** O CNAME DNS (Frente 1) e o domain mapping (Frente 7) podem ser feitos em paralelo. O SSL só fica pronto após AMBOS estarem configurados. Aguardar 15-30 minutos após a propagação do DNS.

---

## Frente 8 — Smoke checklist executável

Executar após todas as frentes anteriores concluídas. Substituir placeholders pelos valores reais do tenant.

### 8.1 DNS e sGTM

```bash
# DNS resolução correta
dig +short sgtm.superare.com.br CNAME
# Esperado: ghs.googlehosted.com.

dig +short sgtm.superare.com.br
# Esperado: IPs do Google

# sGTM respondendo (HTTP 400 sem payload é o comportamento correto)
curl -s -o /dev/null -w "%{http_code}" \
  https://sgtm.superare.com.br/g/collect
# Esperado: 400
```

### 8.2 Workers — tenant reconhecido no catálogo

```bash
cd /Users/chicoria/git/funil-mkt-platform

# Verificar tenant no catálogo
node -e "
const c = require('./config/products.catalog.json');
const t = c.tenants['superare'];
console.log('tenant:', t ? 'encontrado' : 'AUSENTE');
console.log('domains:', t?.domains);
console.log('credentials:', Object.keys(t?.credentials || {}));
"
# Esperado: tenant encontrado, domains com superare.com.br, credentials com brevo_api_key_env etc.
```

### 8.3 links-redirect — rotas do tenant

```bash
# Smoke: health check
curl -s -o /dev/null -w "%{http_code}" \
  https://links.superare.com.br/health
# Esperado: 200

# Smoke: rota de checkout
curl -s -o /dev/null -w "%{http_code}" \
  https://links.superare.com.br/produto-x/checkout
# Esperado: 302 (redirect para checkout URL configurada no catálogo)
```

### 8.4 api-hotmart-ingress — rejeita sem token (401)

```bash
# Smoke: request sem HMAC → 401 (não 500)
curl -s -o /dev/null -w "%{http_code}" \
  https://api.superare.com.br/webhooks/v1/hotmart/produto-x/event
# Esperado: 401
```

### 8.5 api-funnel-ingress — CORS do tenant

```bash
# Smoke: CORS origin válido → 204
curl -s -o /dev/null -w "%{http_code}" \
  -X OPTIONS \
  -H "Origin: https://superare.com.br" \
  -H "Access-Control-Request-Method: POST" \
  https://api.superare.com.br/funnel/event
# Esperado: 204

# Smoke: CORS origin inválido → 403
curl -s -o /dev/null -w "%{http_code}" \
  -X OPTIONS \
  -H "Origin: https://atacante.com" \
  -H "Access-Control-Request-Method: POST" \
  https://api.superare.com.br/funnel/event
# Esperado: 403
```

### 8.6 dashboard-sync — tenant reconhecido

```bash
# Smoke: ?tenant=superare → 200
curl -s -o /dev/null -w "%{http_code}" \
  "https://decole-dashboard-sync.chicoria.workers.dev/sync/status?tenant=superare"
# Esperado: 200

# Smoke: ?tenant=desconhecido → 400
curl -s -o /dev/null -w "%{http_code}" \
  "https://decole-dashboard-sync.chicoria.workers.dev/sync/status?tenant=tenant_invalido_xyz"
# Esperado: 400
```

### 8.7 mkt-dashboard — login do tenant

```bash
# Smoke: login com tenant=superare + senha correta → cookie de sessão (redirect para /dashboard)
curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"tenant": "superare", "password": "SENHA_DEFINIDA_NA_FRENTE_6"}' \
  https://mkt-dashboard.pages.dev/api/auth
# Esperado: 200 ou 302 (com Set-Cookie)
```

### 8.8 Isolamento cross-tenant

```bash
cd /Users/chicoria/git/funil-mkt-platform

# Verificar que nenhum hardcode de tenant novo vazou para src/
grep -rE "superare" workers/*/src/ packages/*/src/
# Esperado: 0 matches (tenant vive apenas no catálogo + secrets)
```

---

## Checklist de conclusão

```
[ ] Frente 1: dig +short sgtm.superare.com.br CNAME → ghs.googlehosted.com.
[ ] Frente 2: tenant "superare" em products.catalog.json, JSON válido
[ ] Frente 3: nova versão GTM publicada (anotar versionId: ___)
[ ] Frente 4: secrets _SUPERARE criados no Secrets Store (verificar via API)
[ ] Frente 5: workers redeployados com bindings _SUPERARE
[ ] Frente 6: ADMIN_SECRET_SUPERARE criado em CF Pages + mkt-dashboard redeployado
[ ] Frente 7: Cloud Run domain mapping sgtm.superare.com.br Ready=True
[ ] Frente 8.1: sgtm smoke → HTTP 400 ✅
[ ] Frente 8.2: catálogo smoke → tenant encontrado ✅
[ ] Frente 8.3: links smoke → health 200 ✅
[ ] Frente 8.4: hotmart ingress smoke → 401 sem token ✅
[ ] Frente 8.5: funnel ingress CORS smoke → 204 origin válido, 403 inválido ✅
[ ] Frente 8.6: dashboard-sync smoke → 200 superare, 400 inválido ✅
[ ] Frente 8.7: dashboard login smoke → 200/302 com cookie ✅
[ ] Frente 8.8: isolamento → 0 matches grep src/ ✅
```

---

## Convenção de naming de secrets (referência rápida)

```
# Por tenant (compartilhado entre produtos):
{SECRET}_{TENANT}
Ex: BREVO_API_KEY_SUPERARE

# Por tenant + produto:
{SECRET}_{TENANT}_{PRODUCT}
Ex: META_PIXEL_ID_SUPERARE_PRODUTO_X

# Staging: adicionar sufixo _STG ao secret name no Secrets Store
Ex: brevo_api_key_superare_stg (binding name: BREVO_API_KEY_SUPERARE_STG)

# CF Pages (não Secrets Store):
ADMIN_SECRET_{TENANT_UPPERCASE}
Ex: ADMIN_SECRET_SUPERARE
```

---

## Rollback de emergência

Se o onboarding causar regressão para tenants existentes:

```bash
# 1. Reverter wrangler.toml dos workers
git revert HEAD  # ou git revert <commit-dos-bindings>

# 2. Redeploy dos workers (reverte para versão anterior)
export CLOUDFLARE_API_TOKEN="$(grep CLOUDFLARE_API_TOKEN .env.local | cut -d= -f2)"
npx wrangler deploy --config workers/funnel-dispatcher/wrangler.toml
# Repetir para cada worker afetado

# 3. Reverter catálogo se necessário
git revert <commit-catalogo>

# 4. Reverter versão GTM (via UI GTM ou API)
# Container > Versions > selecionar versão anterior > Publish

# 5. Verificar que tenants existentes (DECOLE) continuam funcionando
curl -s https://sgtm.decolesuacarreiraesg.com.br/g/collect -o /dev/null -w "%{http_code}"
# Esperado: 400 (sGTM ativo)

curl -s https://decole-dashboard-sync.chicoria.workers.dev/sync/status?tenant=decole \
  -o /dev/null -w "%{http_code}"
# Esperado: 200
```

---

## Referências

- Satélite 2.11B: [`plans/PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md`](./PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md) seção 6 e 10
- Satélite 2.11A: [`plans/PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](./PLANO-MULTI-TENANT-SECRETS-CONFIG.md) seção 2 (naming), 5 (workers), 10.2 (Secrets Store)
- Satélite 2.11E: [`plans/PLANO-MKT-DASHBOARD-MULTI-TENANT.md`](./PLANO-MKT-DASHBOARD-MULTI-TENANT.md) seção 5.1 (ADMIN_SECRET CF Pages)
- Slice 2.11A.2: [`plans/slices/2.11A/2-populate-secrets-bindings.md`](./slices/2.11A/2-populate-secrets-bindings.md) — tabela completa de secrets existentes para DECOLE
- Slice 2.11B.4: [`plans/slices/2.11B/4-publish-sgtm-prod.md`](./slices/2.11B/4-publish-sgtm-prod.md) — script publish GTM + IDs
- Status atual: [`plans/STATUS-2.11.md`](./STATUS-2.11.md)
