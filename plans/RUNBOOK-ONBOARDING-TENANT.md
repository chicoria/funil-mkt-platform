# RUNBOOK — Onboarding de Novo Tenant

> **Versão:** 2.0 — v1.0 criada em slice 2.11B.5 (2026-05-19); v2.0
> revisada em 2026-10-08 após o **primeiro onboarding real de tenant**
> (`product-engineer`, theproductengineer.net) — v1.0 só tinha sido
> validada contra um tenant fake (`superare-test`). V2.0 adiciona 3
> frentes que faltavam inteiramente (Web container, Brevo, Turnstile) e
> corrige gotchas descobertos na execução real. Ver
> `plans/onboardings/product-engineer-2026-10-08.md` pra execução
> completa com os erros reais encontrados.
> **Audiência:** operador da plataforma `funil-mkt-platform`
> **Pré-requisito:** plataforma multi-tenant completamente deployada (Fase 3 concluída)
> **Tempo estimado:** 3–5 horas (excluindo propagação DNS e aprovação GTM) — revisado pra cima vs. v1.0 (2-4h), as 3 frentes novas + os gotchas levam tempo real.

---

## Visão geral

Onboarding de um novo tenant na `funil-mkt-platform` envolve **11 frentes** (algumas paralelas, 3 novas na v2.0):

| # | Frente | Quem faz | Bloqueante para? |
|---|---|---|---|
| 1 | DNS: `sgtm.{tenant_domain}` CNAME + placeholder pra API subdomain | Tenant / operador | Frente 3b (sGTM smoke), Frente 5 |
| 2 | Catálogo: `tenants.{id}` em `products.catalog.json` | Operador | Frentes 2b, 4, 5, 6 |
| 2b | **(nova)** Brevo: atributos de funil, lista, template DOI (com tag `optin`) | Operador | Frente 5 funcionar de ponta a ponta |
| 3 | sGTM: lookup tables + publish workspace (server container) | Operador | Frente 8 (smoke) |
| 3b | **(nova, padrão de plataforma)** Web container: GA4 Configuration + trigger/tag genéricos de evento | Operador | GA4 receber dados — **sem isso, zero dados chegam, mesmo com tudo mais certo** |
| 4 | Secrets Store workers: todos os secrets `_TENANT` | Operador | Frente 5 |
| 5 | Workers wrangler.toml: bindings + rota + redeploy | Operador | Frente 8 (smoke) |
| 6 | CF Pages secret: `ADMIN_SECRET_{TENANT}` + redeploy | Operador | Frente 8 (smoke) |
| 7 | Cloud Run domain mapping: `sgtm.{tenant_domain}` | Operador | Frente 3, Frente 3b (transport_url) |
| 8 | Smoke checklist executável | Operador | — |
| 9 | **(nova, opcional)** Turnstile: widget + validação server-side | Operador | — (proteção contra bot, não bloqueia o fluxo básico) |

**Exemplo usado neste runbook (v1.0):** tenant `superare` (fake, nunca onboardado de verdade) com domínio `superare.com.br`.
**Exemplo real (v2.0):** tenant `product-engineer` com domínio `theproductengineer.net`, 2026-10-08 — primeiro onboarding de produção completo, ver link acima.

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

## Frente 2b — Brevo: atributos de funil, lista, template DOI

> **Nova na v2.0** — v1.0 não mencionava isso; descoberto que é
> pré-requisito real porque o tenant `superare-test` (fake) nunca testou
> o fluxo de ponta a ponta com um e-mail de verdade.

**Objetivo:** a conta Brevo do tenant tem tudo que o `funnel-dispatcher`
precisa pra rodar a chain de `GENERATE_LEAD` (atributos de contato,
lista de destino, template de e-mail DOI).

### 2b.1 — Atributos de contato de funil

