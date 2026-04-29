# Diagramas do Sistema DECOLE — Cloudflare

> Formato: PlantUML. Arquivos em [`config/diagramas/`](diagramas/).
> Renderizar com VS Code (extensão PlantUML · `Alt+D`), IntelliJ, ou `plantuml -tsvg diagramas/*.puml`.
> Última actualização: 2026-04-28.

---

## Índice

| # | Diagrama | Arquivo | O que mostra |
|---|----------|---------|--------------|
| 1 | [Arquitetura do Sistema](#1--arquitetura-do-sistema) | [`01-arquitetura-sistema.puml`](diagramas/01-arquitetura-sistema.puml) | Componentes e fluxo de dados de ponta a ponta |
| 2 | [Chains de Handlers por Evento](#2--chains-de-handlers-por-evento) | [`02-chains-handlers.puml`](diagramas/02-chains-handlers.puml) | Sequência de handlers para cada `event_type` |
| 3 | [Deployment & Infraestrutura](#3--deployment--infraestrutura) | [`03-deployment-infra.puml`](diagramas/03-deployment-infra.puml) | Workers, routes, bindings, CI/CD |
| 4 | [Fluxo de Desenvolvimento](#4--fluxo-de-desenvolvimento) | [`04-fluxo-desenvolvimento.puml`](diagramas/04-fluxo-desenvolvimento.puml) | Change → test → commit → deploy → go-live |
| 5 | [Dados de Entrada do Funil](#5--dados-de-entrada-do-funil) | [`05-dados-entrada-funil.puml`](diagramas/05-dados-entrada-funil.puml) | Campos por evento, gaps de UTM, encaixe no funil por produto, dashboard |

---

## 1 · Arquitetura do Sistema

→ [`diagramas/01-arquitetura-sistema.puml`](diagramas/01-arquitetura-sistema.puml)

Visão de componentes e fluxo de dados de ponta a ponta: origens → ingress workers → queue → dispatcher → storage + destinos externos.

**Camadas:**
- **Origens** — Browser/Site e Hotmart (webhook)
- **Ingress Workers** — `api-funnel-ingress`, `links-redirect`, `api-hotmart-ingress`
- **Queue** — `decole-q-funnel-events` (batch 25 · timeout 10s · retries 5) + DLQ
- **Dispatcher** — `funnel-dispatcher`, consumer da queue, executa chain de handlers
- **Storage** — D1 `funnel_events` + `identity_links`, KV `DEDUPE_KV` + `IDENTITY_KV`
- **Destinos** — sGTM → GA4 + Meta CAPI, Brevo, n8n

---

## 2 · Chains de Handlers por Evento

→ [`diagramas/02-chains-handlers.puml`](diagramas/02-chains-handlers.puml)

Cada evento entra na queue com um `event_type` e `product_code`. O `funnel-dispatcher` lê a chain do `products.catalog.json` e executa os handlers em ordem. Cada handler é idempotente via `DEDUPE_KV`.

**Chains por evento:**

| Evento | Source | Chain |
|--------|--------|-------|
| `GENERATE_LEAD` | site | resolve_identity → upsert_event_store → send_brevo_doi → update_brevo_funnel → sync_brevo_segments |
| `BEGIN_CHECKOUT` | site | resolve_identity → upsert_event_store → enrich_attribution → update_brevo_funnel → emit_tracking |
| `PURCHASE_APPROVED` | hotmart | resolve_identity → upsert_event_store → enrich_attribution → update_brevo_funnel → emit_tracking → forward_n8n |
| `PURCHASE_OUT_OF_SHOPPING_CART` | hotmart | resolve_identity → upsert_event_store → update_brevo_funnel → send_cart_abandonment_email |

**O que cada handler faz:**

| Handler | Acção | Storage |
|---------|-------|---------|
| `resolve_identity` | Email → `profile_id` (hash + lookup) | KV IDENTITY_KV · D1 identity_links |
| `upsert_event_store` | Persiste evento + attribution merged no `payload_json` | D1 funnel_events |
| `enrich_attribution` | Lê site events do D1 → recupera `fbp`/`fbc`/`client_ip` para eventos hotmart | D1 funnel_events (leitura) |
| `update_brevo_funnel` | Actualiza campos de funil no CRM (estágio, datas) | Brevo Contacts API |
| `send_brevo_doi` | Envia email DOI (double opt-in) via template Brevo | Brevo SMTP |
| `sync_brevo_segments` | Adiciona/remove contacto das listas correctas | Brevo Lists API |
| `send_cart_abandonment_email` | Email de carrinho abandonado via template | Brevo SMTP |
| `emit_tracking` | Envia payload para sGTM `/mp/collect` → GA4 + Meta CAPI | sGTM (GTM-K6Q4H6BR) |
| `forward_n8n` | Webhook para n8n (automações pós-compra) | n8n |

---

## 3 · Deployment & Infraestrutura

→ [`diagramas/03-deployment-infra.puml`](diagramas/03-deployment-infra.puml)

Workers com routes exactas, bindings e ligação CI/CD → scripts locais.

**Bindings do `funnel-dispatcher`:**

| Binding | Tipo | Recurso |
|---------|------|---------|
| `DEDUPE_KV` | KV Namespace | `aadb6b3ff1024cc5aeb3119e6c662863` |
| `IDENTITY_KV` | KV Namespace | `88989e2e3492459eadb06e9da523dfae` |
| `IDENTITY_DB` | D1 Database | `decole-d1-identity` · `e71a266a-b400-4970-a056-bf7223799f25` |
| `EVENT_STORE_DB` | D1 Database | `decole-d1-event-store` · `f5c19aac-2bdc-4fe4-b560-e1c49199ff4c` |

---

## 4 · Fluxo de Desenvolvimento

→ [`diagramas/04-fluxo-desenvolvimento.puml`](diagramas/04-fluxo-desenvolvimento.puml)

Do código à produção com loops de validação em cada fase.

**Mapeamento mudança → verificação mínima:**

| Ficheiro alterado | Comando mínimo | Cenários E2E |
|-------------------|----------------|--------------|
| `funnel-dispatcher/src/**` | `verify.sh --worker funnel-dispatcher` | 01–08 |
| `api-hotmart-ingress/src/**` | `verify.sh --worker api-hotmart-ingress` | 03–06 |
| `links-redirect/src/**` | `verify.sh --worker links-redirect` | 02 |
| `api-funnel-ingress/src/**` | `verify.sh --worker api-funnel-ingress` | 01, 07 |
| `packages/shared/**` | `verify.sh` (todos) | 01–08 |
| `config/products.catalog.json` | `verify.sh` (todos) | 01–08 |

---

## 5 · Dados de Entrada do Funil

→ [`diagramas/05-dados-entrada-funil.puml`](diagramas/05-dados-entrada-funil.puml)

Mapa completo de **o que chega, de onde e o que está em falta** em cada etapa do funil, por produto. Inclui o encaixe com o dashboard de analytics.

**Cobre:**
- **AWARENESS** — PAGE_VIEW / CTA_CLICK via GTM → GA4 (cron diário)
- **CONSIDERATION** — GENERATE_LEAD: campos do formulário, identity (anonymous_id, session_id), Meta attribution (fbp/fbc), gap de UTMs (fix BACKLOG-015)
- **CONVERSION** — BEGIN_CHECKOUT: UTMs ✅ capturados pelo `links-redirect` Worker da URL
- **PURCHASE** — PURCHASE_APPROVED: enrich_attribution recupera fbp/fbc/utm do BEGIN_CHECKOUT
- **Dashboard** — Cloudflare Pages lendo D1 + GA4 Data API + Meta Marketing API
- **Gap de UTMs** — GENERATE_LEAD não envia utm_source/campaign (BACKLOG-015)

**Diferenciação por produto:**

| Produto | Diferenciador no evento | Fonte |
|---------|------------------------|-------|
| DECOLE_ESG_MENTORIA | `product_code` no payload | hidden field no formulário |
| DECOLE_PLANOVOO | `product_code` no payload | hidden field no formulário |
| ESG (GA4) | `customEvent:produto = DECOLE_ESG_MENTORIA` | GTM dataLayer |
| PlanoVoo (GA4) | `customEvent:produto = DECOLE_PLANOVOO` | GTM dataLayer |
| ESG (Meta) | `META_AD_ACCOUNT_ID_ESG` | cron usa conta ESG |
| PlanoVoo (Meta) | `META_AD_ACCOUNT_ID_PLANOVOO` | cron usa conta PlanoVoo |
