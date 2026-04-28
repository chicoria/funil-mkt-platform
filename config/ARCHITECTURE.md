# Arquitetura de Eventos — DECOLE (estado atual)

> Referência de estado atual. Última actualização: 2026-04-28.
> Documento substitui `NEW_ARCH_PLAN.md` (plano de implementação, arquivado).

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
        ├── send_brevo_doi        → Brevo SMTP (double opt-in)
        ├── emit_tracking         → sGTM /mp/collect → GA4 + Meta CAPI
        ├── send_cart_abandonment_email → Brevo SMTP
        └── forward_n8n           → n8n webhook
```

---

## Workers ativos

| Worker | Route | Função |
|--------|-------|--------|
| `decole-api-funnel-ingress` | `api.decolesuacarreiraesg.com.br/funnel/*` | Precheckout do site → GENERATE_LEAD |
| `decole-links-redirect` | `links.decolesuacarreiraesg.com.br/*` | Checkout redirect → BEGIN_CHECKOUT |
| `decole-api-hotmart-ingress` | `api.decolesuacarreiraesg.com.br/webhooks/v1/*` | Webhooks Hotmart → PURCHASE_APPROVED / PURCHASE_OUT_OF_SHOPPING_CART |
| `decole-funnel-dispatcher` | consumer queue | Processa chain de handlers por evento |

---

## Tipo canónico: `FunnelEvent`

```typescript
{
  event_id: string          // uuid — chave de idempotência global
  event_type: string        // GENERATE_LEAD | BEGIN_CHECKOUT | PURCHASE_APPROVED | ...
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

### GENERATE_LEAD (source: site)
```
resolve_identity → upsert_event_store → send_brevo_doi → update_brevo_funnel → sync_brevo_segments
```
- Sem `emit_tracking` (sem pixel GA4/Meta para leads)

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

### PURCHASE_OUT_OF_SHOPPING_CART (source: hotmart)
```
resolve_identity → upsert_event_store → update_brevo_funnel → send_cart_abandonment_email
```
- **Sem `emit_tracking`** — duplicaria `InitiateCheckout` (já emitido por BEGIN_CHECKOUT)

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

`backend/cloudflare/config/products.catalog.json` — fonte única de verdade para:
- Produtos e aliases
- Pipelines de eventos (`funnelEventArchitecture.events[].chain`)
- Configuração de tracking (sGTM endpoint, GA4 measurement ID, Meta pixel)
- Configuração Brevo (listas, templates, campos de funil)
- Links de checkout

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
| `BREVO_DOI_TEMPLATE_ID` | dispatcher | Template ID DOI |
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
cd backend/cloudflare/workers/funnel-dispatcher && npm test

# Todos os workers
cd backend/cloudflare && bash tests/verify.sh --unit-only
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
bash backend/cloudflare/tests/run-scenarios.sh --all --skip-sgtm

# Validação completa com sGTM + Meta
bash backend/cloudflare/tests/run-scenarios.sh --all --meta-test-event-code TEST15651

# Cenários afectados por mudança específica:
bash backend/cloudflare/tests/run-scenarios.sh --scenario 01,07      # ingress/identity
bash backend/cloudflare/tests/run-scenarios.sh --scenario 02,03,08   # emit_tracking
bash backend/cloudflare/tests/run-scenarios.sh --scenario 06,03      # enrich_attribution
bash backend/cloudflare/tests/run-scenarios.sh --scenario 04         # PURCHASE_OUT_OF_SHOPPING_CART
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
| `fromHotmartWebhook` (hotmart-ingress) | 03, 04, 05 |
| `products.catalog.json` chains | 03, 04 |

### Comando único de verificação

```bash
# Tudo: unitários + E2E
bash backend/cloudflare/tests/verify.sh
```

---

## Deploy

```bash
# Worker individual
cd backend/cloudflare/workers/funnel-dispatcher && npx wrangler deploy

# Script incremental (com dry-run e healthcheck)
bash backend/cloudflare/scripts/deploy-incremental.sh --worker funnel-dispatcher
```

**Ordem recomendada de deploy quando múltiplos workers são afectados:**
1. `api-funnel-ingress` e `links-redirect` (produtores da queue) 
2. `api-hotmart-ingress` (produtor)
3. `funnel-dispatcher` (consumer — último)

---

## Runbook operacional

### Health check

```bash
bash backend/cloudflare/scripts/healthcheck-worker.sh \
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
node backend/cloudflare/scripts/replay-emit-tracking.mjs \
  --event-id <event_id> \
  --meta-test-event-code TEST15651 \
  --apply
```