```bash
# category é "normal", NÃO o tipo (text/date) — erro comum, dá
# "Invalid attribute category" se trocar a ordem
curl -s -X POST "https://api.brevo.com/v3/contacts/attributes/normal/{PREFIX}_FUNIL_STEPS" \
  -H "api-key: ${BREVO_API_KEY_SUPERARE}" -H "Content-Type: application/json" \
  -d '{"type": "text"}'

curl -s -X POST "https://api.brevo.com/v3/contacts/attributes/normal/{PREFIX}_FUNIL_LAST_STEP" \
  -H "api-key: ${BREVO_API_KEY_SUPERARE}" -H "Content-Type: application/json" \
  -d '{"type": "text"}'

curl -s -X POST "https://api.brevo.com/v3/contacts/attributes/normal/{PREFIX}_FUNIL_LAST_STEP_TIMESTAMP" \
  -H "api-key: ${BREVO_API_KEY_SUPERARE}" -H "Content-Type: application/json" \
  -d '{"type": "date"}'

# LEAD_ID não existe por padrão numa conta Brevo nova — criar também
curl -s -X POST "https://api.brevo.com/v3/contacts/attributes/normal/LEAD_ID" \
  -H "api-key: ${BREVO_API_KEY_SUPERARE}" -H "Content-Type: application/json" \
  -d '{"type": "text"}'
```

⚠️ **Limite de caracteres no nome do atributo:** `{PREFIX}_FUNIL_LAST_STEP_TIMESTAMP`
pode passar do limite se `{PREFIX}` (= `funnelPrefix` do catálogo) for
longo. A DECOLE usa prefixos curtos (`DECOLE_ESG`, `DECOLE_PLANOVOO`) que
nunca bateram no limite — um produto com nome mais longo
(`PRODUCT_ENGINEER_NEWSLETTER`, 27 chars) bateu, erro real
`"Attribute name exceeds char limit"`. Encurtar o `funnelPrefix` do
catálogo se necessário (ex: `PE_NEWSLETTER` em vez do nome completo do
produto) — **não precisa bater com o `productCode`**, são campos
diferentes.

### 2b.2 — Lista de precheckout

```bash
curl -s -X POST "https://api.brevo.com/v3/contacts/lists" \
  -H "api-key: ${BREVO_API_KEY_SUPERARE}" -H "Content-Type: application/json" \
  -d '{"name": "Leads Precheckout - Superare", "folderId": 1}'
# Retorna {"id": N} — esse N vai no catálogo em products.{code}.brevo.lists.precheckout.id
```

### 2b.3 — Template DOI

```bash
curl -s -X POST "https://api.brevo.com/v3/smtp/templates" \
  -H "api-key: ${BREVO_API_KEY_SUPERARE}" -H "Content-Type: application/json" \
  -d '{
    "templateName": "Superare - DOI v1",
    "subject": "Confirm your subscription",
    "sender": {"name": "Superare", "email": "hello@superare.com.br"},
    "htmlContent": "<html>...</html>",
    "isActive": true
  }'
```

⚠️ **`sender.email` precisa ser um sender já verificado nessa conta
Brevo** — checar antes com `GET /v3/senders`, senão dá `"Sender is
invalid / inactive"`.

⚠️ **O template precisa da tag `"optin"`** — confirmado empiricamente
(teste real: sem a tag, `send_brevo_doi` roda sem erro visível mas o
e-mail nunca sai e o contato fica com `listIds: []`; com a tag, o e-mail
sai, é entregue, e o contato recebe `listIds: [N]` +
`DOUBLE_OPT-IN: "1"` após confirmação). A Brevo não documenta isso de
forma clara publicamente — foi descoberto comparando com o template real
da DECOLE (`"tag": "optin"`) depois de um teste real falhar
silenciosamente. Setar a tag após criar o template:

```bash
curl -s -X PUT "https://api.brevo.com/v3/smtp/templates/{templateId}" \
  -H "api-key: ${BREVO_API_KEY_SUPERARE}" -H "Content-Type: application/json" \
  -d '{"tag": "optin"}'
```

### Critério de aceite 2b

