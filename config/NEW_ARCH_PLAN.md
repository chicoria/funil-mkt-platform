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
  - modo Preview/Test no GTM Server para validar GA4/Meta sem alterar produção
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
- **`server_queue`** — evento é normalizado para `FunnelEvent`, enfileirado e dispatchado. Atualiza Brevo, dispara n8n. Uso: redirects de checkout (`BEGIN_CHECKOUT` emitido pelo `links-redirect`), webhooks Hotmart (`PURCHASE_*`) e eventos de app.
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
| `GENERATE_LEAD`                 | `both`                   | `[resolve_identity, upsert_event_store, send_brevo_doi, update_brevo_funnel, sync_brevo_segments]` |
| `PRECHECKOUT_SUBMIT_SUCCESS`    | `both`                   | `[resolve_identity, upsert_event_store, send_brevo_doi, update_brevo_funnel, sync_brevo_segments]` |
| `PRECHECKOUT_SUBMIT_ERROR`      | `gtm_web_only`           | —                                                                   |
| `SIGN_UP`                       | `both`                   | `[resolve_identity, upsert_event_store, update_brevo_funnel]`       |
| `BEGIN_CHECKOUT`                | `server_queue` (`links-redirect`) | `[resolve_identity, upsert_event_store, enrich_attribution, update_brevo_funnel, emit_tracking]` |
| `PURCHASE_OUT_OF_SHOPPING_CART` | `server_queue`           | `[resolve_identity, upsert_event_store, update_brevo_funnel, send_cart_abandonment_email]` |
| `PURCHASE_APPROVED`             | `server_queue`           | `[resolve_identity, upsert_event_store, enrich_attribution, update_brevo_funnel, emit_tracking, forward_n8n]` |

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
  "enrich_attribution":          { "worker": "funnel-dispatcher", "binding": "EVENT_STORE_DB", "note": "Recupera fbp/fbc/client_ip do evento site mais recente do mesmo profile_id; só preenche campos ausentes" },
  "send_brevo_doi":              { "worker": "funnel-dispatcher", "binding": "BREVO_API_KEY" },
  "update_brevo_funnel":        { "worker": "funnel-dispatcher", "binding": "BREVO_API_KEY" },
  "send_cart_abandonment_email":{ "worker": "funnel-dispatcher", "binding": "BREVO_API_KEY" },
  "forward_n8n":                { "worker": "funnel-dispatcher", "binding": "N8N_WEBHOOK_URL" },
  "emit_tracking":              { "worker": "funnel-dispatcher", "bindings": ["SGTM_ENDPOINT_URL", "SGTM_ENDPOINT_URL_*"] },
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

### 1A. Mapeamento canônico -> analytics (GA4/Meta)

Tabela única para operação e QA E2E, refletindo o comportamento atual (`funnel-dispatcher` + catálogo das LPs):

| event_type                      | delivery         | GA4 event_name                     | Meta event_name                  | status |
| ------------------------------ | ---------------- | ---------------------------------- | -------------------------------- | ------ |
| `PAGE_VIEW`                    | `gtm_web_only`   | `page_view`                        | `PageView`                       | oficial |
| `BUTTON_CLICK`                 | `gtm_web_only`   | `button_click`                     | `button_click`                   | custom |
| `CTA_CLICK`                    | `gtm_web_only`   | `cta_click`                        | `cta_click`                      | custom |
| `GENERATE_LEAD`                | `both`           | `generate_lead`                    | `Lead`                           | oficial |
| `SIGN_UP`                      | `both`           | `sign_up`                          | `CompleteRegistration`           | oficial |
| `BEGIN_CHECKOUT`               | `server_queue` + GTM click | `begin_checkout`            | `InitiateCheckout`               | oficial |
| `PURCHASE_OUT_OF_SHOPPING_CART`| `server_queue`   | —                                  | —                                | sem emit_tracking (dedup com BEGIN_CHECKOUT) |
| `PURCHASE_APPROVED`            | `server_queue`   | `purchase`                         | `Purchase`                       | oficial |

Notas operacionais:

