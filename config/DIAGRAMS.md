# Diagramas do Sistema DECOLE — Cloudflare

> Renderizam nativamente no GitHub. Última actualização: 2026-04-28.

---

## 1 · Arquitetura do Sistema

Visão de componentes e fluxo de dados de ponta a ponta.

```mermaid
graph LR
  subgraph Origens
    Browser["🌐 Site\ndecolesuacarreiraesg.com.br"]
    Hotmart["🛒 Hotmart\nwebhook POST"]
  end

  subgraph Ingress["Ingress Workers"]
    FI["api-funnel-ingress\napi.decole…/funnel/*\n/webhooks/v1/planovoo/app/event"]
    LR["links-redirect\nlinks.decole…/*"]
    HI["api-hotmart-ingress\napi.decole…/webhooks/v1/*/hotmart/*"]
  end

  subgraph Queue["Queue · Cloudflare Queues"]
    Q[("decole-q-funnel-events\nbatch 25 · timeout 10s · retries 5")]
    DLQ[("decole-q-funnel-events-dlq\n5 retries esgotados")]
  end

  subgraph Dispatcher["Dispatcher · Cloudflare Worker"]
    FD["funnel-dispatcher\nconsumer da queue\nchain de handlers por evento"]
  end

  subgraph Storage["Storage · Cloudflare"]
    D1E[("D1 · event-store\nfunnel_events")]
    D1I[("D1 · identity\nidentity_links")]
    KVD[("KV · DEDUPE_KV\nidempotência por handler")]
    KVI[("KV · IDENTITY_KV\ncache de identidade")]
  end

  subgraph Externos["Destinos externos"]
    sGTM["sGTM\nGTM-K6Q4H6BR"]
    Brevo["Brevo\nCRM + Email"]
    N8N["n8n\nautomações"]
  end

  subgraph Tracking["Tracking final"]
    GA4["Google Analytics 4"]
    Meta["Meta CAPI"]
  end

  Browser -->|"GENERATE_LEAD · SIGN_UP"| FI
  Browser -->|"BEGIN_CHECKOUT + redirect"| LR
  Hotmart -->|"PURCHASE_APPROVED\nPURCHASE_OUT_OF_SHOPPING_CART"| HI

  FI --> Q
  LR --> Q
  HI --> Q
  Q -.->|"falha após 5 retries"| DLQ

  Q --> FD

  FD <--> D1E
  FD <--> D1I
  FD <--> KVD
  FD <--> KVI
  FD --> sGTM
  FD --> Brevo
  FD --> N8N

  sGTM --> GA4
  sGTM --> Meta
```

---

## 2 · Chains de Handlers por Evento

Cada evento entra na queue com um `event_type` e `product_code`. O `funnel-dispatcher` lê a chain do `products.catalog.json` e executa os handlers em ordem. Cada handler é idempotente via `DEDUPE_KV`.

```mermaid
flowchart LR
  subgraph GL["GENERATE_LEAD · source: site"]
    direction LR
    GL1[resolve_identity] --> GL2[upsert_event_store] --> GL3[send_brevo_doi] --> GL4[update_brevo_funnel] --> GL5[sync_brevo_segments]
  end

  subgraph BC["BEGIN_CHECKOUT · source: site"]
    direction LR
    BC1[resolve_identity] --> BC2[upsert_event_store] --> BC3[enrich_attribution] --> BC4[update_brevo_funnel] --> BC5[emit_tracking]
  end

  subgraph PA["PURCHASE_APPROVED · source: hotmart"]
    direction LR
    PA1[resolve_identity] --> PA2[upsert_event_store] --> PA3[enrich_attribution] --> PA4[update_brevo_funnel] --> PA5[emit_tracking] --> PA6[forward_n8n]
  end

  subgraph CA["PURCHASE_OUT_OF_SHOPPING_CART · source: hotmart"]
    direction LR
    CA1[resolve_identity] --> CA2[upsert_event_store] --> CA3[update_brevo_funnel] --> CA4[send_cart_abandonment_email]
  end
```

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

Workers, routes, bindings e CI/CD.

