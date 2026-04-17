# DECOLE API External Webhooks Worker (Cloudflare)

Worker responsavel por receber webhooks de sistemas externos (inicialmente Hotmart) e enfileirar eventos na Queue `decole-q-hotmart-events`.

## Rotas

Padrao canonico:
- `https://api.decolesuacarreiraesg.com.br/webhooks/v1/{produto}/{subsistema}/{operacao}`
- Exemplo: `https://api.decolesuacarreiraesg.com.br/webhooks/v1/decole-esg/hotmart/events`

Rota legada (compatibilidade temporaria):
- `https://api.decolesuacarreiraesg.com.br/webhooks/hotmart*`

## Fluxo
1. Recebe `POST` no path canonico (ou legado).
2. (Opcional) valida token via `HOTMART_WEBHOOK_TOKEN`.
3. Extrai e normaliza payload.
4. (Opcional) faz forwarding para destinos externos conforme `WEBHOOK_FORWARDING_RULES` (ex.: n8n).
5. Enfileira evento em `HOTMART_EVENTS`.
5. Retorna `202`.

## Contrato HTTP (Hotmart)
- Header recomendado para autenticacao: `X-HOTMART-HOTTOK`
- Payload minimo aceito:
  - campo de evento (`event`, `event_name`, `type`, `name` ou `data.event`)
  - ou fallback pela operacao no path (`/webhooks/v1/.../{operacao}`)
- Respostas do worker:
  - `202`: evento aceito e enfileirado
  - `400`: payload invalido (ex.: sem tipo de evento e operacao vazia)
  - `401`: token invalido/ausente quando `HOTMART_WEBHOOK_TOKEN` estiver ativo
  - `404`: path fora do padrao aceito
  - `405`: metodo diferente de `POST`
  - `500`: fila/binding nao configurada

## Variaveis / Bindings
- `HOTMART_WEBHOOK_TOKEN` (opcional, token de autenticacao do webhook)
- `WEBHOOK_FORWARDING_RULES` (opcional, JSON com regras de forward por `productSlug/subsystem/operation`)
- Queue producer binding: `HOTMART_EVENTS` -> `decole-q-hotmart-events`

## Documentacao oficial Hotmart
- Response codes webhook: `https://developers.hotmart.com/docs/pt-BR/1.0.0/webhook/http-response-codes-webhook/`
- Purchase webhook (v2): `https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/purchase-webhook/`
- Cart abandonment webhook (v2): `https://developers.hotmart.com/docs/pt-BR/2.0.0/webhook/cart-abandonment-webhook/`

## Smoke test
Execute:
- `npm run smoke`

Variaveis opcionais:
- `SMOKE_URL` (default: `https://api.decolesuacarreiraesg.com.br/webhooks/v1/decole-esg/hotmart/events`)
- `SMOKE_TOKEN` (se `HOTMART_WEBHOOK_TOKEN` estiver configurado)
- `SMOKE_EXPECTED_STATUS` (default: `202`)
- `SMOKE_MAX_ATTEMPTS` (default: `10`)
- `SMOKE_DELAY_MS` (default: `3000`)
