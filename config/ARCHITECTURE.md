# Arquitetura de Eventos — DECOLE (estado atual)

> Referência de estado atual. Última actualização: 2026-05-09.
> Para diagramas visuais (arquitetura, chains, deployment, fluxo de dev) ver [`DIAGRAMS.md`](DIAGRAMS.md).

---

## Visão geral

```
Browser / Hotmart / App
        │
        ▼
   [Ingress Workers]
   api-funnel-ingress        ← /funnel/precheckout (site)
   links-redirect            ← /checkout (antes do redirect Hotmart)
   api-hotmart-ingress       ← /webhooks/v1/{produto}/hotmart/purchase
        │
        ▼
  decole-q-funnel-events  (Cloudflare Queue)
        │
        ▼
  [funnel-dispatcher]       ← consumer da queue
        │
        ├── resolve_identity      → D1 identity_links + KV
        ├── upsert_event_store    → D1 funnel_events
        ├── enrich_attribution    → recupera fbp/fbc/client_ip de eventos site
        ├── update_brevo_funnel   → Brevo contacts API
        ├── send_brevo_doi        → Brevo native DOI API
        ├── emit_tracking         → sGTM /mp/collect → GA4 + Meta CAPI
        ├── send_cart_abandonment_email → Brevo SMTP transactional API
        └── forward_n8n           → n8n webhook
```

---

## Workers ativos

| Worker | Route | Função |
|--------|-------|--------|
| `decole-api-funnel-ingress` | `api.decolesuacarreiraesg.com.br/funnel/*` | Precheckout do site → GENERATE_LEAD |
| `decole-links-redirect` | `links.decolesuacarreiraesg.com.br/*` | Checkout redirect → BEGIN_CHECKOUT |
| `decole-api-hotmart-ingress` | `api.decolesuacarreiraesg.com.br/webhooks/v1/*` | Webhooks Hotmart → PURCHASE_APPROVED / PURCHASE_COMPLETE / PURCHASE_OUT_OF_SHOPPING_CART |
| `decole-funnel-dispatcher` | consumer queue | Processa chain de handlers por evento |

**Rotas Hotmart aceitas pelo ingress:**
- `api.decolesuacarreiraesg.com.br/webhooks/v1/decole-esg/hotmart/*` → `DECOLE_ESG_MENTORIA`
- `api.decolesuacarreiraesg.com.br/webhooks/v1/plano-de-voo/hotmart/*` → `DECOLE_PLANOVOO`
- `api.decolesuacarreiraesg.com.br/webhooks/v1/planodevoo/hotmart/*` → `DECOLE_PLANOVOO`
- `api.decolesuacarreiraesg.com.br/webhooks/v1/planovoo/hotmart/*` → `DECOLE_PLANOVOO`

---

## Tipo canónico: `FunnelEvent`

```typescript
{
  event_id: string          // uuid — chave de idempotência global
  event_type: string        // GENERATE_LEAD | BEGIN_CHECKOUT | PURCHASE_APPROVED | PURCHASE_COMPLETE | ...
  product_code: string      // DECOLE_ESG_MENTORIA | DECOLE_PLANOVOO
  source: string            // "site" | "hotmart" | "app"
  occurred_at: string       // ISO 8601

  identity?: {
    anonymous_id?: string   // cookie first-party do browser
    session_id?: string
    lead_id?: string
    email_hash?: string     // SHA-256(lower(trim(email)))
  }

  attribution?: {
    fbp?: string            // _fbp cookie
    fbc?: string            // _fbc click ID
    gclid?: string
    utm_source?: string
    utm_medium?: string
    utm_campaign?: string
    client_ip?: string      // CF-Connecting-IP capturado no ingress
  }

  lead?: { email?: string; phone?: string; lead_id?: string }
  payload?: Record<string, unknown>  // dados extras por event_type
}
```

---

## Pipelines por evento (catálogo)