- `BEGIN_CHECKOUT` não vem de webhook Hotmart; é emitido pelo `links-redirect` antes do 302 para a Hotmart. Captura `CF-Connecting-IP` como `client_ip` em `attribution`.
- `PURCHASE_OUT_OF_SHOPPING_CART` **não tem `emit_tracking`**: evita contagem dupla de `InitiateCheckout` na Meta (o `BEGIN_CHECKOUT` já cobre esse momento com o mesmo usuário). Serve apenas para CRM/Brevo e email de abandono de carrinho.
- `PURCHASE_COMPLETE` (Hotmart) deve ser normalizado no ingress para `PURCHASE_APPROVED` antes de entrar na queue canônica.
- GA4 e Meta CAPI continuam roteados pelo sGTM. No caminho server-side, o `funnel-dispatcher` envia para sGTM via `emit_tracking`.
- Eventos `custom` são válidos, mas não entram automaticamente em relatórios padrão de ecommerce; exigem exploração custom em GA4/Meta.

### 1B. Governança Brevo no catálogo (componentes e operação)

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
- referências de configuração por destino (ex.: Brevo templates/listas, n8n e links de checkout)

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
  "chain": ["resolve_identity", "upsert_event_store", "send_brevo_doi", "update_brevo_funnel", "sync_brevo_segments"],
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

**`links-redirect`**:

- Recebe GETs de checkout em `links.decolesuacarreiraesg.com.br/{produto}/checkout`.
- Resolve produto e oferta via `LINKS_PRODUCTS`/catálogo.
- Emite `BEGIN_CHECKOUT` em `decole-q-funnel-events` antes do redirect.
- Retorna `302` para a Hotmart mesmo se a fila estiver temporariamente indisponível.

**`funnel-dispatcher`**:

- Consome `decole-q-funnel-events`.
- Executa a chain declarada no catálogo (`resolve_identity`, `upsert_event_store`, `send_brevo_doi`, `update_brevo_funnel`, etc).

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

- `email` em texto claro apenas no momento estritamente necessário para integrações (Brevo e, quando aplicável, GTM/sGTM no browser); no store analítico usar `email_hash`.
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

### 8. Tracking e estado de funil sem dupla contagem

**Decisão arquitetural**: GA4 e Meta CAPI continuam no trilho **GTM Web -> sGTM**. O `funnel-dispatcher` usa `emit_tracking` para encaminhar eventos server-side para o **sGTM** (e não para GA4/Meta direto). A fila Cloudflare existe para estado de funil, Brevo, n8n, identidade, auditoria e replay operacional.

Isso evita:

- duplicidade entre Pixel/GTM/sGTM e Worker;
- segredos GA4/Meta em múltiplos runtimes;
- drift entre Hotmart, GTM, sGTM e catálogo;
- perda de deduplicação quando o browser já gerou `event_id` para o GTM.

**BEGIN_CHECKOUT**

- A Hotmart não emite webhook operacional `BEGIN_CHECKOUT`.
- O evento canônico `BEGIN_CHECKOUT` é emitido pelo `links-redirect` antes do `302` para a Hotmart.
- A chain Cloudflare é: `[resolve_identity, upsert_event_store, enrich_attribution, update_brevo_funnel, emit_tracking]`.
- O evento analytics equivalente deve ser entregue ao sGTM:
  - GA4: `begin_checkout`
  - Meta: `InitiateCheckout`
- Quando o clique/submit já tiver `event_id`, o `links-redirect` deve reaproveitar esse valor para manter correlação entre analytics e event store.

**Hotmart purchase/cart**

- Webhooks Hotmart entram por `api-hotmart-ingress`.
- `PURCHASE_COMPLETE` deve ser normalizado para `PURCHASE_APPROVED`.
- `PURCHASE_OUT_OF_SHOPPING_CART` alimenta recuperação de carrinho e event store; **não tem `emit_tracking`** (deduplicação com `BEGIN_CHECKOUT`/`InitiateCheckout`).
- `PURCHASE_APPROVED` passa por `enrich_attribution` antes de `emit_tracking` para recuperar `fbp`/`fbc`/`client_ip` do evento site anterior do mesmo usuário.
- O Worker não deve falar GA4/Meta diretamente — sempre via sGTM.

**`update_brevo_funnel`**