```bash
curl -s "https://api.brevo.com/v3/smtp/templates/{templateId}" \
  -H "api-key: ${BREVO_API_KEY_SUPERARE}" | python3 -c "
import json,sys
d = json.load(sys.stdin)
assert d.get('tag') == 'optin', 'FALTA a tag optin!'
print('OK:', d.get('name'), '- tag:', d.get('tag'))
"
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

## Frente 3b — Web container: tag GA4 Configuration

> **Nova na v2.0 — a mais crítica das 3 frentes novas.** v1.0 não
> mencionava o container Web **em nenhum momento**. Resultado real: o
> tenant teve o snippet do GTM instalado no site, as lookup tables do
> sGTM configuradas, tudo "certo" — e **zero dados no GA4**, porque o
> container Web em si estava vazio (0 tags, 0 triggers). Confirmado via
> API antes da correção. Sem esta frente, nenhum dado chega no GA4,
> mesmo com as Frentes 1, 3 e 7 perfeitas.

**Objetivo:** o container Web do tenant (diferente do container
server-side da Frente 3 — são contas/containers totalmente separados)
tem uma tag que efetivamente dispara o evento GA4.

### 3b.1 — Identificar o container Web do tenant

O tenant precisa ter sua própria conta + container GTM Web (diferente da
conta server-side `6266094107` compartilhada). Confirmar
`GTM_ACCOUNT_ID_{TENANT}` / `GTM_CONTAINER_ID_{TENANT}` /
`GTM_WORKSPACE_ID_{TENANT}` antes de prosseguir — e que a service account
(`acesso-api@gtm-k6q4h6br-ndq3n.iam.gserviceaccount.com`) foi convidada
como Editor **nessa conta específica** (não herda da conta server-side).

### 3b.2 — Criar a tag GA4 Configuration

```bash
# POST accounts/{GTM_ACCOUNT_ID}/containers/{GTM_CONTAINER_ID}/workspaces/{WORKSPACE_ID}/tags
{
  "name": "GA4 Configuration - {tenant_domain}",
  "type": "googtag",
  "parameter": [
    {"type": "template", "key": "tagId", "value": "{GA4_MEASUREMENT_ID}"}
  ],
  "firingTriggerId": ["2147479553"]
}
```

`firingTriggerId: "2147479553"` é o ID reservado do trigger built-in
"Initialization - All Pages" — sempre disponível em qualquer container,
não precisa ser criado.

### 3b.3 — Adicionar `transport_url` (essencial — sem isso o sGTM é ignorado)

**Depois** de criar a tag (precisa do `tagId` retornado), fazer um PUT
adicionando um segundo parâmetro `configSettingsTable`:

```bash
# PUT no mesmo endpoint da tag (.../tags/{tagId}), corpo = tag completa
# + este parâmetro adicional na lista "parameter":
{
  "type": "list",
  "key": "configSettingsTable",
  "list": [
    {"type": "map", "map": [
      {"type": "template", "key": "parameter", "value": "transport_url"},
      {"type": "template", "key": "parameterValue", "value": "https://sgtm.{tenant_domain}"}
    ]},
    {"type": "map", "map": [
      {"type": "template", "key": "parameter", "value": "send_page_view"},
      {"type": "template", "key": "parameterValue", "value": "true"}
    ]}
  ]
}
```

⚠️ **Sem `transport_url`, os hits vão direto pro Google** — nunca
passam pelo sGTM, e toda a infra das Frentes 3 e 7 (lookup tables,
domain mapping no Cloud Run) fica sem efeito nenhum. Isso só foi pego
comparando com a tag de produção real da DECOLE
(`FB_CONVERSIONS_API-...-GA4_Config`) — a tag "óbvia"/documentada do GTM
não inclui isso por padrão.

### 3b.3b — Trigger + tag genéricos pra eventos customizados (OBRIGATÓRIO, padrão de plataforma)

> **Decisão de plataforma (2026-10-08):** configuração de GTM/GA4 é
> infraestrutura do `funil-mkt-platform`, não escolha por tenant — **todo
> tenant segue este mesmo padrão**, não cada um inventando sua própria
> forma de mandar eventos customizados (`generate_lead`, `cta_click`,
> etc.) pro GA4.

A tag GA4 Configuration (3b.2) só cobre `page_view` automático. Pra
qualquer evento customizado do dataLayer (`generate_lead`, `cta_click`,
futuros) chegar no GA4, **não criar uma tag dedicada por evento** —
replicar o padrão real que a DECOLE já usa em produção (descoberto
inspecionando a tag `FB_CONVERSIONS_API-...-GA4_Event`, que mesmo tendo
sido criada pelo template de integração Meta, cumpre esse papel genérico
de ponte pro GA4): **um trigger genérico + uma tag genérica**, cobrindo
todos os eventos de uma vez.

```bash
# Trigger: "All Custom Events" — dispara pra qualquer evento customizado
# que não comece com "gtm." (os eventos internos do próprio GTM)
POST .../workspaces/{id}/triggers
{
  "name": "All Custom Events",
  "type": "customEvent",
  "customEventFilter": [{
    "type": "matchRegex",
    "parameter": [
      {"type": "template", "key": "arg0", "value": "{{_event}}"},
      {"type": "template", "key": "arg1", "value": "^gtm\\..*"},
      {"type": "boolean", "key": "negate", "value": "true"}
    ]
  }]
}