O `api-hotmart-ingress` preserva o `event` recebido da Hotmart como `event_type`; ele não converte `PURCHASE_COMPLETE` para `PURCHASE_APPROVED`. A diferença operacional é:
- `PURCHASE_APPROVED`: compra aprovada, usada para compra imediata, tracking e `forward_n8n`.
- `PURCHASE_COMPLETE`: fim do ciclo de garantia/reembolso, declarado para `DECOLE_ESG_MENTORIA` e `DECOLE_PLANOVOO`, usado para D1/Brevo sem duplicar compra.

### GENERATE_LEAD (source: site)
```
resolve_identity → upsert_event_store → send_brevo_doi → update_brevo_funnel → sync_brevo_segments
```
- Sem `emit_tracking` no dispatcher: o tracking de lead segue pelo browser (`dataLayer` → GTM Web → sGTM → GA4 + Meta CAPI).
- No catálogo, `delivery: "both"` para `GENERATE_LEAD` significa **backend server_queue + tracking web/sGTM**, não envio duplicado pelo dispatcher.
- `send_brevo_doi` usa DOI nativo Brevo via `POST /contacts/doubleOptinConfirmation`
- O template DOI usa `{{ params.DOIurl }}`; a Brevo confirma o contato, inclui na lista do produto e redireciona para a página de confirmação:
  - `DECOLE_ESG_MENTORIA`: template `1`, lista `7`, `https://decolesuacarreiraesg.com.br/confirmacao.html`
  - `DECOLE_PLANOVOO`: template `10`, lista `8`, `https://decolesuacarreiraesg.com.br/planodevoo/confirmacao.html`
- `sync_brevo_segments` permanece na chain como ponto de extensão; a entrada na lista de precheckout confirmada é feita hoje pelo `includeListIds` do DOI nativo.

### BEGIN_CHECKOUT (source: site, via links-redirect)
```
resolve_identity → upsert_event_store → enrich_attribution → update_brevo_funnel → emit_tracking
```
- GA4: `begin_checkout` | Meta: `InitiateCheckout`

### PURCHASE_APPROVED (source: hotmart)
```
resolve_identity → upsert_event_store → enrich_attribution → update_brevo_funnel → emit_tracking → forward_n8n
```
- GA4: `purchase` | Meta: `Purchase`
- `enrich_attribution` recupera `fbp`/`fbc`/`client_ip` de evento site anterior do mesmo `profile_id`
- No Plano de Voo, `forward_n8n` mantém compatibilidade com o payload legado esperado pelo workflow `plano-de-voo/hotmart`

### PURCHASE_COMPLETE (source: hotmart)
```
resolve_identity → upsert_event_store → update_brevo_funnel
```
- Evento pós-garantia/reembolso mantido separado de `PURCHASE_APPROVED`
- Declarado no catálogo para `DECOLE_ESG_MENTORIA` e `DECOLE_PLANOVOO`
- Sem `emit_tracking` e sem `forward_n8n` por padrão

### PURCHASE_OUT_OF_SHOPPING_CART (source: hotmart)
```
resolve_identity → upsert_event_store → update_brevo_funnel → send_cart_abandonment_email
```
- **Sem `emit_tracking`** — duplicaria `InitiateCheckout` (já emitido por BEGIN_CHECKOUT)
- `send_cart_abandonment_email` continua transacional via Brevo SMTP API (`POST /smtp/email`)
- O link de retomada aponta para o worker `links-redirect`, que reidrata dados de sessão/usuário antes do redirect Hotmart quando há `rid`

---

## D1 — Modelo de dados

### `decole-d1-event-store` → tabela `funnel_events`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `event_id` | TEXT PK | UUID do evento |
| `profile_id` | TEXT | ID de perfil unificado |
| `anonymous_id` | TEXT | Cookie anónimo do browser |
| `email_hash` | TEXT | SHA-256 do email |
| `event_type` | TEXT | Tipo canónico do evento |
| `product_code` | TEXT | Produto |
| `source` | TEXT | "site" / "hotmart" / "app" |
| `occurred_at` | TEXT | ISO 8601 |
| `payload_json` | TEXT | JSON com `event.attribution` + `event.payload` merged |

> `payload_json` inclui `fbp`, `fbc`, `client_ip` para que `enrich_attribution` os possa recuperar em eventos posteriores do mesmo perfil.