- Deve resolver `products.<product_code>.brevo.funnelFields` no catálogo.
- Campos de funil são por produto (ex.: `DECOLE_ESG_FUNIL_*`, `DECOLE_PLANOVOO_FUNIL_*`), não genéricos.
- Se `funnelFields` estiver ausente/inválido para o produto, o handler faz `handler_skip` com motivo explícito.

**`emit_tracking`**

`emit_tracking` é handler padrão para eventos server-side que precisam analytics (`BEGIN_CHECKOUT`, `PURCHASE_APPROVED`). O handler recebe `FunnelEvent` canônico e encaminha para sGTM via `/mp/collect`, resolvendo endpoint por produto via catálogo.

Payload enviado ao sGTM inclui (quando disponíveis): `em` (email hash), `client_ip_address`, `fbp`, `fbc`, `meta_event_name`, `meta_test_event_code`. `PURCHASE_OUT_OF_SHOPPING_CART` **não usa `emit_tracking`** para evitar duplicação de `InitiateCheckout` na Meta.

**Roteamento de clients no sGTM (paths)**

- `GA4 client` (`gaaw_client`): atende tráfego GA4 Web no path `/g/collect`.
- `Measurement Protocol (GA4) client`: atende tráfego MP GA4 nos paths `/mp/collect` e `/debug/mp/collect`.
- `Measurement Protocol` (UA/legado): opcional para `/collect` e `/batch` quando houver necessidade histórica.

**Regra para `client_id` no GA4 MP**

- Requisições para `/mp/collect` devem enviar `client_id` em formato GA4 válido (`digits.digits`).
- O `emit_tracking` e o script de replay normalizam `client_id` quando `anonymous_id`/`event_id` não estiverem nesse formato.
- Evitar `api_secret` em logs de troubleshooting; se houver exposição em query string durante incidentes, rotacionar secret.

**Estado operacional validado (2026-04-27)**

- `Measurement Protocol (GA4)` publicado no sGTM e replay `--apply` funcionando.
- Workspace ativo do container server atualmente: `14` (o `13` ficou obsoleto no setup local).

**Checklist de configuração alvo**

- [ ] Garantir que as landing pages disparam `begin_checkout`/`InitiateCheckout` via GTM Web/sGTM no clique/submit para checkout.
- [ ] Garantir que links para `links-redirect` carregam `event_id`, `anonymous_id`, `session_id`, `fbp`, `fbc`, `gclid` quando disponíveis.
- [ ] Configurar `SGTM_ENDPOINT_URL_*` por produto no `funnel-dispatcher`.
- [ ] Remover dependência de `GA4_API_SECRET_*` e `META_CAPI_ACCESS_TOKEN_*` da operação padrão do `funnel-dispatcher`.
- [ ] Validar que o painel Hotmart não é source-of-truth para GA4/Meta; Hotmart deve apenas enviar webhooks operacionais de compra/carrinho.

**Risco & mitigação**

- Se o `links-redirect` falhar ao enfileirar `BEGIN_CHECKOUT`, o usuário ainda deve ser redirecionado; o evento pode ser reconstruído parcialmente por logs/UTMs se necessário.
- Se o consumer cair, perde-se atualização de funil/CRM, não analytics primário; DLQ + replay script permitem reprocessar efeitos operacionais.
- Qualquer replay/backfill de tracking deve preferir rota via sGTM e rodar dry-run antes de `--apply`.

### 9. Ingress de app events (contrato — sem implementação no app agora)

Nova rota em `api-funnel-ingress`: `POST /webhooks/v1/planovoo/app/event`, autenticada por HMAC (`APP_EVENTS_HMAC`). Usa `fromAppEvent()` do normalizer. Enfileira para `decole-q-funnel-events`. Handler chain no catálogo: `[resolve_identity, upsert_event_store, update_brevo_funnel]`.

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
- falha contínua em `send_brevo_doi`, `update_brevo_funnel` e `forward_n8n`
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
- handlers puros (`resolve_identity`, `send_brevo_doi`, `update_brevo_funnel`, etc) com dependências mockadas
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
  - evento equivalente no GTM/sGTM Preview quando o caso envolver analytics
  - ausência de duplicidade em reenvio do mesmo `event_id`

#### 11.5 Testes de resiliência e caos controlado

Automatizar cenários:

