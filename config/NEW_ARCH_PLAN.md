# Arquitetura orientada a eventos — DECOLE (catálogo como single source of truth)

## Contexto

O repositório já tem `backend/cloudflare/config/products.catalog.json` (schemaVersion 2) como fonte declarada de verdade para dois produtos — `DECOLE_ESG_MENTORIA` e `DECOLE_PLANOVOO`. O estado atual da operação ainda está fragmentado entre múltiplos componentes e contratos. Entretanto:

- Não há tipo canônico de evento — cada worker lida com o shape nativo de cada fonte (Hotmart, form, app).
- O catálogo lista nomes de eventos mas não descreve handler chains — a lógica de "qual handler executa para qual evento" é hardcoded no consumer.
- Idempotência é por `event_id` apenas — não permite retry parcial por handler.
- O fluxo de precheckout síncrono com provedor externo acopla UX e entrega.
- Diagramas PUML são mantidos à mão, fragmentados, sem visão unificada produto × funil × sistema.
- Não existe heartbeat automatizado validando drift entre catálogo, código, IDs GTM nas landings e diagramas.
- Post-purchase no app Plano de Voo (repo separado) não emite analytics.

**Diagrama alvo existente**: `backend/cloudflare/config/DIAGRAMA_COMPONENTES_FUNIL_EVENTOS.puml` (ainda não commitado) define a arquitetura de destino, descrita abaixo.

## Premissa de implantação

Este plano assume **recriação completa da infraestrutura** (greenfield) para o domínio de funil:

- Sem compatibilidade retroativa com APIs, filas, bindings, KV, D1 ou workers anteriores.
- Com **delivery incremental** e convivência controlada por fase (piloto -> expansão -> cutover).
- Workers novos entram como baseline operacional por trilha; componentes antigos são desativados apenas após gate E2E e janela de estabilidade.

### Estratégia de delivery incremental

Modelo de rollout:

1. Piloto em 1 worker (`api-hotmart-ingress`) com deploy isolado.
2. Expansão por componente (`api-funnel-ingress`, `funnel-dispatcher`, handlers).
3. Cutover final de rotas somente após validação E2E repetida.

Regras:

- Não executar big-bang de deploy.
- Cada deploy incremental deve ter rollback documentado.
- Sem misturar estratégias de entrega no mesmo componente: escolher `Wrangler deploy` **ou** `Cloudflare Builds API` por worker/ambiente.

### Modo sem staging dedicado (temporário)

Enquanto não existir ambiente staging isolado por conta/recursos:

- usar `workers.dev` como ambiente de validação controlada
- ativar proteções para dependências externas durante testes:
  - `BREVO_SANDBOX=true` para não enviar emails reais (`X-Sib-Sandbox: drop`)
  - `META_TEST_EVENT_CODE` para Meta CAPI em modo de teste
  - `N8N_DISABLE_FORWARD=true` para bloquear envio ao n8n quando necessário
- executar `backend/cloudflare/scripts/e2e-funnel-staging.sh` como gate antes de qualquer promoção

## Arquitetura alvo (do diagrama)

```
Event Sources → Cloudflare Ingress → Event Normalizer → FunnelEvent
FunnelEvent → decole-q-funnel-events → EventDispatcher
EventDispatcher → catalog.events[].chain → handlers[*] → External Systems
EventDispatcher → DEDUPE_KV (check + mark: event_id:handler_name)
EventDispatcher → DLQ (falha definitiva)
```

**`FunnelEvent` (tipo canônico)**:

```ts
{
  event_id: string          // uuid, idempotência global
  event_type: string        // GENERATE_LEAD | PURCHASE_APPROVED | ...
  product_code: string      // DECOLE_ESG_MENTORIA | DECOLE_PLANOVOO
  source: string            // site | hotmart | app
  occurred_at: string       // ISO 8601
  identity: {
    anonymous_id: string    // cookie first-party persistente por navegador
    session_id?: string     // sessão anônima (ex.: 30min)
    lead_id?: string        // id técnico gerado no front
    email_hash?: string     // SHA-256(lower(trim(email))) quando disponível
  }
  attribution?: {
    fbp?: string
    fbc?: string
    gclid?: string
    wbraid?: string
    gbraid?: string
    utm_source?: string
    utm_medium?: string
    utm_campaign?: string
  }
  lead: { email, phone?, lead_id? }
  payload: Record<string, unknown>  // context livre
}
```

**Pipeline GTM Web → GTM Server → GA4/Meta CAPI**

Já existe hoje: todo evento do `dataLayer` no browser vai para o GTM Web container (`GTM-58CQ9K7X`), que encaminha para o **GTM Server container (sGTM) hospedado em Google Cloud** (App Engine / Cloud Run) em subdomínio próprio do projeto. O sGTM entrega:

- **GA4** via Measurement Protocol (cookies first-party, melhor deduplicação).
- **Meta Conversions API (CAPI)** server-side, com `user_data` hasheado (email, phone, fbp, fbc) — melhor match rate e resiliência a bloqueadores de pixel.
- Em paralelo, o GTM Web ainda pode disparar o Meta Pixel client-side quando útil (dual-write, com `event_id` compartilhado para deduplicação pelo Meta).

A arquitetura orientada a eventos NÃO substitui o sGTM — ela coexiste. O sGTM (Google Cloud) é a camada de analytics/tracking (GA4 + Meta). A queue de `FunnelEvent` (Cloudflare) é a camada de estado de funil (Brevo + n8n + jornada pós-compra). São dois planos de infra distintos que se encontram apenas no browser (eventos `both` disparam para ambos com o mesmo `event_id`).

**Três trilhos de entrega** (declarados no catálogo via `delivery`):

