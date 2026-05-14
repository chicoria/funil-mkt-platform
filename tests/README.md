# E2E Test Suite — DECOLE Funnel

Suite de cenários de referência para validar o fluxo de eventos do funil Cloudflare ponta a ponta.

## Estrutura

```
tests/
├── scenarios/              # Cenários independentes (node scenarios/XX.mjs)
│   ├── 01-generate-lead.mjs
│   ├── 02-begin-checkout.mjs
│   ├── 03-purchase-approved.mjs
│   ├── 04-cart-abandonment.mjs
│   ├── 05-identity-stitch.mjs
│   ├── 06-attribution-enrichment.mjs
│   ├── 07-deduplication.mjs
│   └── 08-sgtm-payload.mjs
├── lib/                    # Utilitários compartilhados
│   ├── config.mjs          # loadEnv, loadCatalog, getProductTracking
│   ├── d1.mjs              # d1Query, waitForRow (wrangler CLI wrapper)
│   ├── http.mjs            # postJson, getUrl, assertStatus
│   ├── wait.mjs            # poll
│   ├── assert.mjs          # step, assertEqual, assertPayloadJson, printResult
│   └── replay.mjs          # replayApply, replayDryRun
├── run-scenarios.sh        # Orquestrador
└── e2e-server-side-tracking/  # Suite de tracking (mantida separada)
```

## Pré-requisitos

```bash
# Obrigatório
CLOUDFLARE_API_TOKEN=...   # ou CLOUDFLARE_AGENTS_AI_TOKEN
CLOUDFLARE_ACCOUNT_ID=...

# Recomendado para cenários com hotmart
HOTMART_WEBHOOK_TOKEN=...

# Para cenários com sGTM
SGTM_ENDPOINT_URL=...
GA4_MEASUREMENT_ID=...
GA4_API_SECRET=...
```

Todos lidos automaticamente do `.env.local` na raiz do projeto.

## Uso

```bash
cd tests

# Rodar cenário isolado
node scenarios/01-generate-lead.mjs
node scenarios/03-purchase-approved.mjs

# Suite completa
./run-scenarios.sh --all

# Cenários específicos
./run-scenarios.sh --scenario 03
./run-scenarios.sh --scenario 05,06

# Por tag
./run-scenarios.sh --tag tracking
./run-scenarios.sh --tag identity

# Com Meta test event code (para sGTM)
./run-scenarios.sh --all --meta-test-event-code TEST19244

# Verificação completa (GA4 + Meta) — usa verify-ga4-realtime.mjs e verify-meta-stats-delta.mjs
./run-scenarios.sh --scenario 03 --verify-destinations

# Sem sGTM (só D1 + identity)
./run-scenarios.sh --all --skip-sgtm

# Salvar resultado JSON
./run-scenarios.sh --all --output-json /tmp/e2e-result.json
```

## Cenários

| # | Nome | Tags | O que valida |
|---|---|---|---|
| 01 | generate-lead | ingress, identity, brevo | POST precheckout → GENERATE_LEAD em D1, identity_links criado |
| 02 | begin-checkout | ingress, identity, tracking, sgtm | GET /checkout → BEGIN_CHECKOUT em D1, fbp/client_ip, sGTM replay |
| 03 | purchase-approved | hotmart, identity, tracking, sgtm | Webhook Hotmart → PURCHASE_APPROVED, enrich_attribution, sGTM |
| 04 | cart-abandonment | hotmart, brevo | PURCHASE_OUT_OF_SHOPPING_CART → D1, confirma SEM sGTM |
| 05 | identity-stitch | identity | Site event + hotmart event com mesmo email → mesmo profile_id |
| 06 | attribution-enrichment | identity, tracking, sgtm | Site com fbp → hotmart → fbp recuperado e enviado ao sGTM |
| 07 | deduplication | ingress, identity | Mesmo event_id 2x → 1 linha no D1, mesmo profile_id |
| 08 | sgtm-payload | tracking, sgtm | Replay de evento recente valida em, meta_event_name, HTTP 200 |

## Saída

Cada cenário produz JSON estruturado + tabela ASCII:

```
  ✓ ingress_202               event_id=e2e-gl-1234
  ✓ event_in_d1               event_type=GENERATE_LEAD source=site
  ✓ identity_resolved         profile_id=abc-123
  ✓ payload_has_fbp           fbp=fb.1.1234.test
  · sgtm_emit_tracking        GENERATE_LEAD chain has no emit_tracking

✓ 01-generate-lead — 4/5 passed, 0 failed, 1 skipped (8200ms)
```

## Usar como regressão

Antes de qualquer deploy que afete o funil:

```bash
./run-scenarios.sh --all --skip-sgtm   # rápido, sem replay
```

Após deploy:

```bash
./run-scenarios.sh --all --meta-test-event-code TEST19244
```

## Mapeamento cenário → handler afetado

| Mudança no código | Cenário para rodar |
|---|---|
| `emitTracking` | 02, 03, 08 |
| `enrichAttributionFromHistory` | 06, 03 |
| `resolveIdentityState` | 01, 05, 07 |
| `upsertEventStoreRecord` | 01, 02, 03, 07 |
| `fromPrecheckoutForm` (ingress) | 01 |
| `buildBeginCheckoutEvent` (links-redirect) | 02 |
| `fromHotmartWebhook` (hotmart-ingress) | 03, 04, 05 |
| `products.catalog.json` (chains) | 03, 04 |
