# Slice 2.11B.1 — Auditar sGTM DECOLE (inventário baseline)

> Satélite: 2.11B ([`../../PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md`](../../PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md))
> Estimativa: 2-3 horas (exploração + documentação)

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 ~07:30 por Claude Code (agent) |
| Completed | 2026-05-18 ~07:30 por Claude Code (agent) |
| Commit final | `e6f3b9d` |
| PR | N/A — documentação |

## Contexto

Antes de refatorar o workspace sGTM (Modelo B), precisamos saber o que existe hoje. Este slice é exploração pura — nenhuma mudança de código ou infra.

## Inventário sGTM DECOLE (Baseline 2026-05-18)

### Container GTM

| Propriedade | Valor |
|---|---|
| **Container ID (Web — GTM.js no browser)** | `GTM-58CQ9K7X` |
| **Container ID (Server-side — sGTM)** | `GTM-K6Q4H6BR` |
| **Account ID** | `6266094107` |
| **Projeto GCP** | `gtm-k6q4h6br-ndq3n` |
| **Service Account** | `acesso-api@gtm-k6q4h6br-ndq3n.iam.gserviceaccount.com` |

> ⚠️ **Distinção importante:** O catálogo v4/v5 usa `containerPublicId: "GTM-58CQ9K7X"` — esse é o container Web (cliente), não o sGTM. O container servidor é `GTM-K6Q4H6BR`. As lookup tables do Modelo B devem ser configuradas dentro do workspace do container **GTM-K6Q4H6BR**.

### Endpoints atuais (pré-consolidação v5)

| Variável | Domínio | Nota |
|---|---|---|
| `SGTM_ENDPOINT_URL_DECOLE_ESG` | `https://sgtm.decolesuacarreiraesg.com.br` | Produto ESG |
| `SGTM_ENDPOINT_URL_PLANOVOO` | `https://sgtm.decolesuacarreiraesg.com.br` | Produto PLANOVOO |
| `SGTM_ENDPOINT_URL` | `https://sgtm.decolesuacarreiraesg.com.br` | Fallback genérico |

**Confirmado:** ambas as variáveis apontam para o **mesmo endpoint** — consolidação em `SGTM_ENDPOINT_URL_DECOLE` (v5) é segura sem migração de container.

**Tipo de deploy:** `sgtm.decolesuacarreiraesg.com.br` é domínio customizado. Infra backend (Cloud Run vs outro) ainda não confirmada via DNS — verificar em 2.11B.2.

### Como o sGTM é chamado hoje (código)

**Worker:** `funnel-dispatcher`, handler `emit_tracking` (`handlers/index.ts:1478`)

**Fluxo de chamada:**
1. Resolve endpoint: `env[tracking.sgtm.endpointEnvVar] || tracking.sgtm.endpointUrl || env.SGTM_ENDPOINT_URL`
2. Constrói URL MP: `${sgtmEndpointUrl}/mp/collect?measurement_id=${ga4MeasurementId}&api_secret=${ga4ApiSecret}`
3. POST JSON com GA4 Measurement Protocol payload
4. Parâmetros incluem: `client_id`, `produto` (custom dimension), `transaction_id`, `em` (email hash), `fbp`, `fbc`, `gclid`, `utm_*`

**Eventos que chamam `emit_tracking`** (chain via catálogo):
- `BEGIN_CHECKOUT` — ambos os produtos
- `PURCHASE_APPROVED` — ambos os produtos

**Eventos que NÃO chamam** (tracking via GTM Web no browser, sem server-side para evitar dupla contagem):
- `GENERATE_LEAD` (GENERATE_LEAD, PAGE_VIEW, CTA_CLICK)

### Destinos esperados dentro do sGTM

O sGTM recebe o request do `emit_tracking` e deve fazer fan-out para:
1. **GA4** — property `G-BQQB6X5XN1` (tenant DECOLE, ambos os produtos diferenciados via custom dimension `produto`)
2. **Meta CAPI** — pixel `1329973348435032` (ESG) ou `2220600768748665` (PLANOVOO) dependendo do parâmetro `produto`

O sGTM escolhe o pixel Meta correto via lookup por `produto` — este é o comportamento que precisamos preservar ao refatorar o workspace para Modelo B (lookup table por `tenant_id` + `produto`).

### Configurações de tracking (v5)

| Campo | Valor | Env Var |
|---|---|---|
| GA4 Measurement ID | `G-BQQB6X5XN1` | `GA4_MEASUREMENT_ID_DECOLE` |
| GA4 API Secret | (secret) | `GA4_API_SECRET_DECOLE` |
| Meta Pixel ESG | `1329973348435032` | `META_PIXEL_ID_DECOLE_ESG` |
| Meta Pixel PLANOVOO | `2220600768748665` | `META_PIXEL_ID_DECOLE_PLANOVOO` |
| Meta CAPI Token | (secret) | `META_CAPI_ACCESS_TOKEN_DECOLE` |

### Lacunas a confirmar em 2.11B.2

1. **Infra do container sGTM:** `sgtm.decolesuacarreiraesg.com.br` aponta para Cloud Run ou outro provider? → verificar DNS / deployment config
2. **Tags configuradas no container GTM-K6Q4H6BR:** quais tags existem hoje (GA4, Meta CAPI, outros)? → verificar via GTM UI ou Tag Manager API
3. **Como o sGTM seleciona o Meta Pixel:** existe lookup por `produto` já configurado, ou a tag é estática (mesmo pixel para todos)?
4. **Meta CAPI access token:** está configurado como variável no container sGTM, ou injetado pelo worker?

## Execução (append-only)

### 2026-05-18 ~07:30 by Claude Code (exploração via sub-agente)
- Inventário completo coletado via exploração do catálogo, handlers, .env.local, SA JSON
- Descoberta chave: container sGTM é `GTM-K6Q4H6BR`, não `GTM-58CQ9K7X` (que é Web)
- Ambos os endpoints SGTM_ENDPOINT_URL_* apontam para o mesmo domínio — consolidação v5 segura
- Lacunas 1-4 bloqueiam 2.11B.2 (refactor do workspace) — precisam de acesso à GTM UI

## Revisão G.12

Slice de documentação/exploração pura — sem código, sem testes. Revisão G.12 não aplicável. Owner valida conteúdo factual.
