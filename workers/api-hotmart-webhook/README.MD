# DECOLE API Hotmart Webhook Worker (Cloudflare)

Worker responsavel por receber webhook da Hotmart e enfileirar eventos na Queue `decole-q-hotmart-events`.

## Rota
- `https://api.decolesuacarreiraesg.com.br/webhooks/hotmart*`

## Fluxo
1. Recebe `POST` do webhook.
2. (Opcional) valida token via `HOTMART_WEBHOOK_TOKEN`.
3. Enfileira evento em `HOTMART_EVENTS`.
4. Retorna `202`.

## Contrato HTTP (Hotmart)
- Header recomendado para autenticacao: `X-HOTMART-HOTTOK`
- Payload minimo aceito: campo de evento (`event`, `event_name`, `type`, `name` ou `data.event`)
- Respostas do worker:
  - `202`: evento aceito e enfileirado
  - `400`: payload invalido (ex.: sem tipo de evento)
  - `401`: token invalido/ausente quando `HOTMART_WEBHOOK_TOKEN` estiver ativo
  - `405`: metodo diferente de `POST`
  - `500`: fila/binding nao configurada

## Variaveis / Bindings
- `HOTMART_WEBHOOK_TOKEN` (opcional, token de autenticacao do webhook)
- Queue producer binding: `HOTMART_EVENTS` -> `decole-q-hotmart-events`

## Documentacao oficial Hotmart
- Response codes webhook: `https://developers.hotmart.com/docs/pt-BR/1.0.0/webhook/http-response-codes-webhook/`
- Purchase webhook (v2): `https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/purchase-webhook/`
- Cart abandonment webhook (v2): `https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/cart-abandonment-webhook/`

## Smoke test
Execute:
- `npm run smoke`

Variaveis opcionais:
- `SMOKE_URL` (default: `https://api.decolesuacarreiraesg.com.br/webhooks/hotmart`)
- `SMOKE_TOKEN` (se `HOTMART_WEBHOOK_TOKEN` estiver configurado)
- `SMOKE_EXPECTED_STATUS` (default: `202`)
- `SMOKE_MAX_ATTEMPTS` (default: `10`)
- `SMOKE_DELAY_MS` (default: `3000`)