- **`gtm_web_only`** — evento fica no trilho analytics: GTM Web → sGTM (Google Cloud) → GA4 + Meta CAPI. Não passa pela queue Cloudflare. Uso: sinais de engajamento de alto volume (page_view, cta_click, section_view, section_engaged, button_click).
- **`server_queue`** — evento é normalizado para `FunnelEvent`, enfileirado e dispatchado. Atualiza Brevo, dispara n8n. Uso: webhooks Hotmart (BEGIN*CHECKOUT, PURCHASE*\*) e eventos de app.
- **`both`** — dispara no GTM Web (→ sGTM → GA4/CAPI) **E** POSTa no ingress server-side (→ queue → Brevo). Mesmo `event_id` dos dois lados para deduplicação. Uso: `generate_lead` e `sign_up`.

**Por que separar**: enfileirar `page_view` / `section_view` flodaria o dispatcher sem valor — Brevo só precisa saber transições de estágio. GA4/Meta via sGTM já cobrem engajamento com melhor fidelidade (first-party cookies, CAPI).

**Eixo transversal de identidade (novo)**: além dos três trilhos de entrega, toda telemetria deve carregar uma chave de identidade anônima (`anonymous_id`) para permitir stitch de eventos pré-submit e pós-submit. O vínculo definitivo acontece quando surge email/phone no `GENERATE_LEAD` (ou em evento de compra), criando ponte `anonymous_id -> email_hash -> profile_id`. Assim, Brevo deixa de ser a única fonte de segmentação e passa a ser um destino sincronizado.

**Handler chain por event_type** (apenas eventos `server_queue`/`both` têm chain):

| event_type                      | delivery                 | chain                                                               |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| `page_view`                     | `gtm_web_only`           | —                                                                   |
| `section_view`                  | `gtm_web_only`           | —                                                                   |
| `section_engaged`               | `gtm_web_only`           | —                                                                   |
| `cta_click`                     | `gtm_web_only`           | —                                                                   |
| `button_click`                  | `gtm_web_only`           | —                                                                   |
| `precheckout_form_started`      | `gtm_web_only`           | —                                                                   |
| `precheckout_form_progress`     | `gtm_web_only`           | —                                                                   |
| `GENERATE_LEAD`                 | `both`                   | `[resolve_identity, upsert_event_store, send_brevo_doi, update_brevo_funnel, emit_tracking]` |
| `PRECHECKOUT_SUBMIT_SUCCESS`    | `both`                   | `[resolve_identity, upsert_event_store, send_brevo_doi, update_brevo_funnel, emit_tracking]` |
| `PRECHECKOUT_SUBMIT_ERROR`      | `gtm_web_only`           | —                                                                   |
| `SIGN_UP`                       | `both`                   | `[update_brevo_funnel, emit_tracking]`                              |
| `BEGIN_CHECKOUT`                | `server_queue` (Hotmart) | `[update_brevo_funnel, emit_tracking]`                              |
| `PURCHASE_OUT_OF_SHOPPING_CART` | `server_queue`           | `[update_brevo_funnel, emit_tracking, send_cart_abandonment_email]` |
| `PURCHASE_APPROVED`             | `server_queue`           | `[resolve_identity, upsert_event_store, update_brevo_funnel, emit_tracking, forward_n8n]` |

Idempotência: chave `event_id:handler_name` no DEDUPE_KV — permite que um handler falhe e seja re-executado sem re-executar os que já completaram. Só se aplica a eventos `server_queue`/`both`.

## Escopo do alvo

O alvo já considera:

- Tipo canônico `FunnelEvent` como único contrato entre ingress e processamento.
- Handler chains 100% declarativas no catálogo.
- Idempotência por `event_id:handler_name`.
- Filas e stores novos, sem reaproveitar recursos legados.
- Automação de qualidade (`heartbeat`) e geração de diagramas como parte do pipeline.

## Design

### 1. Catálogo v3 — events com handler chains

Bump `products.catalog.json` para `schemaVersion: 3`. Adiciona globalmente:

```jsonc
"funnelStages": {
  "AWARENESS":     { "order": 1, "goal": "visit" },
  "CONSIDERATION": { "order": 2, "goal": "engage" },
  "CONVERSION":    { "order": 3, "goal": "checkout" },
  "PURCHASE":      { "order": 4, "goal": "approved" },
  "ACTIVATION":    { "order": 5, "goal": "first_use" },
  "RETENTION":     { "order": 6, "goal": "repeat_use" }
},
"handlers": {
  "resolve_identity":            { "worker": "funnel-dispatcher", "bindings": ["IDENTITY_KV", "IDENTITY_DB"] },
  "upsert_event_store":          { "worker": "funnel-dispatcher", "binding": "EVENT_STORE_DB" },
  "send_brevo_doi":              { "worker": "funnel-dispatcher", "binding": "BREVO_API_KEY" },
  "update_brevo_funnel":        { "worker": "funnel-dispatcher", "binding": "BREVO_API_KEY" },
  "send_cart_abandonment_email":{ "worker": "funnel-dispatcher", "binding": "BREVO_API_KEY" },
  "forward_n8n":                { "worker": "funnel-dispatcher", "binding": "N8N_WEBHOOK_URL" },
  "emit_tracking":              { "worker": "funnel-dispatcher", "bindings": ["GA4_API_SECRET_*", "META_CAPI_TOKEN_*"] },
  "sync_brevo_segments":        { "worker": "funnel-dispatcher", "binding": "BREVO_API_KEY" }
}
```

Mapeamento canônico `event_type -> funnelStage` (ordenado por `funnelStages.order`):