```mermaid
graph TB
  subgraph CI["CI/CD · GitHub Actions"]
    WF1["deploy-incremental-hotmart-ingress.yml\nworkflow_dispatch · dry_run opcional\n→ test + typecheck + wrangler deploy"]
    WF2["ci-e2e-staging.yml\nworkflow_dispatch manual\n→ run-scenarios.sh --all --skip-sgtm"]
  end

  subgraph CF["☁️ Cloudflare Edge"]
    subgraph W_FI["decole-api-funnel-ingress"]
      FI_R["api.decole…/funnel/*\napi.decole…/webhooks/v1/planovoo/app/event"]
      FI_B["Producer → decole-q-funnel-events\nenv: ALLOWED_ORIGINS"]
    end

    subgraph W_LR["decole-links-redirect"]
      LR_R["links.decolesuacarreiraesg.com.br/*"]
      LR_B["Producer → decole-q-funnel-events\nenv: checkout URLs · LINKS_PRODUCTS"]
    end

    subgraph W_HI["decole-api-hotmart-ingress"]
      HI_R["api.decole…/webhooks/v1/decole-esg/hotmart/*\napi.decole…/webhooks/v1/planovoo/hotmart/*\napi.decole…/webhooks/v1/plano-de-voo/hotmart/*"]
      HI_B["Producer → decole-q-funnel-events\nsecret: HOTMART_WEBHOOK_TOKEN_*"]
    end

    subgraph W_FD["decole-funnel-dispatcher"]
      FD_B["Consumer ← decole-q-funnel-events\nKV: DEDUPE_KV · IDENTITY_KV\nD1: decole-d1-identity · decole-d1-event-store\nDLQ: decole-q-funnel-events-dlq"]
    end

    Q_MAIN[("decole-q-funnel-events")]
    Q_DLQ[("decole-q-funnel-events-dlq")]

    FI_B --> Q_MAIN
    LR_B --> Q_MAIN
    HI_B --> Q_MAIN
    Q_MAIN --> FD_B
    Q_MAIN -.-> Q_DLQ
  end

  subgraph Scripts["Scripts locais"]
    S1["deploy-incremental.sh --worker api-hotmart-ingress\n                        --worker api-funnel-ingress\n                        --worker funnel-dispatcher\n→ test + typecheck + wrangler deploy [--dry-run]"]
    S2["tests/verify.sh [--unit-only | --e2e-only | --full]\n                  [--worker <name>]\n→ unit tests + run-scenarios.sh"]
    S3["scripts/healthcheck-worker.sh --url <url>/health"]
  end

  WF1 --> S1
  WF2 --> S2
```

**Bindings do `funnel-dispatcher`:**

| Binding | Tipo | Recurso |
|---------|------|---------|
| `DEDUPE_KV` | KV Namespace | `aadb6b3ff1024cc5aeb3119e6c662863` |
| `IDENTITY_KV` | KV Namespace | `88989e2e3492459eadb06e9da523dfae` |
| `IDENTITY_DB` | D1 Database | `decole-d1-identity` · `e71a266a-b400-4970-a056-bf7223799f25` |
| `EVENT_STORE_DB` | D1 Database | `decole-d1-event-store` · `f5c19aac-2bdc-4fe4-b560-e1c49199ff4c` |

---

## 4 · Fluxo de Desenvolvimento

Do código à produção.

```mermaid
flowchart TD
  Change["✏️ Alteração de código\nworker · handler · catalog · shared"]

  Change --> UnitLocal["npm test\npor worker afectado\nvitest · sem rede"]

  UnitLocal -->|"✗ falha"| FixUnit["corrigir código / teste"]
  FixUnit --> UnitLocal

  UnitLocal -->|"✓ pass"| VerifyFull["bash tests/verify.sh --unit-only\ntodos os workers em sequência"]

  VerifyFull -->|"✗ algum worker falha"| FixUnit

  VerifyFull -->|"✓ todos pass"| E2ELocal["bash tests/verify.sh\nou\nbash tests/verify.sh --worker nome\nunit + E2E cenários afectados"]

  E2ELocal -->|"✗ falha"| FixImpl["corrigir implementação\nou fixture de teste"]
  FixImpl --> E2ELocal

  E2ELocal -->|"✓ pass"| Commit["git commit"]

  Commit --> Deploy["bash scripts/deploy-incremental.sh\n--worker nome"]

  Deploy --> TestCI["npm test + typecheck\n(dentro do script)"]
  TestCI -->|"✗"| FixDeploy["corrigir e re-executar"]
  FixDeploy --> Deploy

  TestCI -->|"✓"| WDeploy["wrangler deploy"]

  WDeploy --> Health["scripts/healthcheck-worker.sh\n--url https://worker.domain/health"]

  Health -->|"✗ 500 / timeout"| Rollback["wrangler rollback\n+ investigar logs"]

  Health -->|"✓ 200"| E2EProd["bash tests/verify.sh\n2x consecutivas\n--all --skip-sgtm"]

  E2EProd -->|"✗ falha"| Rollback

  E2EProd -->|"✓ pass 2x"| GoLive["✅ Go-live"]

  subgraph Shortcuts["Atalhos por contexto de mudança"]
    SC1["mudança em funnel-dispatcher\n→ verify.sh --worker funnel-dispatcher\n   cobre cenários 01–08"]
    SC2["mudança em api-hotmart-ingress\n→ verify.sh --worker api-hotmart-ingress\n   cobre cenários 03–06"]
    SC3["mudança em links-redirect\n→ verify.sh --worker links-redirect\n   cobre cenário 02"]
    SC4["mudança em api-funnel-ingress\n→ verify.sh --worker api-funnel-ingress\n   cobre cenários 01, 07"]
    SC5["com sGTM ativo\n→ verify.sh --full --meta-test-event-code TESTXXXX"]
  end
```

**Mapeamento mudança → verificação mínima:**

| Ficheiro alterado | Comando mínimo | Cenários E2E |
|-------------------|----------------|--------------|
| `funnel-dispatcher/src/**` | `verify.sh --worker funnel-dispatcher` | 01–08 |
| `api-hotmart-ingress/src/**` | `verify.sh --worker api-hotmart-ingress` | 03–06 |
| `links-redirect/src/**` | `verify.sh --worker links-redirect` | 02 |
| `api-funnel-ingress/src/**` | `verify.sh --worker api-funnel-ingress` | 01, 07 |
| `packages/shared/**` | `verify.sh` (todos) | 01–08 |
| `config/products.catalog.json` | `verify.sh` (todos) | 01–08 |