# Tag: "GA4 Event - All Custom Events" — eventName dinâmico, repassa
# qualquer nome de evento do dataLayer direto pro GA4 sem mapeamento manual
POST .../workspaces/{id}/tags
{
  "name": "GA4 Event - All Custom Events",
  "type": "gaawe",
  "parameter": [
    {"type": "boolean", "key": "sendEcommerceData", "value": "false"},
    {"type": "template", "key": "eventName", "value": "{{Event}}"},
    {"type": "template", "key": "measurementIdOverride", "value": "{GA4_MEASUREMENT_ID}"}
  ],
  "firingTriggerId": ["{triggerId do passo anterior}"]
}
```

Isso cobre `generate_lead`, `cta_click`, e qualquer evento novo que o
site venha a disparar no futuro — **sem precisar voltar no GTM pra
criar tag nova a cada evento adicionado**. Parâmetros customizados por
evento (como a DECOLE faz pra `cta_click` com `cta_id`/`cta_label`/etc.
numa tag dedicada separada) são opcionais, só adicionar se o tenant
precisar de dimensões específicas além do nome do evento.

### 3b.4 — Publicar

```bash
# create_version + :publish, igual à Frente 3 (3.3/3.4), mas no
# container Web, não no server-side.
```

⚠️ **O workspace é recriado automaticamente após cada publish** (mesmo
comportamento da Frente 3) — se for fazer uma segunda mudança (ex:
adicionar o `transport_url` depois de já ter publicado a tag), listar os
workspaces de novo pra pegar o ID novo; tentar editar o workspace antigo
dá `"Workspace is already submitted"`.

### Critério de aceite 3b

```bash
# Via API, confirmar a tag existe com os 2 parâmetros
# GET .../workspaces/{id}/tags/{tagId} e conferir tagId + transport_url

# Ou via GA4 Realtime API (minutos após uma visita de teste no site):
curl -s -X POST "https://analyticsdata.googleapis.com/v1beta/properties/{GA4_PROPERTY_ID}:runRealtimeReport" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{"dimensions":[{"name":"eventName"}],"metrics":[{"name":"eventCount"}]}'
# Esperado: pelo menos 1 row depois de uma visita real ao site
```

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

### 7.0 Pré-requisito descoberto na v2.0: `gcloud` CLI + domínio verificado

Se `gcloud` não estiver instalado nesta máquina:

```bash
# Homebrew cask pode falhar com erro de cache interno (não relacionado ao
# gcloud) — nesse caso, instalar via tarball oficial direto:
# checar arquitetura primeiro — existe build -arm e -x86_64 separados
uname -m
curl -sO "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-{arm|x86_64}.tar.gz"
tar -xzf google-cloud-cli-darwin-*.tar.gz -C ~/
~/google-cloud-sdk/install.sh --quiet --usage-reporting=false --path-update=false --command-completion=false
export CLOUDSDK_PYTHON=$(which python3)  # usa o Python do sistema, pula o instalador bundlado que pede sudo
```

Antes do `domain-mappings create`, o domínio **raiz** do tenant precisa
estar verificado no Google Search Console:

```bash
gcloud domains verify {tenant_domain}   # domínio raiz, NÃO sgtm.{tenant_domain}
# Abre o browser — fluxo interativo, precisa ser feito pela conta Google
# do dono do domínio, não em modo não-interativo
```

⚠️ **Gotcha de identidade — o mais fácil de errar aqui:** a verificação
de domínio é associada à **conta Google usada no browser** durante
`gcloud domains verify`, não à identidade ativa do `gcloud` CLI. Se o
CLI estiver autenticado como a **service account** (uso normal pro
resto deste runbook — GTM, GA4, Secrets Store), ela **não vê** domínios
verificados pela conta pessoal do humano, mesmo que a verificação tenha
sido feita com sucesso. Sintoma: `gcloud run domain-mappings create`
continua dizendo `"You currently have no verified domains"` mesmo depois
de verificar. Fix:

```bash
# Login interativo com a conta pessoal (abre browser) — rodar você mesmo,
# não em modo não-interativo/headless, precisa confirmar no browser
gcloud auth login

# Com essa conta ativa, roda o domain-mappings create (frente 7.1)

# Depois, volta pra service account pro resto do runbook:
gcloud config set account acesso-api@gtm-k6q4h6br-ndq3n.iam.gserviceaccount.com
```

### 7.1 Adicionar domain mapping via gcloud

```bash
export CLOUDSDK_PYTHON=$(which python3)