| funnelStage      | event_type                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `AWARENESS`      | `PAGE_VIEW`                                                                                                           |
| `CONSIDERATION`  | `SECTION_VIEW`, `SECTION_ENGAGED`, `CTA_CLICK`, `BUTTON_CLICK`, `PRECHECKOUT_FORM_STARTED`, `PRECHECKOUT_FORM_PROGRESS`, `GENERATE_LEAD` |
| `CONVERSION`     | `PRECHECKOUT_SUBMIT_SUCCESS`, `PRECHECKOUT_SUBMIT_ERROR`, `SIGN_UP`, `BEGIN_CHECKOUT`, `PURCHASE_OUT_OF_SHOPPING_CART` |
| `PURCHASE`       | `PURCHASE_APPROVED`                                                                                                   |
| `ACTIVATION`     | `FIRST_USE`                                                                                                           |
| `RETENTION`      | `RENEWAL`, `REENGAGEMENT`                                                                                             |

Regra de catálogo: cada item em `products.<PRODUCT_CODE>.funnelEventArchitecture.events[]` deve carregar `funnelStage` e a lista deve ser apresentada nesta ordem de estágio.

### 1A. Governança Brevo no catálogo (componentes e operação)

O catálogo deve explicitar, por produto, quais componentes do Brevo estão em uso e como são operados:

- `lists` (listas de entrada/segmentação)
- `templates` (templates de email por finalidade)
- `templates[*].localFile` (arquivo HTML local versionado no repo)
- `transactionalEmails` (template + gatilho de evento de funil)
- `segments` (segmentos operacionais usados por marketing/CRM)
- `automations` (fluxos, condição de entrada e ações esperadas)

Modelo operacional definido:

- `managedVia: manual_dashboard`
- `apiManaged: false`

Ou seja, criação/edição de listas, segmentos, templates e automações acontece manualmente no painel Brevo.  
O catálogo versionado no repositório é o **source-of-truth documental e de integração** (IDs, nomes, finalidade, gatilhos e comportamento esperado).

Estrutura mínima recomendada por produto:

```jsonc
"brevo": {
  "opsModel": {
    "managedVia": "manual_dashboard",
    "apiManaged": false,
    "owner": "marketing_ops",
    "lastReviewedAt": "2026-04-22"
  },
  "lists": { ... },
  "templates": { ... },
  "transactionalEmails": [
    {
      "key": "doi",
      "templateId": "10",
      "triggerEvent": "GENERATE_LEAD",
      "managedVia": "manual_dashboard"
    }
  ],
  "segments": [
    {
      "key": "planovoo_precheckout_leads",
      "id": "",
      "managedVia": "manual_dashboard"
    }
  ],
  "automations": [
    {
      "key": "planovoo_precheckout_nurture",
      "entryCondition": "...",
      "expectedActions": ["..."],
      "managedVia": "manual_dashboard"
    }
  ]
}
```

Regras de mudança:

1. Alteração no Brevo (manual) exige atualização no catálogo no mesmo PR.
2. IDs vazios (`id: ""`) são permitidos provisoriamente, mas devem virar obrigatórios antes de produção.
3. `heartbeat` deve validar coerência mínima (campos obrigatórios e referência de `triggerEvent` para eventos existentes no catálogo).
4. Template transacional usado em produção deve existir localmente em `backend/cloudflare/config/email-templates/`.
5. Alteração de HTML local exige sincronização manual no painel Brevo e atualização de `version` no catálogo.

Para consulta operacional rápida por produto, usar a seção:

- `products.<PRODUCT_CODE>.funnelEventArchitecture`

Essa seção consolida:

- sistemas usados no trilho orientado a eventos (`ingress`, `dispatcher`, `queue`, `state`, `observability`)
- mapa de eventos de funil (`eventType -> delivery -> chain -> destinations`)
- referências de configuração por destino (ex.: Brevo templates/listas e tracking por produto)

Por produto, `events[]` com schema completo:

```jsonc
// Evento server_queue (transição de funil)
{
  "funnelStage": "CONSIDERATION",
  "eventType": "GENERATE_LEAD",
  "delivery": "both",
  "source": "site",
  "payload": {
    "required": ["email", "product_code", "landing_slug"],
    "optional": [
      "anonymous_id",
      "session_id",
      "last_section_viewed",
      "most_section_engaged",
      "utm_source",
      "utm_campaign",
      "fbp",
      "fbc",
      "gclid",
      "wbraid",
      "gbraid"
    ]
  },
  "clientSide": { "gtm_web": "generate_lead", "sgtm": { "ga4": "generate_lead", "metaCapi": "Lead" } },
  "chain": ["resolve_identity", "upsert_event_store", "send_brevo_doi", "update_brevo_funnel", "emit_tracking", "sync_brevo_segments"],
  "expectedResult": { "brevoAttr": "{PREFIX}_FUNIL_LAST_STEP=GENERATE_LEAD", "sla_ms": 5000 }
},
// Evento gtm_web_only (engajamento)
{
  "funnelStage": "CONSIDERATION",
  "eventType": "SECTION_ENGAGED",
  "delivery": "gtm_web_only",
  "source": "site",
  "clientSide": { "gtm_web": "section_engaged", "sgtm": { "ga4": "section_engaged" } },
  "payload": { "required": ["section_id", "time_visible_ms"] }
},
// Evento gtm_web_only (pré-submit)
{
  "funnelStage": "CONSIDERATION",
  "eventType": "PRECHECKOUT_FORM_STARTED",
  "delivery": "gtm_web_only",
  "source": "site",
  "clientSide": { "gtm_web": "precheckout_form_started", "sgtm": { "ga4": "precheckout_form_started", "metaCapi": "InitiateCheckout" } },
  "payload": {
    "required": ["anonymous_id", "session_id", "landing_slug"],
    "optional": ["last_section_viewed", "most_section_engaged", "fbp", "fbc", "gclid"]
  }
}
```

Nota: `api-funnel-ingress` valida de forma síncrona apenas regras locais (schema, antifraude básico, dedupe por `anonymous_id`/`email_hash` no Identity Graph/Event Store) e retorna rápido ao browser. O DOI passa a ser disparado por `send_brevo_doi` no `funnel-dispatcher`, com retry/DLQ, sem bloquear UX.

