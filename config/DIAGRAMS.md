# Diagramas do Sistema DECOLE — Cloudflare

> Formato: PlantUML. Renderizar com VS Code (extension: PlantUML), IntelliJ ou `plantuml -tsvg *.puml`.
> Última actualização: 2026-04-28.

---

## 1 · Arquitetura do Sistema

Visão de componentes e fluxo de dados de ponta a ponta.

```plantuml
@startuml arquitetura-sistema
!theme plain
skinparam linetype ortho
skinparam backgroundColor #FFFFFF
skinparam defaultFontSize 12
skinparam packageStyle rectangle
skinparam componentStyle rectangle
skinparam databaseBackgroundColor #DAE8FC
skinparam storageBackgroundColor #D5E8D4
skinparam queueBackgroundColor #FFE6CC

left to right direction

package "Origens" {
  actor "Browser / Site\ndecolesuacarreiraesg.com.br" as Browser
  actor "Hotmart\nWebhook POST" as Hotmart
}

package "Ingress Workers" as Ingress {
  component "api-funnel-ingress\napi.decole…/funnel/*\n/webhooks/v1/planovoo/app/event" as FI
  component "links-redirect\nlinks.decole…/*" as LR
  component "api-hotmart-ingress\napi.decole…/webhooks/v1/*/hotmart/*" as HI
}

package "Queue · Cloudflare Queues" as Queues {
  queue "decole-q-funnel-events\nbatch 25 · timeout 10s · retries 5" as Q
  queue "decole-q-funnel-events-dlq\n5 retries esgotados" as DLQ
}

package "Dispatcher · Cloudflare Worker" as Disp {
  component "funnel-dispatcher\nconsumer da queue\nchain de handlers por evento" as FD
}

package "Storage · Cloudflare" as Storage {
  database "D1 event-store\nfunnel_events" as D1E
  database "D1 identity\nidentity_links" as D1I
  storage "KV DEDUPE_KV\nidempotência por handler" as KVD
  storage "KV IDENTITY_KV\ncache de identidade" as KVI
}

package "Destinos Externos" as Externos {
  component "sGTM\nGTM-K6Q4H6BR" as sGTM
  component "Brevo\nCRM + Email" as Brevo
  component "n8n\nautomações" as N8N
}

package "Tracking Final" as Tracking {
  component "Google Analytics 4" as GA4
  component "Meta CAPI" as Meta
}

Browser -right-> FI : GENERATE_LEAD · SIGN_UP
Browser -right-> LR : BEGIN_CHECKOUT + redirect
Hotmart -right-> HI : PURCHASE_APPROVED\nPURCHASE_OUT_OF_SHOPPING_CART

FI -right-> Q
LR -right-> Q
HI -right-> Q
Q .right.> DLQ : falha após 5 retries

Q -right-> FD

FD <-down-> D1E
FD <-down-> D1I
FD <-down-> KVD
FD <-down-> KVI
FD -right-> sGTM
FD -right-> Brevo
FD -right-> N8N

sGTM -down-> GA4
sGTM -down-> Meta

@enduml
```

---

## 2 · Chains de Handlers por Evento

Cada evento entra na queue com um `event_type` e `product_code`. O `funnel-dispatcher` lê a chain do `products.catalog.json` e executa os handlers em ordem. Cada handler é idempotente via `DEDUPE_KV`.

```plantuml
@startuml chains-handlers
!theme plain
skinparam sequenceMessageAlign center
skinparam sequenceBoxBackgroundColor #F5F5F5
skinparam backgroundColor #FFFFFF
skinparam defaultFontSize 12

participant "Queue" as Q
participant "resolve_identity" as RI #DAE8FC
participant "upsert_event_store" as US #DAE8FC
participant "enrich_attribution" as EA #FFF2CC
participant "update_brevo_funnel" as UB #D5E8D4
participant "send_brevo_doi" as SB #D5E8D4
participant "sync_brevo_segments" as SS #D5E8D4
participant "send_cart_abandonment" as SC #D5E8D4
participant "emit_tracking" as ET #FFE6CC
participant "forward_n8n" as FN #FFE6CC

== GENERATE_LEAD · source: site ==

Q -> RI
RI -> US
US -> SB
SB -> UB
UB -> SS

== BEGIN_CHECKOUT · source: site ==

Q -> RI
RI -> US
US -> EA
EA -> UB
UB -> ET

== PURCHASE_APPROVED · source: hotmart ==

Q -> RI
RI -> US
US -> EA
EA -> UB
UB -> ET
ET -> FN

== PURCHASE_OUT_OF_SHOPPING_CART · source: hotmart ==

Q -> RI
RI -> US
US -> UB
UB -> SC

@enduml
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

```plantuml
@startuml deployment-infra
!theme plain
skinparam linetype ortho
skinparam backgroundColor #FFFFFF
skinparam defaultFontSize 11
skinparam componentStyle rectangle
skinparam nodeBackgroundColor #DAE8FC
skinparam artifactBackgroundColor #F5F5F5
skinparam queueBackgroundColor #FFE6CC
skinparam databaseBackgroundColor #DAE8FC
skinparam storageBackgroundColor #D5E8D4

