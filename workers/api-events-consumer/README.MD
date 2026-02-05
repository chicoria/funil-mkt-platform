# DECOLE Jobs Events Consumer (Cloudflare)

Worker consumidor da Queue `decole-q-hotmart-events` para atualizar contato/lista no Brevo de forma assincrona.

## Queue
- Consumer: `decole-q-hotmart-events`
- Dead letter queue: `decole-q-hotmart-events-dlq`

## Comportamento atual
- `begin_checkout` / `checkout_started` -> lista `BREVO_LIST_BEGIN_CHECKOUT`
- `purchase` / `approved` -> lista `BREVO_LIST_PURCHASE`

O worker faz upsert do contato no Brevo (`POST /v3/contacts`, `updateEnabled=true`).

## Variaveis
- `BREVO_API_KEY` (secret)
- `BREVO_LIST_BEGIN_CHECKOUT`
- `BREVO_LIST_PURCHASE`

## Health / Smoke
- Endpoint de health: `GET /health` (via workers.dev)
- Smoke:
  - `SMOKE_URL=https://<worker>.workers.dev/health npm run smoke`