### 2. Tipo `FunnelEvent` e `EventNormalizer` — packages/shared

Em `backend/cloudflare/packages/shared/src/`:

**`funnel-event.ts`** — tipo TypeScript `FunnelEvent` (interface exportada, usada por todos os workers).

**`event-normalizer.ts`** — dois adaptadores:

- `fromHotmartWebhook(raw, productCode): FunnelEvent`
- `fromPrecheckoutForm(body, productCode): FunnelEvent`
- `fromAppEvent(body, productCode): FunnelEvent` (para Fase 2)
- `fromBrowserTracking(body, productCode): FunnelEvent` (para eventos de identidade/sessão, quando necessário em `both`)

Ambos os workers de ingress importam daqui.

### 3. Workers de ingress — normalizar e enfileirar

**`api-hotmart-ingress`**:

- Recebe webhooks Hotmart.
- Normaliza para `FunnelEvent` via `fromHotmartWebhook()`.
- Publica em `decole-q-funnel-events`.

**`api-funnel-ingress`**:

- Recebe eventos de precheckout e eventos server-side do site/app.
- Resolve/captura `anonymous_id`, `session_id`, `fbp`, `fbc`, `gclid`, `wbraid`, `gbraid` (cookie/query/body).
- Valida regras locais no Identity Graph/Event Store (síncrono).
- Normaliza para `FunnelEvent`, enfileira em `decole-q-funnel-events` e retorna `202`.

**`funnel-dispatcher`**:

- Consome `decole-q-funnel-events`.
- Executa a chain declarada no catálogo (`send_brevo_doi`, `update_brevo_funnel`, `emit_tracking`, etc).

### 5A. Identity Graph + Event Store (novo componente)

Para suportar segmentação independente de Brevo:

- `resolve_identity` mantém um grafo mínimo de vínculos:
  - `anonymous_id -> profile_id`
  - `lead_id -> profile_id`
  - `email_hash -> profile_id`
- `upsert_event_store` grava o `FunnelEvent` indexado por `profile_id` (ou `anonymous_id` quando ainda não houver stitch).
- `sync_brevo_segments` projeta segmentos calculados no store central para atributos/listas no Brevo.

Persistência sugerida:

- **Cloudflare D1** para `event_store` e `identity_links` (consulta por período/segmento).
- **KV** apenas para lookup rápido (`anonymous_id -> profile_id`) e cache de curta duração.

Regras de privacidade (LGPD) no design:

- `email` em texto claro apenas no momento estritamente necessário para integrações (Brevo/Meta CAPI); no store analítico usar `email_hash`.
- TTL explícito para dados de sessão anônima e política de retenção por tipo de evento.
- Consentimento de marketing deve governar envio de `fbp`/`fbc` e ativação de CAPI.

### 4. Queues — provisionamento greenfield

Provisionar do zero:

- `decole-q-funnel-events` (fila principal canônica).
- `decole-q-funnel-events-dlq` (DLQ da principal).
- (Opcional) filas dedicadas por destino em fase seguinte (`decole-q-destination-brevo`, `decole-q-destination-tracking`).

Não há estratégia de convivência com filas legadas neste plano.

Automação incremental proposta:

1. Planejar recursos (sem chamadas API):
   `backend/cloudflare/scripts/provision-greenfield-resources.sh`
2. Provisionar via API (idempotente):
   `backend/cloudflare/scripts/provision-greenfield-resources.sh --apply`
3. Aplicar IDs reais nos bindings do dispatcher:
   `backend/cloudflare/scripts/apply-greenfield-bindings.sh`

Artefatos:

- manifesto versionado: `backend/cloudflare/config/cloudflare-greenfield.resources.json`
- IDs gerados por ambiente (não versionados): `backend/cloudflare/config/generated/cloudflare-greenfield.ids.json`

### 5. EventDispatcher genérico — funnel-dispatcher

Refatorar o consumer de switch hardcoded para dispatcher guiado por catálogo:

```ts
// Pseudo-código
const chain = catalog.getEventChain(event.event_type, event.product_code);
for (const handlerName of chain) {
  const dedupeKey = `${event.event_id}:${handlerName}`;
  if (await kv.get(dedupeKey)) continue; // já executou
  await handlers[handlerName](event, env);
  await kv.put(dedupeKey, "1", { expirationTtl: 90 * 86400 });
}
```

Handlers tornam-se funções puras em `src/handlers/`:

- `resolve-identity.ts`
- `upsert-event-store.ts`
- `send-brevo-doi.ts`
- `update-brevo-funnel.ts`
- `send-cart-abandonment-email.ts`
- `forward-n8n.ts`
- `emit-tracking.ts`
- `sync-brevo-segments.ts`

O dispatcher lê o catálogo via `CATALOG_JSON` binding (KV ou env var com o JSON serializado) ou importa diretamente como módulo.

### 6. Heartbeat via GitHub Action

Script `scripts/heartbeat.mjs` com subcomandos (Node ESM, zero deps):

- `validate-catalog` — JSON-schema `scripts/schema/catalog.v3.schema.json` (valida `events[].chain[]` referencia handlers declarados em `handlers{}`).
- `validate-brevo-catalog` — valida estrutura `products[*].brevo` (`opsModel`, `transactionalEmails`, `segments`, `automations`), `triggerEvent` apontando para eventos válidos e existência dos arquivos `templates[*].localFile`.
- `validate-workers` — parseia `wrangler.toml` de cada worker e exige que bindings referenciem entradas em `catalog.workerViews`.
- `validate-events-in-code` — grep em `src/handlers/` para cada handler declarado em `handlers{}`.
- `validate-landing-gtm` — IDs GTM Web/sGTM/GA4/Meta Pixel nos HTMLs batem com `catalog.landingPages[*]`; para eventos `gtm_web_only` e `both`, confere que cada `clientSide.gtm_web` declarado no catálogo aparece no `dataLayer.push()` das landings correspondentes.
- `regen-diagrams` — falha se `diagramas/generated/` tem drift vs catálogo atual.