# Adicionar domain mapping — NOTA: "gcloud run domain-mappings" (sem beta)
# é só pra "Cloud Run for Anthos" (GKE). Pra Cloud Run fully managed
# (nosso caso), o comando certo é "gcloud beta run domain-mappings".
# "gcloud run domain-mappings list/create" sem beta dá erro de argumento
# não reconhecido ou lista vazia silenciosa, não um erro óbvio.
gcloud components install beta --quiet  # se ainda não tiver o grupo beta

gcloud beta run domain-mappings create \
  --service server-side-tagging \
  --domain sgtm.superare.com.br \
  --region us-central1 --quiet

# Verificar status (Ready + CertificateProvisioned podem levar 15-30min)
gcloud beta run domain-mappings describe \
  --domain sgtm.superare.com.br \
  --region us-central1
# Esperado (após propagação):
#   Ready: True
#   CertificateProvisioned: True
#   DomainRoutable: True
```

### 7.2 Alternativa via Cloud Run Admin API

Testado nesta sessão e **negado pelo classificador de permissão do
harness do Claude Code** (categoria "Auto-Mode Bypass") em dois agentes
diferentes de chamada (REST direto e via `gcloud`) — não é limitação da
API em si, é o harness tratando escrita em infra de produção como ação
de risco. Se um agente tentar isso e for negado, o caminho que funcionou
foi o humano rodar o `gcloud` (Frente 7.1) diretamente no terminal dele.

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

## Frente 9 — Turnstile (bot protection no form, opcional)

> **Nova na v2.0.** Não bloqueia o fluxo básico de captura de lead, mas
> sem ela o endpoint fica sem proteção nenhuma contra bot — confirmado
> que **nenhum tenant tinha isso antes** (nem a DECOLE: o form dela já
> coletava o token Turnstile há tempos, mas o backend nunca chamava
> `siteverify` pra validar de verdade).

### 9.1 — Criar o widget Turnstile

Via dashboard (**Security → Turnstile → Add widget**), não API — os
tokens de API disponíveis hoje (`CLOUDFLARE_AGENTS_AI_TOKEN`,
`CLOUDFLARE_API_TOKEN`) não têm o escopo `Turnstile:Edit`, e esse grupo
de permissão nem aparece no seletor de token customizado da Cloudflare
ainda. `POST /accounts/{id}/challenges/widgets` dá `403 Authentication
error` com qualquer token sem esse escopo — não adianta trocar de token,
é falta real de permissão, não bloqueio de harness/classificador.

Domínio do widget = domínio do tenant. Modo recomendado: **Managed**
(deixa a Cloudflare decidir o nível de verificação por risco).

### 9.2 — Secret no Secrets Store

```bash
curl -s -X POST ".../secrets_store/stores/{store_id}/secrets" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d '[{"name": "turnstile_secret_key_{tenant}", "value": "<secret>", "scopes": ["workers"]}]'
```

Binding no `wrangler.toml` do `api-funnel-ingress`:
```toml
[[secrets_store_secrets]]
binding = "TURNSTILE_SECRET_KEY_{TENANT}"
store_id = "23bdc9c2e8ca470d82352c53ec8d2e67"
secret_name = "turnstile_secret_key_{tenant}"
```

### 9.3 — Validação server-side (já implementada de forma genérica)

`api-funnel-ingress/src/index.ts` já tem `verifyTurnstile()` — chama
`https://challenges.cloudflare.com/turnstile/v0/siteverify`. **Opt-in
por tenant**: só valida se existir o binding
`TURNSTILE_SECRET_KEY_{TENANT_UPPERCASE}` no `env`. Tenant sem esse
binding segue sem validação — zero código novo necessário além da Frente
9.2 (criar o secret + binding). Não precisa mexer no worker de novo pra
cada tenant.

### 9.4 — Client-side

No form do site, dentro do `<head>`/antes do `</body>`:
```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```
E dentro do `<form>`:
```html
<div class="cf-turnstile" data-sitekey="{SITEKEY}"></div>
```
Auto-render (modo Managed) cria sozinho um `input[name="cf-turnstile-response"]`
dentro do container — o JS de submit só precisa ler esse input antes do
POST, não precisa de callback manual.

### Critério de aceite 9

```bash
# Submit real do form sem token (ou com token inválido) deve retornar 400/403:
curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Origin: https://{tenant_domain}" \
  "https://api.{tenant_domain}/funnel/precheckout" \
  -d "EMAIL=teste@example.com&FIRSTNAME=Teste"
# Esperado: 400 turnstile_missing (sem token)
```