- token inválido em destino externo (`forward_n8n` ou Brevo) gera DLQ sem quebrar demais handlers
- indisponibilidade temporária de Brevo (`send_brevo_doi`) com retry/backoff
- replay de DLQ reprocessa somente handlers pendentes
- latência alta em integração externa não bloqueia ingestão

#### 11.6 Testes de performance básica

Suite leve (pré-produção):

- throughput do dispatcher (mensagens/segundo)
- p95 de `duration_ms` por handler
- taxa de erro sob carga moderada

Definir budget inicial:

- p95 handler crítico (`update_brevo_funnel`/`send_brevo_doi`) < 400ms em cenário nominal
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
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/emit-tracking.ts` (opcional/compatibilidade para replay controlado)
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/resolve-identity.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/upsert-event-store.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/send-brevo-doi.ts`
- `backend/cloudflare/workers/funnel-dispatcher/src/handlers/sync-brevo-segments.ts`
- `backend/cloudflare/workers/links-redirect/src/index.ts` (`BEGIN_CHECKOUT` antes do redirect)
- `backend/cloudflare/workers/funnel-dispatcher/src/tracking/sgtm-forward.ts` (somente se houver decisão futura de server-side analytics via sGTM)
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
- **Agente D (Destinos)**: Brevo, n8n e sGTM como destino de analytics server-side.
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
| **F5 — Tracking + Checkout State** | B + D + E | `links-redirect` emitindo `BEGIN_CHECKOUT` e `emit_tracking` encaminhando para sGTM | `BEGIN_CHECKOUT` no event store e evento correspondente no sGTM/GA4/Meta |
| **F6 — Identity Graph** | A + D | `resolve_identity`, `upsert_event_store`, stitch anon->email | evento pré-submit e pós-submit no mesmo `profile_id` |
| **F7 — Cutover** | B + C + E | rotas finais, deprecar legado, runbook | suíte E2E completa 2x consecutivas sem regressão |

### 12.3 Plano de execução sugerido por sprint

1. **Sprint 1**: F0.1 + F0.2 + F1 + F2 (pipeline canônico no ar sem efeitos externos críticos).
2. **Sprint 2**: F3 + F4 (funil operacional com Brevo/n8n).
3. **Sprint 3**: F5 + F6 (checkout state + identidade unificada).
4. **Sprint 4**: F7 (cutover e estabilização assistida por observabilidade).

### 12.4 Definição de pronto por fase

- código + testes + documentação da fase no mesmo merge
- dashboards/queries mínimas atualizadas quando a fase mexer com observabilidade
- rollback documentado (como desativar rota/handler recém-introduzido)

### 12.5 Plano executável por ticket (com diagnóstico atual)

Snapshot de diagnóstico (2026-04-23):

- `api-funnel-ingress`, `api-hotmart-ingress` e `funnel-dispatcher` já existem com queue canônica (`decole-q-funnel-events`) e observabilidade `enabled=true`.
- esses três workers estão com `workers_dev = true` e sem `routes` de domínio custom.
- tráfego de lead em produção ainda entra por `api-precheckout` na rota `api.decolesuacarreiraesg.com.br/brevo*`.
- webhook Hotmart atual em produção ainda aponta para `decole-api-external-webhooks` (rota `/webhooks/hotmart*`).
- landing pages (`site/index.html` e `site/planodevoo/index.html`) ainda fazem `POST` para `https://api.decolesuacarreiraesg.com.br/brevo`.
- eventos de alto volume (`page_view`, `button_click`, `cta_click`) estão no `dataLayer`, sem POST para `api-funnel-ingress`.
- `CLOUDFLARE_API_TOKEN` atual autentica no Wrangler (`whoami`), porém operações de account (`queues list`, `d1 list`, `secret list`, `deployments list`) retornam erro `10000` (scope/permissão insuficiente).
- em `.env.local`: `BREVO_API_KEY`, `HOTMART_WEBHOOK_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID` e URLs base estão `set`; `TURNSTILE_SECRET` está `missing` (avaliar se ficará só como secret remoto).

#### Ticket GO-LIVE-001 — Matriz de Domínios/Rotas/CORS

Objetivo: fechar contratos de entrada HTTP para o pipeline canônico.