`.github/workflows/heartbeat.yml` roda em todo PR, bloqueia merge se falhar.

### 7. Geração de diagramas

`scripts/gen-diagrams.mjs` lê o catálogo e gera em `diagramas/generated/`:

- `journey-{produto}.puml` — jornada × evento × sistema por produto.
- `funnel-chain-{produto}.puml` — chains por event_type.
- `funnel-matrix.puml` — todos os produtos × stages.

O `DIAGRAMA_COMPONENTES_FUNIL_EVENTOS.puml` (alvo do usuário) permanece **hand-edited** como especificação de arquitetura de componentes. Os gerados são complementares (jornada do cliente, chains operacionais).

### 8. Centralização de tracking server-side (Hotmart → `emit_tracking`)

**Problema atual**: cada produto Hotmart tem sua própria configuração de **Propriedade GA4** e **Pixel Meta** dentro do admin Hotmart. Isso significa:

- Config duplicada em 3 lugares (Hotmart product, landing page, sGTM).
- Drift frequente (trocar Pixel exige editar 3 sistemas).
- Tracking de checkout/purchase fica fora do controle do repo (auditar = abrir painel Hotmart).
- Sem controle sobre `user_data` que sai para Meta (match rate baixo).
- Impossível deduplicar com eventos client-side via `event_id` porque Hotmart gera seus próprios.

**Alvo**: um único webhook Hotmart por produto (já existe — o que muda é o que fazemos com ele). A config de GA4 property e Meta Pixel é **removida do admin Hotmart** e passa a viver no catálogo. O handler `emit_tracking`, rodando no consumer, envia server-side:

- **GA4 Measurement Protocol** — `POST https://www.google-analytics.com/mp/collect?measurement_id=...&api_secret=...` com `client_id` (capturado na landing e propagado via UTM/affiliate_id para Hotmart → volta no webhook) e `events[{ name: 'purchase', params: { value, currency, transaction_id } }]`.
- **Meta Conversions API** — `POST https://graph.facebook.com/v18.0/{pixel_id}/events?access_token=...` com `user_data` SHA-256 (`em`, `ph`, `external_id`) e `fbp`/`fbc` se propagados via UTM/buyer_checkout_params.

**Config do catálogo por produto**:

```jsonc
"products": {
  "DECOLE_ESG_MENTORIA": {
    "tracking": {
      "ga4": {
        "measurement_id": "G-XXXXXXXX",
        "api_secret_binding": "GA4_API_SECRET_ESG"
      },
      "meta": {
        "pixel_id": "1234567890",
        "access_token_binding": "META_CAPI_TOKEN_ESG",
        "test_event_code": "TEST12345"     // só em staging
      }
    }
  }
}
```

**Config por evento** (no catálogo):

```jsonc
{
  "funnelStage": "PURCHASE",
  "eventType": "PURCHASE_APPROVED",
  "emit_tracking": {
    "ga4_event": "purchase",
    "meta_event": "Purchase",
    "value_from": "payload.transaction.price.value",
    "currency_from": "payload.transaction.price.currency_value",
    "transaction_id_from": "payload.transaction.transaction",
  },
}
```

**`client_id` / `fbp` / `fbc` propagation**:

- Captura no primeiro touch (landing): `client_id` (GA4 `_ga` cookie) + `fbp` + `fbc` são lidos via browser e persistidos em cookie first-party + enviados para `api-funnel-ingress`.
- Propagação para Hotmart: incluir nos parâmetros de checkout (`src`/`sck` ou custom params via query string do checkout link). Hotmart preserva nos webhooks.
- Na ausência (tráfego direto para checkout), fazer match por `buyer.email` via lookup no Brevo (contato já teve `generate_lead` com `client_id` registrado como atributo).

**Deduplicação**:

- `event_id` do `FunnelEvent` vai no payload GA4 MP e no `event_id` do Meta CAPI.
- Se o Pixel client-side disparar também (no caso de `both`), Meta dedupa via `event_id`. Para `server_queue` (Hotmart), só o CAPI dispara — sem risco de dupla contagem.

**Checklist de configuração alvo (no Hotmart admin)**:

- [ ] Remover "Propriedade GA4" de cada produto.
- [ ] Remover "Pixel Meta" de cada produto.
- [ ] Remover tags de conversão Google Ads configuradas no produto (se houver — migrar para o mesmo handler `emit_tracking` via Google Ads API ou manter no sGTM).
- [ ] Validar que landing pages continuam passando `client_id`/`fbp`/`fbc` para o checkout Hotmart via query string.

**Risco & mitigação**:

- Se o consumer cair, perde-se tracking → DLQ + alerta + replay script (`scripts/replay-dlq.mjs`) permitem reprocessar sem perda.
- GA4 MP tem limite de 25 events/request e 500 events/sec por propriedade — dispatcher já é single-event, não há risco.
- Meta CAPI rejeita eventos > 7 dias — retry com exponential backoff cap de 24h no consumer (já é o default do Queues).

### 9. Ingress de app events (contrato — sem implementação no app agora)

Nova rota em `api-funnel-ingress`: `POST /webhooks/v1/planovoo/app/event`, autenticada por HMAC (`APP_EVENTS_HMAC`). Usa `fromAppEvent()` do normalizer. Enfileira para `decole-q-funnel-events`. Handler chain no catálogo: `[update_brevo_funnel, emit_tracking]`.

O repo `decole-plano-de-voo-app` implementará o `track()` client em trabalho separado.

### 10. Camada única de observabilidade (logs integrados)

Objetivo: consultar logs de todos os workers em um único plano de observabilidade, com correlação ponta a ponta por `event_id`/`profile_id`.

