# Runbook de Cutover - Arquitetura de Funil

## Pré-check

- Branch sincronizado e testes locais verdes.
- Workers ativos:
  - `decole-api-hotmart-ingress`
  - `decole-api-funnel-ingress`
  - `decole-funnel-dispatcher`
- Queue `decole-q-funnel-events` com consumer `decole-funnel-dispatcher`.
- D1 schemas aplicados:
  - `identity_links`
  - `funnel_events`

## Comandos

### 1) Deploy incremental

```bash
scripts/deploy-incremental.sh --worker api-hotmart-ingress
scripts/deploy-incremental.sh --worker api-funnel-ingress
scripts/deploy-incremental.sh --worker funnel-dispatcher
```

### 2) Healthcheck

```bash
scripts/healthcheck-worker.sh --url https://decole-api-hotmart-ingress.chicoria.workers.dev/health
scripts/healthcheck-worker.sh --url https://decole-api-funnel-ingress.chicoria.workers.dev/health
scripts/healthcheck-worker.sh --url https://decole-funnel-dispatcher.chicoria.workers.dev/health
```

### 3) E2E de validação

```bash
bash tests/run-scenarios.sh --all --skip-sgtm
```

### 4) Confirmação de consumer

```bash
cd workers/api-hotmart-ingress
npx wrangler queues info decole-q-funnel-events
```

Se necessário, reset operacional do consumer:

```bash
npx wrangler queues consumer worker remove decole-q-funnel-events decole-funnel-dispatcher
npx wrangler queues consumer worker add decole-q-funnel-events decole-funnel-dispatcher \
  --batch-size 25 --batch-timeout 10 --message-retries 5 \
  --dead-letter-queue decole-q-funnel-events-dlq
```

## Critério de go-live

- `bash tests/verify.sh` verde 2x consecutivas.
- `PURCHASE_APPROVED` processando sem exception.
- `funnel_events` e `identity_links` recebendo dados novos.
- Sem crescimento anômalo de backlog por 24h.

> Ver `ARCHITECTURE.md` para referência completa de workers, pipelines e mapeamento mudança→teste.