Implementação:

1. Definir rotas finais:
`api-funnel-ingress`:
`api.decolesuacarreiraesg.com.br/funnel/*`
`api.decolesuacarreiraesg.com.br/webhooks/v1/planovoo/app/event`

2. Definir rota final:
`api-hotmart-ingress`:
`api.decolesuacarreiraesg.com.br/webhooks/v1/*/hotmart/*`

3. Atualizar `wrangler.toml` dos ingress:
`workers_dev = false` + bloco `routes`.

4. Implementar CORS explícito no `api-funnel-ingress`:
- `OPTIONS` preflight
- `ALLOWED_ORIGINS` (CSV) com validação de `Origin`
- headers mínimos: `content-type`, `x-app-signature`

Gate:

- `curl -i -X OPTIONS` retorna headers CORS corretos.
- `POST` de origem permitida retorna `202`.
- `POST` de origem não permitida retorna `403`.

#### Ticket GO-LIVE-002 — Configuração final de Workers (Bindings/Secrets/Permissões)

Objetivo: garantir deploy/release reproduzível e auditável.

Implementação:

1. Corrigir token Cloudflare usado no CI/local com escopos de account para:
- Workers Scripts (read/edit)
- Workers Routes (read/edit)
- Queues (read/edit)
- D1 (read/edit)
- KV (read/edit)
- Workers Tail/Observability (read)

2. Publicar checklist de bindings obrigatórios por worker:
- `api-funnel-ingress`: `FUNNEL_EVENTS`, `APP_EVENTS_HMAC`
- `api-hotmart-ingress`: `FUNNEL_EVENTS`, `HOTMART_WEBHOOK_TOKEN`
- `links-redirect`: `FUNNEL_EVENTS`
- `funnel-dispatcher`: `DEDUPE_KV`, `IDENTITY_KV`, `IDENTITY_DB`, `EVENT_STORE_DB` + secrets de Brevo/n8n

3. Formalizar source de truth:
- `wrangler.toml` versionado para bindings/rotas
- `wrangler secret put` para valores sensíveis

Gate:

- `wrangler secret list --name <worker>` funcionando.
- `wrangler deployments list --name <worker>` funcionando.
- deploy incremental (`scripts/deploy-incremental.sh`) verde para os 3 workers canônicos.

#### Ticket GO-LIVE-003 — Refatoração das Landing Pages para arquitetura nova

Objetivo: trocar ingest legado (`/brevo`) pelo ingress canônico sem quebrar UX.

Implementação:

1. Alterar `form.action` em:
- `site/index.html`
- `site/planodevoo/index.html`
de:
`https://api.decolesuacarreiraesg.com.br/brevo`
para:
`https://api.decolesuacarreiraesg.com.br/funnel/precheckout`

2. Garantir payload canônico no submit:
- `event_type=GENERATE_LEAD`
- `product_code`
- `anonymous_id`
- `session_id`
- `lead_id`
- metadados de atribuição (`fbp`, `fbc`, `gclid` quando houver)

3. Introduzir utilitário compartilhado client-side para identidade:
- gera/persiste `anonymous_id` (cookie/localStorage)
- gera `session_id` por sessão
- mantém `lead_id` para deduplicação client/server

4. Confirmar estratégia de trilhos:
- `gtm_web_only`: continua só `dataLayer`/GTM
- `both`: `dataLayer` + POST para `api-funnel-ingress`
- checkout: links de saída apontam para `links-redirect`, que emite `BEGIN_CHECKOUT` antes do 302 para a Hotmart

Gate:

- submit válido retorna `202` sem regressão de redirect para checkout.
- retry/reenvio não duplica efeitos downstream (`event_id:handler`).
- eventos `sign_up` continuam com `event_id` consistente.
- clique/redirect de checkout gera `BEGIN_CHECKOUT` no event store.

#### Ticket GO-LIVE-004 — URL e segurança de Webhook Hotmart

Objetivo: migrar webhook de `api-external-webhooks` para `api-hotmart-ingress`.

Implementação:

1. Definir URL por produto no Hotmart:
- `.../webhooks/v1/decole-esg/hotmart/purchase`
- `.../webhooks/v1/planovoo/hotmart/purchase`