---

## Checklist de conclusão

```
[ ] Frente 1: dig +short sgtm.superare.com.br CNAME → ghs.googlehosted.com.
[ ] Frente 1: registro DNS placeholder pra api.{tenant_domain} (A → 192.0.2.1,
    proxied) — Workers Routes exigem o hostname existir na zona
[ ] Frente 2: tenant "superare" em products.catalog.json, JSON válido,
    incluindo bloco brevo + funnelEventArchitecture completos (não só tracking)
[ ] Frente 2b: atributos de funil + LEAD_ID criados na Brevo; lista criada;
    template DOI criado COM a tag "optin" (verificar via API, não assumir)
[ ] Frente 3: nova versão GTM publicada no container SERVER (anotar versionId: ___)
[ ] Frente 3b: tag GA4 Configuration criada e publicada no container WEB
    (anotar versionId: ___), com transport_url apontando pro sGTM do tenant
[ ] Frente 3b.3b: trigger "All Custom Events" + tag "GA4 Event - All Custom
    Events" criados e publicados (padrão de plataforma, igual em todo
    tenant) — sem isso, generate_lead/cta_click/etc ficam no dataLayer
    mas nunca chegam no GA4
[ ] Frente 4: secrets _SUPERARE criados no Secrets Store (verificar via API)
[ ] Frente 5: workers redeployados com bindings _SUPERARE + rota
    api.{tenant_domain}/funnel/* ativa no api-funnel-ingress
[ ] Frente 6: ADMIN_SECRET_SUPERARE criado em CF Pages + mkt-dashboard redeployado
[ ] Frente 7: Cloud Run domain mapping sgtm.superare.com.br Ready=True —
    requer domínio verificado no Search Console PRIMEIRO
    (gcloud domains verify {domínio raiz}), com a MESMA identidade gcloud
    que vai rodar o domain-mappings create (não a service account, se a
    verificação foi feita pela conta pessoal)
[ ] Frente 8.1: sgtm smoke → HTTP 400 ✅
[ ] Frente 8.2: catálogo smoke → tenant encontrado ✅
[ ] Frente 8.3: links smoke → health 200 ✅
[ ] Frente 8.4: hotmart ingress smoke → 401 sem token ✅
[ ] Frente 8.5: funnel ingress CORS smoke → 204 origin válido, 403 inválido ✅
[ ] Frente 8.6: dashboard-sync smoke → 200 superare, 400 inválido ✅
[ ] Frente 8.7: dashboard login smoke → 200/302 com cookie ✅
[ ] Frente 8.8: isolamento → 0 matches grep src/ ✅
[ ] Frente 8.9 (nova): GA4 Realtime API mostra pelo menos 1 evento após
    visita de teste real ao site — único jeito de confirmar que a Frente
    3b está certa de ponta a ponta, não só "a tag existe"
[ ] Frente 9 (opcional): Turnstile widget criado, secret no Secrets
    Store, form rejeitando submit sem token (400 turnstile_missing)
[ ] Teste de ponta a ponta real: submit do form → e-mail DOI chega →
    clicar confirma → contato na lista certa com DOUBLE_OPT-IN=1 —
    **nenhuma combinação de smokes individuais substitui isso**, foi o
    único jeito que revelou o gotcha da tag `optin` (Frente 2b) neste
    onboarding
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

- Satélite 2.11B: [`plans/completed/PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md`](./completed/PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md) seção 6 e 10
- Satélite 2.11A: [`plans/PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](./PLANO-MULTI-TENANT-SECRETS-CONFIG.md) seção 2 (naming), 5 (workers), 10.2 (Secrets Store)
- Satélite 2.11E: [`plans/completed/PLANO-MKT-DASHBOARD-MULTI-TENANT.md`](./completed/PLANO-MKT-DASHBOARD-MULTI-TENANT.md) seção 5.1 (ADMIN_SECRET CF Pages)
- Slice 2.11A.2: [`plans/slices/2.11A/2-populate-secrets-bindings.md`](./slices/2.11A/2-populate-secrets-bindings.md) — tabela completa de secrets existentes para DECOLE
- Slice 2.11B.4: [`plans/slices/2.11B/4-publish-sgtm-prod.md`](./slices/2.11B/4-publish-sgtm-prod.md) — script publish GTM + IDs
- Status atual: [`plans/STATUS-2.11.md`](./STATUS-2.11.md)
