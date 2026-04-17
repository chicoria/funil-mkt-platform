# Padrao de Ingress de Webhooks Externos

Data: 2026-04-16

## Objetivo

Padronizar recebimento de webhooks de qualquer sistema externo com um contrato unico de path e validacao no Worker de ingress.

## Worker de ingress

- Nome logico no catalogo: `api-external-webhooks`
- Worker Cloudflare: `decole-api-external-webhooks`
- Funcao: autenticar webhook, validar payload basico, normalizar metadata e enfileirar.

## Padrao de path (canonico)

`POST /webhooks/v1/{produto}/{subsistema}/{operacao}`

Exemplos:
- `/webhooks/v1/decole-esg/hotmart/events`
- `/webhooks/v1/planodevoo/hotmart/purchase-approved`

## Convencoes

- `produto`: slug estavel de dominio de negocio (`decole-esg`, `planodevoo`).
- `subsistema`: origem externa (`hotmart`, `meta`, `stripe`, etc.).
- `operacao`: kebab-case (`events`, `purchase-approved`, `cart-abandonment`).
- Versao sempre no path (`/v1`) para evolucao sem quebra.

## Compatibilidade legada

Enquanto houver emissores antigos configurados, manter suporte temporario:
- `/webhooks/hotmart`

Esse path legado deve ser removido apos migracao dos emissores no painel externo.

## Evento enfileirado (campos principais)

- `source`: origem principal (`hotmart`)
- `productSlug`: slug do produto do path
- `subsystem`: subsistema do path
- `operation`: operacao do path
- `eventType`: preferencialmente do payload; fallback para operacao em UPPER_SNAKE_CASE
- `eventId`, `email`, `productId`, `productName`, `payload`

## Forwarding temporario para sistemas legados

Para evitar mudancas imediatas em sistemas existentes (ex.: n8n), o ingress pode encaminhar payloads recebidos para endpoints externos por regra:

- Variavel do worker: `WEBHOOK_FORWARDING_RULES`
- Formato: `[{productSlug, subsystem, operation?, targetUrl, required}]`
- Exemplo atual: `planodevoo + hotmart -> webhook n8n atual`

## Migracao recomendada

1. Atualizar URL de webhook no sistema externo para o path canonico.
2. Validar recebimento no ingress (`202`).
3. Validar evento na fila/consumidor.
4. Desativar path legado quando todos os emissores estiverem migrados.