### `decole-d1-identity` → tabela `identity_links`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `profile_id` | TEXT PK | UUID de perfil unificado |
| `anonymous_id` | TEXT UNIQUE | Cookie do browser |
| `email_hash` | TEXT | SHA-256 do email |
| `updated_at` | TEXT | ISO 8601 |

---

## Tracking: sGTM → GA4 + Meta CAPI

Há dois caminhos de tracking para sGTM:

- **Web/GTM:** `PAGE_VIEW`, `CTA_CLICK` e `GENERATE_LEAD` saem do browser via `dataLayer`/GTM Web e são repassados pelo sGTM para GA4 + Meta CAPI.
- **Dispatcher:** `BEGIN_CHECKOUT` e `PURCHASE_APPROVED` usam `emit_tracking` server-side, com attribution enriquecida pelo Event Store.

O handler `emit_tracking` envia para `sGTM /mp/collect` com:

```
measurement_id  (GA4)
api_secret      (GA4)
client_id       → anonymous_id ou hash estável por event_id
em              → email_hash (SHA-256) — obrigatório para Meta CAPI user match
client_ip_address → CF-Connecting-IP capturado no ingress
fbp             → _fbp cookie (directo ou via enrich_attribution)
fbc             → _fbc click ID
meta_event_name → Purchase | InitiateCheckout | ...
meta_test_event_code → código de teste Meta (quando configurado)
```

**Container sGTM**: `GTM-K6Q4H6BR` em `https://sgtm.decolesuacarreiraesg.com.br`

---

## Deduplicação

`DEDUPE_KV` — chave `{event_id}:{handler_name}`, TTL 90 dias.
Cada handler só executa uma vez por `event_id`, mesmo em retries da queue.

---

## Catálogo de produtos

`config/products.catalog.json` — fonte única de verdade para:
- Produtos e aliases
- Pipelines de eventos (`funnelEventArchitecture.events[].chain`)
- Configuração de tracking (sGTM endpoint, GA4 measurement ID, Meta pixel)
- Configuração Brevo (DOI nativo, listas, templates, campos de funil, emails transacionais)
- Links de checkout

Ao alterar funis, produtos, checkout, Brevo, Hotmart, workers ou páginas públicas relacionadas, verificar se o catálogo precisa mudar. Ver também [`config/README.md`](README.md).

---

## Identidade cross-source

Quando um evento Hotmart chega com email igual ao de um evento site anterior:
1. `resolve_identity` faz lookup por `email_hash` em `identity_links`
2. Associa ambos ao mesmo `profile_id`
3. `enrich_attribution` usa o `profile_id` para recuperar `fbp`/`fbc`/`client_ip` do evento site

---

## Infraestrutura Cloudflare

| Recurso | Nome | Tipo |
|---------|------|------|
| Queue principal | `decole-q-funnel-events` | Queue |
| Queue DLQ | `decole-q-funnel-events-dlq` | Queue |
| Queue legacy | `decole-q-hotmart-events` | Queue |
| Event store | `decole-d1-event-store` | D1 |
| Identity | `decole-d1-identity` | D1 |
| Deduplicação | `DEDUPE_KV` | KV |
| Identity cache | `IDENTITY_KV` | KV |

---

## Variáveis de ambiente principais

| Var | Worker | Descrição |
|-----|--------|-----------|
| `BREVO_API_KEY` | dispatcher | API key Brevo |
| `BREVO_DOI_TEMPLATE_ID` | dispatcher | Fallback de template ID para DOI nativo |
| `BREVO_DOI_REDIRECT_URL` | dispatcher | Fallback de redirection URL para DOI nativo |
| `BREVO_CART_ABANDONMENT_TEMPLATE_ID` | dispatcher | Fallback de template transacional para carrinho abandonado |
| `BREVO_SANDBOX` | dispatcher | `true` → X-Sib-Sandbox: drop |
| `SGTM_ENDPOINT_URL` | dispatcher | URL do container sGTM |
| `GA4_MEASUREMENT_ID` | dispatcher | ou via catálogo por produto |
| `GA4_API_SECRET` | dispatcher | ou via catálogo por produto |
| `META_TEST_EVENT_CODE_DECOLE_ESG` | dispatcher | Código de teste Meta ESG |
| `META_TEST_EVENT_CODE_PLANOVOO` | dispatcher | Código de teste Meta PLANOVOO |
| `N8N_WEBHOOK_URL` | dispatcher | URL webhook n8n |
| `N8N_DISABLE_FORWARD` | dispatcher | `true` → desabilita forward n8n |
| `HOTMART_WEBHOOK_TOKEN` | hotmart-ingress | Token de autenticação Hotmart |