2. Padronizar token no Hotmart e no worker:
- `HOTMART_WEBHOOK_TOKEN` (secret)
- bloquear chamadas sem token (`401`)

3. Congelar whitelist inicial de eventos:
- `PURCHASE_APPROVED`
- `PURCHASE_OUT_OF_SHOPPING_CART`
- `PURCHASE_COMPLETE` normalizado para `PURCHASE_APPROVED`

4. Manter rollback preparado:
- rota antiga ativa por janela curta de convivência
- chave de corte para desligar producer legado

Gate:

- webhook real/teste Hotmart retorna `202`.
- evento aparece em `decole-q-funnel-events`.
- dispatcher executa chain esperada por `event_type`.

#### Ticket GO-LIVE-005 — Teste E2E em produção controlada

Objetivo: validar pipeline fim-a-fim com critérios objetivos de aceite.

Implementação:

1. Evoluir `scripts/e2e-funnel-staging.sh` para modo produção controlada:
- parametrizar URLs custom domain
- validar healthchecks dos 3 workers
- executar cenário `GENERATE_LEAD` + `PURCHASE_APPROVED`

2. Incluir validações automáticas:
- `funnel_events` (D1 event store)
- `identity_links` (D1 identity)
- dedupe por `event_id`

3. Incluir checklist manual complementar:
- DOI recebido no Brevo
- evento em GA4 DebugView
- evento em Meta Test Events (com `test_event_code`)

Gate:

- suíte E2E roda 2x sem regressão.
- sem crescimento anômalo de DLQ após janela de teste.

#### Ticket GO-LIVE-006 — Observabilidade e handover operacional

Objetivo: operação contínua com troubleshooting rápido.

Implementação:

1. Padronizar logs JSON em todos os handlers com:
- `event_id`, `event_type`, `product_code`, `handler`, `status`, `duration_ms`

2. Ativar consulta integrada:
- Workers Logs (Query Builder) para análise online
- Logpush para retenção longa (R2 ou destino externo) quando habilitado no account plan

3. Criar runbook de incidentes:
- falha de secret
- fila acumulando
- DLQ crescendo
- destino externo indisponível (Brevo/Meta/GA4/n8n)

Gate:

- consulta por `event_id` retorna trilha completa ingress -> dispatcher -> handler.
- alerta básico de erro por worker ativo.

#### Pré-requisitos de execução imediata (bloqueadores)

1. Atualizar scope do `CLOUDFLARE_API_TOKEN` para operações de account (hoje bloqueado com erro `10000`).
2. Confirmar se `TURNSTILE_SECRET` ficará somente como secret remoto ou também em `.env.local` para testes locais.
3. Confirmar data/hora da janela de cutover para troca de rotas de ingress e webhook Hotmart.

### 12.6 Sequência operacional (runbook executável)

Executar na ordem abaixo. Só avançar para o próximo bloco com gate verde do bloco atual.

1. Preparação de ambiente local:
```bash
set -a
source .env.local
set +a
npx wrangler whoami
```
Evidência esperada: autenticação válida no Wrangler.

2. Validar se o token já tem escopo de account:
```bash
npx wrangler queues list
npx wrangler d1 list
npx wrangler kv namespace list
```
Evidência esperada: comandos retornam inventário sem erro `10000`.
Rollback: não executar deploy; voltar para ajuste de API token.

3. GO-LIVE-001 (rotas/cors) — implementar:
```bash
git checkout -b chore/go-live-001-routes-cors
```
Arquivos-alvo:
- `backend/cloudflare/workers/api-funnel-ingress/wrangler.toml`
- `backend/cloudflare/workers/api-hotmart-ingress/wrangler.toml`
- `backend/cloudflare/workers/api-funnel-ingress/src/index.ts`

Checklist técnico:
- `workers_dev=false` nos dois ingress.
- `routes` de domínio custom configuradas.
- suporte a `OPTIONS` + `ALLOWED_ORIGINS` no `api-funnel-ingress`.

Validação:
```bash
cd backend/cloudflare/workers/api-funnel-ingress
npm test && npm run typecheck
cd ../api-hotmart-ingress
npm test && npm run typecheck
```

