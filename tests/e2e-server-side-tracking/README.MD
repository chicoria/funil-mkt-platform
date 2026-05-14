# E2E - Server-Side Tracking (GA4 + Meta)

Objetivo: validar que eventos gerados **somente no servidor** chegam ao GA4 e à Meta via `emit_tracking` -> sGTM.

## Escopo

- Sem dependência de GTM Web/browser.
- Trilha validada:
  1. Ingress/Queue Cloudflare
  2. `funnel-dispatcher` (`emit_tracking`)
  3. sGTM (`/mp/collect`)
  4. GA4
  5. Meta CAPI (Test Events)

## Pré-requisitos

- Worker `funnel-dispatcher` com `emit_tracking` ativo para o evento testado.
- sGTM publicado com client `Measurement Protocol (GA4)` atendendo `/mp/collect`.
- `SGTM_ENDPOINT_URL*`, `GA4_MEASUREMENT_ID`, `GA4_API_SECRET` configurados.
- Meta com `META_TEST_EVENT_CODE_*` configurado para o produto.
- Permissão de leitura em logs Cloudflare/sGTM para troubleshooting.

## Evento canário recomendado

Use um `event_id` único por execução:

- Formato: `e2e-ss-<timestamp>`
- Exemplo de evento:
  - `event_type`: `PURCHASE_APPROVED` (ou `BEGIN_CHECKOUT`)
  - `product_code`: produto real do catálogo
  - `transaction_id`: único
  - `value` e `currency` válidos

## Runner automatizado

Arquivo:

- `run-e2e-server-side-tracking.sh`

Este runner automatiza:

1. envio de webhook canário para Hotmart ingress (ou uso de `--event-id` existente);
2. espera do evento no `EVENT_STORE_DB` (D1);
3. `replay-emit-tracking.mjs --apply` para disparo server-side em `/mp/collect`;
4. checagem opcional em logs sGTM (Cloud Run), quando `gcloud` e variáveis de projeto estão disponíveis;
5. validação pós-envio no GA4 (Realtime API);
6. validação de entrega Meta por API direta (`/{pixel_id}/stats`, delta de contagem);
7. fallback de validação Meta por evidência de logs do sGTM (Cloud Run Logging API).

### Uso rápido

```bash
cd tests/e2e-server-side-tracking
chmod +x run-e2e-server-side-tracking.sh
./run-e2e-server-side-tracking.sh
```

Token Cloudflare aceito pelo runner:

- `CLOUDFLARE_API_TOKEN` (preferencial), ou
- `CLOUDFLARE_AGENTS_AI_TOKEN` (fallback automático para `CLOUDFLARE_API_TOKEN`).

### Opções úteis

```bash
./run-e2e-server-side-tracking.sh --event-id <EVENT_ID_EXISTENTE>
./run-e2e-server-side-tracking.sh --product-code DECOLE_ESG_MENTORIA --hotmart-product planovoo
./run-e2e-server-side-tracking.sh --strict-sgtm-logs
./run-e2e-server-side-tracking.sh --strict-destinations
```

### Validação automática de destino final

- **GA4**: usa `verify-ga4-realtime.mjs` e consulta a Realtime API.
  - tenta primeiro por `event_id` via dimensão `customEvent:event_id`;
  - se a dimensão não existir, cai para validação por `event_name`.
- **Meta**: usa `verify-sgtm-meta-delivery.mjs` e consulta Cloud Logging para encontrar evidência do mesmo `event_id` com hints de entrega Meta no serviço Cloud Run do sGTM.
- **Meta (direto por API)**: usa `verify-meta-stats-delta.mjs`.
  - captura baseline por `event_name` via `/{pixel_id}/stats`;
  - após replay, valida `delta >= 1` na mesma janela.
- **Fallback Meta por logs**: se o delta API não puder ser comprovado, tenta correlação em Cloud Logging.

## Critérios de aceite

- `emit_tracking` sem erro.
- sGTM com client/tag firing esperados.
- GA4 recebeu evento com payload correto.
- Meta recebeu o mesmo `event_id`.

Observação: no modo padrão, o runner tenta validar GA4 e Meta automaticamente. Em ambientes sem permissões/configuração de API suficientes, use `--strict-destinations` para exigir validação completa e falhar quando faltar evidência.

Pré-requisitos para modo estrito funcionar bem:

- dimensão custom de GA4 para `event_id` disponível na Realtime API;
- token Meta com acesso ao Pixel `/stats` e janela com baixo ruído para observar delta;
- logging do sGTM com informação suficiente para correlacionar `event_id` e entrega Meta (fallback).

## Evidência mínima a anexar no ticket

- `event_id` do canário
- horário do disparo (UTC)
- resultado por etapa (Cloudflare, sGTM, GA4, Meta)
- print/log curto de falha (quando houver)

## Troubleshooting rápido

- `400` em `/mp/collect`: revisar formato de `client_id` (GA4 exige `digits.digits`) e client MP GA4 publicado.
- Evento não aparece no GA4: confirmar `measurement_id`/`api_secret` e firing da tag GA4 no sGTM.
- Evento não aparece na Meta: confirmar tag CAPI ativa, token e `test_event_code` do produto.
