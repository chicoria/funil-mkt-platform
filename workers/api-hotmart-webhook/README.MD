# DECOLE API Hotmart Webhook Worker (Cloudflare)

Worker responsavel por receber webhook da Hotmart e enfileirar eventos na Queue `decole-q-hotmart-events`.

## Rota
- `https://api.decolesuacarreiraesg.com.br/webhooks/hotmart*`

## Fluxo
1. Recebe `POST` do webhook.
2. (Opcional) valida token via `HOTMART_WEBHOOK_TOKEN`.
3. Enfileira evento em `HOTMART_EVENTS`.
4. Retorna `202`.

## Variaveis / Bindings
- `HOTMART_WEBHOOK_TOKEN` (opcional, token de autenticacao do webhook)
- Queue producer binding: `HOTMART_EVENTS` -> `decole-q-hotmart-events`

## Smoke test
Execute:
- `npm run smoke`

Variaveis opcionais:
- `SMOKE_URL` (default: `https://api.decolesuacarreiraesg.com.br/webhooks/hotmart`)
- `SMOKE_TOKEN` (se `HOTMART_WEBHOOK_TOKEN` estiver configurado)
- `SMOKE_EXPECTED_STATUS` (default: `202`)
- `SMOKE_MAX_ATTEMPTS` (default: `10`)
- `SMOKE_DELAY_MS` (default: `3000`)