4. GO-LIVE-002 (bindings/secrets/deploy) — publicar config:
```bash
./backend/cloudflare/scripts/deploy-incremental.sh --worker api-funnel-ingress --dry-run
./backend/cloudflare/scripts/deploy-incremental.sh --worker api-hotmart-ingress --dry-run
./backend/cloudflare/scripts/deploy-incremental.sh --worker funnel-dispatcher --dry-run
```
Se tudo verde:
```bash
./backend/cloudflare/scripts/deploy-incremental.sh --worker api-funnel-ingress
./backend/cloudflare/scripts/deploy-incremental.sh --worker api-hotmart-ingress
./backend/cloudflare/scripts/deploy-incremental.sh --worker funnel-dispatcher
```
Evidência esperada: deploy concluído e healthcheck respondendo.

5. GO-LIVE-003 (LPs no ingress canônico) — migrar formulários:
```bash
git checkout -b feat/go-live-003-landing-ingress
```
Arquivos-alvo:
- `site/index.html`
- `site/planodevoo/index.html`

Checklist técnico:
- `form.action` aponta para `/funnel/precheckout`.
- submit envia `event_type=GENERATE_LEAD` e IDs de identidade (`anonymous_id`, `session_id`, `lead_id`).
- redirect de checkout preservado.

Validação:
```bash
rg -n "action=\"https://api.decolesuacarreiraesg.com.br/funnel/precheckout\"" site/index.html site/planodevoo/index.html
```

6. GO-LIVE-004 (Hotmart webhook cutover) — trocar endpoint no fornecedor:
- atualizar URL no painel Hotmart para `/webhooks/v1/{produto}/hotmart/purchase`.
- confirmar token configurado (`HOTMART_WEBHOOK_TOKEN`) no worker.

Teste direto no ingress:
```bash
curl -i -X POST "https://api.decolesuacarreiraesg.com.br/webhooks/v1/planovoo/hotmart/purchase" \
  -H "content-type: application/json" \
  -H "x-hotmart-hottok: <TOKEN>" \
  --data '{"event":"PURCHASE_APPROVED","buyer":{"email":"qa@example.com"}}'
```
Evidência esperada: `202`.

7. GO-LIVE-005 (E2E produção controlada):
```bash
HOTMART_INGRESS_URL="https://api.decolesuacarreiraesg.com.br" \
FUNNEL_INGRESS_URL="https://api.decolesuacarreiraesg.com.br" \
./backend/cloudflare/scripts/e2e-funnel-staging.sh
```
Evidência esperada: script conclui com `[ok] E2E staging passed` (rodar 2 vezes).

8. GO-LIVE-006 (observabilidade/runbook):
- confirmar logs estruturados por `event_id` no ingress e dispatcher.
- documentar query padrão de troubleshooting por `event_id` e `event_type`.
- validar plano de rollback:
`reverter LP para /brevo` + `despublicar rota ingress nova` + `reativar webhook legado`.

9. Encerramento da rodada:
```bash
git status --short
```
Checklist final:
- sem secrets versionados.
- `products.catalog.json` e `NEW_ARCH_PLAN.md` coerentes com rotas finais.
- evidências de gate anexadas no ticket correspondente.

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

### F5 (tracking + checkout state)

1. GET em `links-redirect` para checkout retorna `302` para a Hotmart.
2. O mesmo request publica `BEGIN_CHECKOUT` em `decole-q-funnel-events`.
3. Dispatcher executa `resolve_identity`, `upsert_event_store` e `update_brevo_funnel`.
4. sGTM recebe `BEGIN_CHECKOUT` do Worker (`emit_tracking`) e publica `begin_checkout`/`InitiateCheckout` nos destinos.

### F6 (identidade)

1. enviar `precheckout_form_started` e `precheckout_form_progress` com mesmo `anonymous_id`.
2. enviar `GENERATE_LEAD` com email.
3. `resolve_identity` cria vínculo `anonymous_id -> email_hash -> profile_id`.
4. consultas no `event_store` mostram eventos pré e pós-submit no mesmo perfil.

### F7 (cutover final)

1. suíte completa F2..F6 executada 2 vezes seguidas em staging.
2. p95 de handlers críticos dentro do budget definido.
3. DLQ sem crescimento anômalo por 24h após cutover.