package "GitHub Actions" as GHA {
  artifact "deploy-incremental-hotmart-ingress.yml\nworkflow_dispatch · dry_run opcional\n→ test + typecheck + wrangler deploy" as WF1
  artifact "ci-e2e-staging.yml\nworkflow_dispatch manual\n→ run-scenarios.sh --all --skip-sgtm" as WF2
}

package "Scripts locais" as Scripts {
  artifact "scripts/deploy-incremental.sh\n--worker api-hotmart-ingress\n--worker api-funnel-ingress\n--worker funnel-dispatcher\n→ npm test + typecheck + wrangler deploy [--dry-run]" as S1
  artifact "tests/verify.sh\n--unit-only | --e2e-only | --full | --worker <name>\n→ unit tests + run-scenarios.sh" as S2
  artifact "scripts/healthcheck-worker.sh\n--url <worker>/health" as S3
}

WF1 -down-> S1
WF2 -down-> S2

cloud "Cloudflare Edge" as CF {

  node "decole-api-funnel-ingress" as W_FI {
    component "Route: api.decole…/funnel/*\n         api.decole…/webhooks/v1/planovoo/app/event\nProducer → FUNNEL_EVENTS\nenv: ALLOWED_ORIGINS" as FI_C
  }

  node "decole-links-redirect" as W_LR {
    component "Route: links.decolesuacarreiraesg.com.br/*\nProducer → FUNNEL_EVENTS\nenv: checkout URLs · LINKS_PRODUCTS" as LR_C
  }

  node "decole-api-hotmart-ingress" as W_HI {
    component "Route: api.decole…/webhooks/v1/decole-esg/hotmart/*\n         api.decole…/webhooks/v1/planovoo/hotmart/*\nProducer → FUNNEL_EVENTS\nsecret: HOTMART_WEBHOOK_TOKEN_*" as HI_C
  }

  node "decole-funnel-dispatcher" as W_FD {
    component "Consumer ← decole-q-funnel-events\nKV: DEDUPE_KV · IDENTITY_KV\nD1: decole-d1-identity · decole-d1-event-store\nDLQ: decole-q-funnel-events-dlq" as FD_C
  }

  queue "decole-q-funnel-events" as Q_MAIN
  queue "decole-q-funnel-events-dlq" as Q_DLQ

  FI_C -down-> Q_MAIN
  LR_C -down-> Q_MAIN
  HI_C -down-> Q_MAIN
  Q_MAIN -down-> FD_C
  Q_MAIN .right.> Q_DLQ : retries esgotados
}

@enduml
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

```plantuml
@startuml fluxo-desenvolvimento
!theme plain
skinparam backgroundColor #FFFFFF
skinparam defaultFontSize 12
skinparam activityBackgroundColor #DAE8FC
skinparam activityBorderColor #6C8EBF
skinparam activityDiamondBackgroundColor #FFF2CC
skinparam activityDiamondBorderColor #D6B656
skinparam ArrowColor #555555

start

:Alteração de código\n(worker · handler · catalog · shared);

repeat
  :npm test\npor worker afectado\nvitest · sem rede;
backward:corrigir código / teste;
repeat while (falha?) is (sim)
-> não;

repeat
  :bash tests/verify.sh --unit-only\ntodos os workers;
backward:corrigir código / teste;
repeat while (algum worker falha?) is (sim)
-> não;

repeat
  :bash tests/verify.sh\nou verify.sh --worker <nome>\nunit + E2E cenários afectados;
backward:corrigir implementação\nou fixture de teste;
repeat while (falha?) is (sim)
-> não;

:git commit;

repeat
  :bash scripts/deploy-incremental.sh --worker <nome>\n(npm test + typecheck + wrangler deploy);
backward:corrigir e re-executar;
repeat while (falha?) is (sim)
-> não;

:scripts/healthcheck-worker.sh\n--url https://worker.domain/health;

if (200 OK?) then (não)
  :wrangler rollback\n+ investigar logs;
  stop
endif

repeat
  :bash tests/verify.sh --all --skip-sgtm;
backward:wrangler rollback;
repeat while (< 2x consecutivas?) is (sim)
-> 2x pass;

:✅ Go-live;

stop

note right
  **Atalhos por worker alterado:**
  funnel-dispatcher  → cenários 01–08
  api-hotmart-ingress → cenários 03–06
  links-redirect      → cenário 02
  api-funnel-ingress  → cenários 01, 07
  packages/shared     → cenários 01–08

  **Com sGTM:**
  verify.sh --full --meta-test-event-code TESTXXXX
end note

@enduml
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
