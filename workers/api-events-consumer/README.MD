# DECOLE Jobs Events Consumer (Cloudflare)

Worker consumidor da Queue `decole-q-hotmart-events` para atualizar contato/lista no Brevo de forma assincrona.

## Queue
- Consumer: `decole-q-hotmart-events`
- Dead letter queue: `decole-q-hotmart-events-dlq`

## Comportamento atual
- `PURCHASE_OUT_OF_SHOPPING_CART` / `cart_abandon` -> lista `BREVO_LIST_CART_ABANDONMENT` (fallback: `BREVO_LIST_BEGIN_CHECKOUT`)
- `begin_checkout` / `checkout_started` -> lista `BREVO_LIST_BEGIN_CHECKOUT`
- `purchase`, `purchase_approved`, `purchase_complete`, `approved` -> lista `BREVO_LIST_PURCHASE`

O worker faz upsert do contato no Brevo (`POST /v3/contacts`, `updateEnabled=true`).

## Variaveis
- `BREVO_API_KEY` (secret)
- `BREVO_LIST_BEGIN_CHECKOUT`
- `BREVO_LIST_PURCHASE`
- `BREVO_LIST_CART_ABANDONMENT`

## Referencias Hotmart
- Purchase webhook (v2): `https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/purchase-webhook/`
- Cart abandonment webhook (v2): `https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/cart-abandonment-webhook/`

## Health / Smoke
- Endpoint de health: `GET /health` (via workers.dev)
- Smoke:
  - `SMOKE_URL=https://<worker>.workers.dev/health npm run smoke`

## Experimento Brevo (tags via atributos)
O caminho mais estavel e usar atributos customizados e segmentar no painel. Os atributos precisam existir no Brevo e devem ser enviados em letras maiusculas.

1. Crie um atributo no Brevo (ex.: `HOTMART_TAGS` tipo multi-choice ou texto).
2. Para usar `WHATSAPP`, ative o canal em `Campanhas > WhatsApp` no Brevo para que o atributo apareca na lista de atributos do contato.
2. Rode o script:
   - `BREVO_API_KEY=... BREVO_CONTACT_EMAIL=... node scripts/brevo-tag-experiment.mjs`

Variaveis opcionais:
- `BREVO_TAG_ATTRIBUTE` (default: `HOTMART_TAGS`)
- `BREVO_TAG_VALUE` (default: `BEGIN_CHECKOUT`)
- `BREVO_TAG_MODE` (`multi` ou `single`, default: `multi`)
- `BREVO_API_BASE` (default: `https://api.brevo.com/v3/contacts`)
