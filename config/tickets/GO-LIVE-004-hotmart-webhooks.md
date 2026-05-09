# GO-LIVE-004 — Criar webhooks Hotmart no ingress canônico

## Objetivo

Migrar os webhooks Hotmart dos produtos DECOLE para o worker canônico `api-hotmart-ingress`, publicando eventos normalizados na fila `decole-q-funnel-events`.

## Webhooks a criar no Hotmart

Criar **um webhook por produto**. O mesmo endpoint do produto deve receber os eventos Hotmart `PURCHASE_APPROVED`, `PURCHASE_COMPLETE` e `PURCHASE_OUT_OF_SHOPPING_CART`; o worker decide a chain pelo campo de evento recebido no payload da Hotmart.

### DECOLE sua Carreira ESG

- Produto: `DECOLE sua Carreira ESG`
- Product ID: `5083704`
- Checkout code: `K98068530F`
- Endpoint:
  - `https://api.decolesuacarreiraesg.com.br/webhooks/v1/decole-esg/hotmart/purchase`
- Eventos Hotmart a assinar:
  - `PURCHASE_APPROVED`
  - `PURCHASE_COMPLETE`
  - `PURCHASE_OUT_OF_SHOPPING_CART`

### Plano de Voo

- Produto: `DECOLE - Plano de Voo`
- Product ID: `7592718`
- Checkout code: `R105463680A`
- Endpoint recomendado:
  - `https://api.decolesuacarreiraesg.com.br/webhooks/v1/plano-de-voo/hotmart/purchase`
- Eventos Hotmart a assinar:
  - `PURCHASE_APPROVED`
  - `PURCHASE_COMPLETE`
  - `PURCHASE_OUT_OF_SHOPPING_CART`

## Segurança

- Usar o mesmo token configurado no secret remoto `HOTMART_WEBHOOK_TOKEN`.
- Configurar o token no Hotmart para chegar em um destes headers aceitos pelo worker:
  - `x-hotmart-hottok`
  - `x-hotmart-token`
  - `authorization: Bearer <token>`
- Não registrar o valor do token no ticket, no catálogo ou em qualquer arquivo versionado.

## Observações técnicas

- O worker preserva `PURCHASE_APPROVED` e `PURCHASE_COMPLETE` como eventos distintos.
- `PURCHASE_APPROVED` representa compra aprovada e executa o fluxo imediato de compra, tracking e `forward_n8n`.
- `PURCHASE_COMPLETE` representa fim do ciclo de garantia/reembolso e pode ativar fluxos pós-garantia; nos produtos DECOLE ele grava Event Store e atualiza funil no Brevo sem duplicar tracking ou n8n.
- O slug recomendado para Plano de Voo é `plano-de-voo`; o worker também mapeia `planodevoo` e `planovoo` para `DECOLE_PLANOVOO`.
- Manter o webhook legado ativo durante uma janela curta de convivência para rollback.

## Checklist de execução

- [ ] Confirmar que `api-hotmart-ingress` está deployado e respondendo em `/health`.
- [ ] Confirmar que `HOTMART_WEBHOOK_TOKEN` está configurado como secret no worker `decole-api-hotmart-ingress`.
- [ ] Criar um webhook do produto `5083704` para o endpoint `decole-esg`.
- [ ] Nesse mesmo webhook do produto `5083704`, assinar `PURCHASE_APPROVED`, `PURCHASE_COMPLETE` e `PURCHASE_OUT_OF_SHOPPING_CART`.
- [ ] Criar um webhook do produto `7592718` para o endpoint `plano-de-voo`.
- [ ] Nesse mesmo webhook do produto `7592718`, assinar `PURCHASE_APPROVED`, `PURCHASE_COMPLETE` e `PURCHASE_OUT_OF_SHOPPING_CART`.
- [ ] Enviar webhook de teste para cada produto e confirmar HTTP `202`.
- [ ] Confirmar logs do `api-hotmart-ingress` com `event_type`, `event_id` e `product_code` corretos.
- [ ] Confirmar execução do `funnel-dispatcher` para cada evento.
- [ ] Confirmar que `PURCHASE_APPROVED` chega no pipeline e executa `forward_n8n`.
- [ ] Confirmar que `PURCHASE_COMPLETE` chega como evento próprio e não executa `forward_n8n` por padrão.
- [ ] Confirmar que `PURCHASE_OUT_OF_SHOPPING_CART` executa `send_cart_abandonment_email` e não executa `forward_n8n`.

## Comandos de smoke test

```bash
curl -i -X POST "https://api.decolesuacarreiraesg.com.br/webhooks/v1/decole-esg/hotmart/purchase" \
  -H "content-type: application/json" \
  -H "x-hotmart-hottok: <TOKEN>" \
  --data '{"id":"hotmart-smoke-esg-approved","event":"PURCHASE_APPROVED","buyer":{"email":"qa@example.com"}}'
```

```bash
curl -i -X POST "https://api.decolesuacarreiraesg.com.br/webhooks/v1/plano-de-voo/hotmart/purchase" \
  -H "content-type: application/json" \
  -H "x-hotmart-hottok: <TOKEN>" \
  --data '{"id":"hotmart-smoke-planovoo-complete","event":"PURCHASE_COMPLETE","buyer":{"email":"qa@example.com"}}'
```

```bash
curl -i -X POST "https://api.decolesuacarreiraesg.com.br/webhooks/v1/plano-de-voo/hotmart/purchase" \
  -H "content-type: application/json" \
  -H "x-hotmart-hottok: <TOKEN>" \
  --data '{"id":"hotmart-smoke-planovoo-cart","event":"PURCHASE_OUT_OF_SHOPPING_CART","buyer":{"email":"qa@example.com"}}'
```

## Gate de aceite

- Os dois endpoints retornam `202`.
- `DECOLE_ESG_MENTORIA` aparece nos logs para o endpoint `decole-esg`.
- `DECOLE_PLANOVOO` aparece nos logs para o endpoint `plano-de-voo`.
- Reenvio do mesmo `id` não duplica handlers já concluídos por causa do dedupe `event_id:handler`.
- Nenhum token ou dado sensível foi registrado em arquivo versionado ou resposta pública.