---

## Testes

### Unitários — por worker

Cada worker tem `test/unit/index.test.ts` com Vitest. Executar:

```bash
# Worker específico (após mudança)
cd workers/funnel-dispatcher && npm test

# Todos os workers
bash tests/verify.sh --unit-only
```

**Mapeamento mudança → worker a testar:**

| Mudança | Workers a testar |
|---------|-----------------|
| `handlers/index.ts` (dispatcher) | `funnel-dispatcher` |
| `api-funnel-ingress/src/index.ts` | `api-funnel-ingress` |
| `links-redirect/src/index.ts` | `links-redirect` |
| `packages/shared/` | `shared` + todos os workers que importam |
| `products.catalog.json` | `funnel-dispatcher` (bundled) |

### E2E — suite de referência

```bash
# Regressão rápida (sem replay sGTM) — rodar antes de qualquer deploy
bash tests/run-scenarios.sh --all --skip-sgtm

# Validação completa com sGTM + Meta
bash tests/run-scenarios.sh --all --meta-test-event-code TEST15651

# Cenários afectados por mudança específica:
bash tests/run-scenarios.sh --scenario 01,07      # ingress/identity
bash tests/run-scenarios.sh --scenario 02,03,08   # emit_tracking
bash tests/run-scenarios.sh --scenario 06,03      # enrich_attribution
bash tests/run-scenarios.sh --scenario 04         # PURCHASE_OUT_OF_SHOPPING_CART
```

**Mapeamento mudança → cenário E2E:**

| Mudança no código | Cenário |
|-------------------|---------|
| `emitTracking` | 02, 03, 08 |
| `enrichAttributionFromHistory` | 06, 03 |
| `resolveIdentityState` | 01, 05, 07 |
| `upsertEventStoreRecord` | 01, 02, 03, 07 |
| `fromPrecheckoutForm` (ingress) | 01 |
| `buildBeginCheckoutEvent` (links-redirect) | 02 |
| `fromHotmartWebhook` (hotmart-ingress) | 03, 04, 05 + smoke `PURCHASE_COMPLETE` |
| `products.catalog.json` chains | 03, 04 + unit/smoke `PURCHASE_COMPLETE` |

### Comando único de verificação

```bash
# Tudo: unitários + E2E
bash tests/verify.sh
```

---

## Deploy

```bash
# Worker individual
cd workers/funnel-dispatcher && npx wrangler deploy

# Script incremental (com dry-run e healthcheck)
bash scripts/deploy-incremental.sh --worker funnel-dispatcher
```

**Ordem recomendada de deploy quando múltiplos workers são afectados:**
1. `api-funnel-ingress` e `links-redirect` (produtores da queue) 
2. `api-hotmart-ingress` (produtor)
3. `funnel-dispatcher` (consumer — último)

---

## Runbook operacional

### Health check

```bash
bash scripts/healthcheck-worker.sh \
  --url https://decole-funnel-dispatcher.chicoria.workers.dev/health
```

### Reset do consumer da queue (em emergência)

```bash
npx wrangler queues consumer worker remove decole-q-funnel-events decole-funnel-dispatcher
npx wrangler queues consumer worker add decole-q-funnel-events decole-funnel-dispatcher \
  --batch-size 25 --batch-timeout 10 --message-retries 5 \
  --dead-letter-queue decole-q-funnel-events-dlq
```

### Replay de tracking (após fix de payload)

```bash
node scripts/replay-emit-tracking.mjs \
  --event-id <event_id> \
  --meta-test-event-code TEST15651 \
  --apply
```