#### 10.1 Padrão obrigatório de log estruturado (JSON)

Todos os workers devem emitir `console.log()`/`console.error()` em JSON com estes campos mínimos:

- `ts` (ISO datetime)
- `level` (`info` | `warn` | `error`)
- `service` (`api-hotmart-ingress` | `api-funnel-ingress` | `funnel-dispatcher`)
- `env` (`staging` | `production`)
- `request_id`
- `event_id` (quando houver)
- `profile_id` (quando houver stitch)
- `product_code`
- `event_type`
- `handler` (quando aplicável)
- `attempt` (retry atual)
- `duration_ms`
- `status` (`ok` | `error` | `skipped`)
- `error_code`/`error_message` (somente em falha)

Regra de segurança: nunca logar email/phone em texto claro; usar apenas `email_hash` e IDs técnicos.

#### 10.2 Configuração mínima no Wrangler (todos os workers)

Cada worker deve ter observabilidade habilitada:

```toml
[observability]
enabled = true
head_sampling_rate = 1

[observability.logs]
invocation_logs = true
```

Para produção de alto volume, reduzir `head_sampling_rate` de forma controlada (ex.: `0.2`) mantendo 100% em staging.

#### 10.3 Consulta integrada no Cloudflare (curto prazo)

- Usar **Workers Logs + Query Builder** como console único de operação.
- Salvar consultas padrão por correlação:
  - `by_event_id`
  - `by_profile_id`
  - `errors_by_handler`
  - `dlq_candidates`
  - `p95_duration_by_handler`

#### 10.4 Retenção longa e histórico (médio/longo prazo)

- Habilitar **Workers Logpush** para exportar logs para destino único:
  - Preferencial: `R2` (bucket dedicado de observabilidade).
  - Alternativo: provedor externo (Datadog, Splunk, etc).
- Estratégia recomendada:
  - Cloudflare Query Builder para investigação operacional diária.
  - `Logpush -> R2` para retenção, auditoria e análises históricas.

#### 10.5 Alertas operacionais mínimos

Definir alertas para:

- erro por handler acima de limiar (5xx ou `status=error`)
- crescimento da DLQ por janela de tempo
- falha contínua em `send_brevo_doi` e `emit_tracking`
- aumento anormal de latência (`p95 duration_ms`) por worker/handler

#### 10.6 Artefatos de implementação

- `backend/cloudflare/packages/shared/src/observability/log.ts` (helper único de logs)
- `backend/cloudflare/config/observability/QUERY_LIBRARY.md` (queries salvas e padrões de investigação)
- `backend/cloudflare/config/observability/LOG_SCHEMA.md` (contrato de campos obrigatórios)

### 11. Estratégia de testes automatizados

Objetivo: garantir regressão baixa no pipeline de eventos, com cobertura em contrato, regras de negócio, integrações e resiliência.

#### 11.1 Testes unitários (rápidos, obrigatórios)

Cobrir:

- `packages/shared/event-normalizer` (mapeamento de payloads para `FunnelEvent`)
- `funnel-dispatcher/dispatcher` (resolução de chain, ordem, idempotência)
- handlers puros (`resolve_identity`, `send_brevo_doi`, `emit_tracking`, etc) com dependências mockadas
- utilitários críticos (`user-data` hashing, validação de schema, parser de UTM/cookies)

Meta mínima recomendada:

- 85%+ de cobertura em `packages/shared`
- 80%+ de cobertura em `workers/funnel-dispatcher/src/handlers`

#### 11.1A Organização de testes em pastas `test/` (padrão obrigatório)

Padronizar organização para reduzir acoplamento e facilitar manutenção:

- cada pacote/worker mantém sua própria pasta `test/`
- separar por tipo dentro de `test/`: `unit/`, `integration/`, `e2e/`
- fixtures compartilhadas ficam em `backend/cloudflare/tests/fixtures/`

Estrutura alvo:

```text
backend/cloudflare/packages/shared/
  src/
  test/
    unit/
      event-normalizer.test.ts

backend/cloudflare/workers/api-hotmart-ingress/
  src/
  test/
    unit/
      index.test.ts
    integration/
      ingress-queue.test.ts

backend/cloudflare/workers/api-funnel-ingress/
  src/
  test/
    unit/
      index.test.ts
    integration/
      precheckout-flow.test.ts

backend/cloudflare/workers/funnel-dispatcher/
  src/
  test/
    unit/
      dispatcher.test.ts
      handlers.test.ts
    integration/
      queue-processing.test.ts
    e2e/
      staging-smoke.test.ts
```

Regras:

- testes unitários não devem depender de rede/serviços externos
- testes de integração podem usar bindings/stubs locais
- testes E2E ficam no script/workflow dedicado (`e2e-funnel-staging.sh` + CI manual)

#### 11.2 Testes de contrato (catálogo e schema)

Automatizar validações:

- `products.catalog.json` contra `catalog.v3.schema.json`
- `handlers` declarados no catálogo existem fisicamente em `src/handlers`
- `events[].chain[]` só referencia handlers válidos
- `payload.required` de eventos críticos (`GENERATE_LEAD`, `PURCHASE_APPROVED`) compatível com normalizers

Executado em PR via `scripts/heartbeat.mjs`.

#### 11.3 Testes de integração (worker + bindings locais)

Executar com `wrangler dev`/ambiente local:

- ingress (`api-hotmart-ingress`, `api-funnel-ingress`) -> queue `decole-q-funnel-events`
- `funnel-dispatcher` consumindo lote e gravando em D1/KV
- cenário de dedupe por `event_id:handler`
- cenário de retry e envio para DLQ em falha forçada

Usar fixtures versionadas em `tests/fixtures/`:

- `purchase_approved.json`
- `purchase_out_of_shopping_cart.json`
- `generate_lead.json`
- `app_event.json`

#### 11.4 Testes end-to-end automatizados (staging)

