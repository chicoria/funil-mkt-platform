# DECOLE Jobs Events Consumer (Cloudflare)

Worker consumidor da Queue `decole-q-hotmart-events` para atualizar contato no Brevo de forma assincrona.

## Queue
- Consumer: `decole-q-hotmart-events`
- Dead letter queue: `decole-q-hotmart-events-dlq`

## Comportamento atual
- Processa apenas eventos cujo produto esteja mapeado em `HOTMART_PRODUCTS`.
- Para cada produto, atualiza:
  - `${PREFIX}_FUNIL_STEPS` (tags separadas por virgula)
  - `${PREFIX}_FUNIL_LAST_STEP`
  - `${PREFIX}_FUNIL_LAST_STEP_TIMESTAMP` (DD-MM-YYYY)
- Para eventos de abandono de carrinho, envia email transacional no Brevo.

Regra de match:
- Prioriza `id` quando presente.
- Se nao houver `id`, usa `name` (case-insensitive, sem acentos, com match por inclusao).

O worker faz upsert do contato no Brevo (`POST /v3/contacts`, `updateEnabled=true`) com `attributes`.

Campos de produto verificados no payload:
`product.id`, `product_id`, `data.product.id`, `data.product_id`, `data.checkout.product.id`, `data.purchase.product.id`,
`product.name`, `product_name`, `data.product.name`, `data.product_name`, `data.checkout.product.name`, `data.purchase.product.name`.

## Variaveis
- `BREVO_API_KEY` (secret)
- `BREVO_CART_ABANDONMENT_TEMPLATE_ID` (template transacional para abandono de carrinho)
- `BREVO_REPLY_TO_EMAIL` (opcional, reply-to do email transacional)
- `BREVO_REPLY_TO_NAME` (opcional, nome do reply-to)

## Config
- `backend/cloudflare/config/hotmart-products.json` (produtos e prefixo)

Exemplo:
```json
[
  { "id": 3526906, "name": "Metodo DECOLE", "prefix": "DECOLE_ESG", "checkoutCode": "K98068530F", "offerCode": "3j6lto4t" },
  { "id": 987654, "name": "Plano de Voo", "prefix": "DECOLE_PLANO_VOO", "checkoutCode": "K123456789", "offerCode": "abcd1234" }
]
```

Parametros enviados para o template transacional:
- `productName`
- `buyerName`
- `email`
- `offerCode`
- `checkoutUrl`

Campos opcionais em `config/hotmart-products.json`:
- `checkoutCode`: codigo do checkout Hotmart (ex.: `K98068530F`)
- `offerCode`: codigo de oferta default (usado quando o webhook nao envia `offer.code`)

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