Pipeline agendado e/ou pós-deploy:

- dispara webhook Hotmart de teste
- envia evento de precheckout
- valida efeitos esperados:
  - atributos no Brevo
  - evento no GA4 DebugView (ou endpoint de validação)
  - evento no Meta Test Events (`test_event_code`)
  - ausência de duplicidade em reenvio do mesmo `event_id`

#### 11.5 Testes de resiliência e caos controlado

Automatizar cenários:

- token inválido em destino externo (`emit_tracking`) gera DLQ sem quebrar demais handlers
- indisponibilidade temporária de Brevo (`send_brevo_doi`) com retry/backoff
- replay de DLQ reprocessa somente handlers pendentes
- latência alta em integração externa não bloqueia ingestão

#### 11.6 Testes de performance básica

Suite leve (pré-produção):

- throughput do dispatcher (mensagens/segundo)
- p95 de `duration_ms` por handler
- taxa de erro sob carga moderada

Definir budget inicial:

- p95 handler crítico (`emit_tracking`) < 400ms em cenário nominal
- erro total < 1% em carga de referência

#### 11.7 Gates de CI recomendados

Obrigatórios em PR:

- lint + typecheck
- unit tests
- contract tests (`heartbeat`)
- integração local mínima (smoke)

Obrigatórios em merge para `main`:

- e2e staging smoke
- geração de diagramas sem drift

Sugestão de workflows:

- `.github/workflows/ci-unit-contract.yml`
- `.github/workflows/ci-integration.yml`
- `.github/workflows/ci-e2e-staging.yml`

## Arquivos

**Modificar**

- `backend/cloudflare/config/products.catalog.json` — schema alvo com events/chains/handlers/stages do modelo greenfield
- `AGENTS.MD` — referenciar heartbeat e gen-diagrams; adicionar seção "Contrato para qualquer AI agent" (onboarding idempotente: ler catálogo → rodar heartbeat → consultar diagramas gerados)
- `ACESSOS_AGENTES_AI.md` — mover bloco "Estado Verificado" para gerado

**Criar**

- `backend/cloudflare/packages/shared/src/funnel-event.ts`
- `backend/cloudflare/packages/shared/src/event-normalizer.ts`
- `backend/cloudflare/workers/api-hotmart-ingress/src/index.ts`
- `backend/cloudflare/workers/api-hotmart-ingress/wrangler.toml`
- `backend/cloudflare/workers/api-funnel-ingress/src/index.ts`
- `backend/cloudflare/workers/api-funnel-ingress/wrangler.toml`
- `backend/cloudflare/workers/funnel-dispatcher/src/index.ts`
- `backend/cloudflare/workers/funnel-dispatcher/wrangler.toml`
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/update-brevo-funnel.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/send-cart-abandonment-email.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/forward-n8n.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/emit-tracking.ts` (GA4 MP + Meta CAPI)
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/resolve-identity.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/upsert-event-store.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/send-brevo-doi.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/sync-brevo-segments.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/tracking/ga4-mp.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/tracking/meta-capi.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/tracking/user-data.ts` (hash SHA-256 email/phone)
- `backend/cloudflare/workers/funnel-dispatcher/src/identity/identity-graph.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/store/event-store.ts`
- `scripts/replay-dlq.mjs`
- `backend/cloudflare/workers/funnel-dispatcher/src/dispatcher.ts`
- `backend/cloudflare/packages/shared/src/observability/log.ts`
- `scripts/heartbeat.mjs`
- `scripts/gen-diagrams.mjs`
- `scripts/schema/catalog.v3.schema.json`
- `backend/cloudflare/config/observability/QUERY_LIBRARY.md`
- `backend/cloudflare/config/observability/LOG_SCHEMA.md`
- `backend/cloudflare/config/email-templates/README.md`
- `backend/cloudflare/config/email-templates/decole-esg/doi-v1.html`
- `backend/cloudflare/config/email-templates/decole-esg/cart-abandonment-v1.html`
- `backend/cloudflare/config/email-templates/planovoo/doi-v1.html`
- `backend/cloudflare/tests/fixtures/purchase_approved.json`
- `backend/cloudflare/tests/fixtures/purchase_out_of_shopping_cart.json`
- `backend/cloudflare/tests/fixtures/generate_lead.json`
- `backend/cloudflare/tests/fixtures/app_event.json`
- `backend/cloudflare/packages/shared/test/unit/`
- `backend/cloudflare/workers/api-hotmart-ingress/test/unit/`
- `backend/cloudflare/workers/api-hotmart-ingress/test/integration/`
- `backend/cloudflare/workers/api-funnel-ingress/test/unit/`
- `backend/cloudflare/workers/api-funnel-ingress/test/integration/`
- `backend/cloudflare/workers/funnel-dispatcher/test/unit/`
- `backend/cloudflare/workers/funnel-dispatcher/test/integration/`
- `backend/cloudflare/workers/funnel-dispatcher/test/e2e/`
- `backend/cloudflare/scripts/deploy-incremental.sh`
- `backend/cloudflare/scripts/healthcheck-worker.sh`
- `backend/cloudflare/scripts/provision-greenfield-resources.sh`
- `backend/cloudflare/scripts/apply-greenfield-bindings.sh`
- `backend/cloudflare/scripts/apply-d1-schema.sh`
- `backend/cloudflare/scripts/e2e-funnel-staging.sh`
- `backend/cloudflare/config/RUNBOOK_CUTOVER_FUNNEL.md`
- `backend/cloudflare/config/cloudflare-greenfield.resources.json`
- `backend/cloudflare/config/generated/.gitkeep`
- `.github/workflows/deploy-incremental-hotmart-ingress.yml`
- `.github/workflows/ci-unit-contract.yml`
- `.github/workflows/ci-integration.yml`
- `.github/workflows/ci-e2e-staging.yml`
- `.github/workflows/heartbeat.yml`
- `diagramas/generated/` (produzido por gen-diagrams)

## Roteiro incremental (implantação com agentes)

### 12.1 Modelo operacional com agentes

Trabalhar por lotes pequenos, cada lote com escopo fechado e gate de aceite antes do próximo:

- **Agente A (Core)**: `FunnelEvent`, normalizers, catálogo/schema.
- **Agente B (Ingress)**: `api-hotmart-ingress` e `api-funnel-ingress`.
- **Agente C (Dispatcher)**: `funnel-dispatcher`, chain runner, dedupe, DLQ.
- **Agente D (Destinos)**: Brevo, GA4 MP, Meta CAPI, n8n.
- **Agente E (Qualidade)**: heartbeat, testes, e2e, observabilidade.

Regra de coordenação:

1. Cada agente entrega PR pequeno e testável.
2. Nenhuma fase avança sem gate E2E da fase anterior.
3. Mudanças de catálogo e código devem andar no mesmo PR quando houver dependência.

### 12.2 Fases e gates (go/no-go)

| Fase | Agentes principais | Entrega incremental | Gate obrigatório (E2E) |
| --- | --- | --- | --- |
| **F0.1 — Delivery Baseline** | B + E | Definir estratégia de deploy incremental (piloto) + scripts/workflow de entrega | deploy piloto em staging com rollback testado |
| **F0.2 — Baseline Operacional** | A + E | Congelar estado atual, fixtures e smoke tests remotos funcionando | smoke atual verde (`api-precheckout`, webhook ingest) |
| **F1 — Core Contract** | A | `FunnelEvent`, schema v3, catálogo com `events/handlers/chain` | `validate-catalog` + `validate-events-in-code` verdes |
| **F2 — Ingress Greenfield** | B + C | `api-hotmart-ingress`, `api-funnel-ingress`, queue `decole-q-funnel-events` e DLQ | POST de fixture retorna `202` e mensagem chega ao dispatcher |
| **F3 — Dispatcher + Dedupe** | C | execução ordered da chain + `event_id:handler` | reenvio mesmo `event_id` gera `skipped` sem duplicar efeitos |
| **F4 — Destinos mínimos** | D | `update_brevo_funnel`, `send_brevo_doi`, `forward_n8n` | lead real de staging atualiza Brevo e DOI entregue |
| **F5 — Tracking server-side** | D + E | `emit_tracking` (GA4/Meta), observabilidade de handler | evento aparece em GA4 DebugView e Meta Test Events |
| **F6 — Identity Graph** | A + D | `resolve_identity`, `upsert_event_store`, stitch anon->email | evento pré-submit e pós-submit no mesmo `profile_id` |
| **F7 — Cutover** | B + C + E | rotas finais, deprecar legado, runbook | suíte E2E completa 2x consecutivas sem regressão |

### 12.3 Plano de execução sugerido por sprint

1. **Sprint 1**: F0.1 + F0.2 + F1 + F2 (pipeline canônico no ar sem efeitos externos críticos).
2. **Sprint 2**: F3 + F4 (funil operacional com Brevo/n8n).
3. **Sprint 3**: F5 + F6 (tracking robusto + identidade unificada).
4. **Sprint 4**: F7 (cutover e estabilização assistida por observabilidade).

### 12.4 Definição de pronto por fase

- código + testes + documentação da fase no mesmo merge
- dashboards/queries mínimas atualizadas quando a fase mexer com observabilidade
- rollback documentado (como desativar rota/handler recém-introduzido)

## Verificação E2E por fase

### F0.1 (delivery piloto)

1. Executar deploy incremental do worker piloto (`api-hotmart-ingress`) via script/workflow manual.
2. Validar healthcheck pós-deploy.
3. Validar rollback (redeploy da versão estável anterior ou branch de controle).

### F0.2/F1 (contrato)

1. `node scripts/heartbeat.mjs validate-catalog` -> `0`.
2. `node scripts/heartbeat.mjs validate-events-in-code` -> `0`.
3. alterar chain inválida propositalmente em branch de teste -> CI falha.

### F2/F3 (ingress + dispatcher)

1. `curl -X POST $API_HOTMART_INGRESS/webhooks/v1/planovoo/hotmart/purchase` com `PURCHASE_APPROVED.json` -> `202`.
2. dispatcher executa `update_brevo_funnel` e `forward_n8n`.
3. reenvio do mesmo `event_id` -> log `skipped (dedupe)` para handler já concluído.
4. `PURCHASE_OUT_OF_SHOPPING_CART` -> `send_cart_abandonment_email` executa e `forward_n8n` não executa.

### F4 (Brevo)

1. submit precheckout em staging (`api-funnel-ingress`) -> resposta rápida.
2. queue recebe `GENERATE_LEAD`.
3. dispatcher executa `send_brevo_doi` + `update_brevo_funnel`.
4. DOI chega e atributo de funil é atualizado.

### F5 (tracking)

1. `PURCHASE_APPROVED` dispara `emit_tracking`.
2. GA4 DebugView mostra `purchase` com `value/currency/transaction_id`.
3. Meta Test Events mostra `Purchase` com `event_id` e `user_data` válidos.
4. falha forçada de token Meta -> apenas `emit_tracking` vai para DLQ.

### F6 (identidade)

1. enviar `precheckout_form_started` e `precheckout_form_progress` com mesmo `anonymous_id`.
2. enviar `GENERATE_LEAD` com email.
3. `resolve_identity` cria vínculo `anonymous_id -> email_hash -> profile_id`.
4. consultas no `event_store` mostram eventos pré e pós-submit no mesmo perfil.

### F7 (cutover final)

1. suíte completa F2..F6 executada 2 vezes seguidas em staging.
2. p95 de handlers críticos dentro do budget definido.
3. DLQ sem crescimento anômalo por 24h após cutover.
