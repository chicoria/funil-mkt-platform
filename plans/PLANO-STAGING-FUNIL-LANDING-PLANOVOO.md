# Plano - Ambiente de Staging FunilMKT, Landing Pages e Plano de Voo

> **Status:** Proposto
> **Data:** 2026-05-15
> **Repos envolvidos:**
> - `/Users/chicoria/git/funil-mkt-platform`
> - `/Users/chicoria/git/decole/decolesuacarreiraesg`
> - `/Users/chicoria/git/decole-plano-de-voo-app`

---

## Objetivo

Criar um ambiente de staging isolado para validar mudancas de funil, landing pages, tracking, checkout, webhooks Hotmart, Brevo, sGTM, Plano de Voo e n8n antes de publicar em producao.

O staging deve permitir testes fim a fim sem gravar em recursos de producao e sem disparar emails reais para listas reais, mantendo a mesma arquitetura operacional da producao sempre que possivel.

---

## Principios

1. **Isolamento real de dados**
   - Staging nao deve escrever em Queue, KV, D1, Postgres, Brevo ou n8n de producao.

2. **Mesma topologia, recursos separados**
   - Workers, landing pages, app Plano de Voo e n8n devem existir em staging com nomes, dominios e secrets proprios.

3. **Tracking sem poluir producao**
   - Eventos de LP via GTM Web e eventos server-side via `emit_tracking` devem ir para sGTM/GA4/Meta de staging ou modo teste.

4. **Promocao controlada**
   - `staging` valida mudancas; `main` publica em producao apenas apos checklist e E2E.

5. **Catalogo como fonte operacional**
   - Qualquer mudanca efetiva em produtos, URLs, templates, listas, workers, eventos ou checkout deve refletir no `products.catalog.json` ou em overlay de ambiente.

---

## Estado Atual

### FunilMKT

Hoje os `wrangler.toml` apontam diretamente para producao:

- Rotas:
  - `api.decolesuacarreiraesg.com.br/funnel/*`
  - `api.decolesuacarreiraesg.com.br/webhooks/v1/*/hotmart/*`
  - `links.decolesuacarreiraesg.com.br/*`
- Queue:
  - `decole-q-funnel-events`
  - `decole-q-funnel-events-dlq`
- D1:
  - `decole-d1-identity`
  - `decole-d1-event-store`
- KV:
  - `DEDUPE_KV`
  - `IDENTITY_KV`
- Checkout Hotmart real nos links.

### Landing Pages

As landing pages estaticas usam endpoints de producao hardcoded:

- `https://api.decolesuacarreiraesg.com.br/funnel/precheckout`
- `https://links.decolesuacarreiraesg.com.br/.../checkout`
- GTM container de producao (`GTM-58CQ9K7X`) com diferenciacao por `produto`.

### Plano de Voo

O app Next.js, n8n e Postgres rodam em uma unica VPS de producao:

- `plano.decolesuacarreiraesg.com.br`
- `n8n.decolesuacarreiraesg.com.br`
- `db.decolesuacarreiraesg.com.br`

O compose atual fixa URLs de producao em `NEXT_PUBLIC_BASE_URL`, `N8N_BASE_URL` e `N8N_WEBHOOK_SUBMETER`.

---

## Arquitetura Alvo

### Dominios

| Superficie | Producao | Staging proposto |
|---|---|---|
| Landing pages | `decolesuacarreiraesg.com.br` | `staging.decolesuacarreiraesg.com.br` |
| API FunilMKT | `api.decolesuacarreiraesg.com.br` | `stg-api.decolesuacarreiraesg.com.br` |
| Links/redirect | `links.decolesuacarreiraesg.com.br` | `stg-links.decolesuacarreiraesg.com.br` |
| Plano de Voo app | `plano.decolesuacarreiraesg.com.br` | `stg-plano.decolesuacarreiraesg.com.br` |
| n8n | `n8n.decolesuacarreiraesg.com.br` | `stg-n8n.decolesuacarreiraesg.com.br` |
| Adminer/Postgres | `db.decolesuacarreiraesg.com.br` | `stg-db.decolesuacarreiraesg.com.br` |

### Fluxo de staging

```text
Landing Page staging
  -> GTM Web staging
  -> sGTM staging
  -> GA4 staging / Meta test

Landing Page staging
  -> stg-api.decolesuacarreiraesg.com.br/funnel/precheckout
  -> decole-stg-q-funnel-events
  -> decole-funnel-dispatcher-stg
  -> D1/KV staging
  -> Brevo sandbox/listas staging

stg-links.decolesuacarreiraesg.com.br/plano-de-voo/checkout
  -> Queue staging com BEGIN_CHECKOUT
  -> checkout teste ou pagina dry-run

Webhook Hotmart simulado/staging
  -> stg-api.decolesuacarreiraesg.com.br/webhooks/v1/.../hotmart/...
  -> Queue staging
  -> dispatcher staging
  -> stg-plano.decolesuacarreiraesg.com.br/api/hooks/*
  -> Postgres staging
  -> email sandbox/test

Plano de Voo staging
  -> stg-n8n.decolesuacarreiraesg.com.br/webhook/plano-de-voo/submeter
  -> Postgres staging
  -> notify stg-plano
```

---

## Recursos Cloudflare De Staging

### Workers

| Worker producao | Worker staging |
|---|---|
| `decole-api-funnel-ingress` | `decole-api-funnel-ingress-stg` |
| `decole-api-hotmart-ingress` | `decole-api-hotmart-ingress-stg` |
| `decole-funnel-dispatcher` | `decole-funnel-dispatcher-stg` |
| `decole-links-redirect` | `decole-links-redirect-stg` |
| `decole-dashboard-sync` | `decole-dashboard-sync-stg` opcional |

### Queue

| Recurso | Nome staging |
|---|---|
| Queue principal | `decole-stg-q-funnel-events` |
| DLQ | `decole-stg-q-funnel-events-dlq` |

### KV

| Binding | Nome staging |
|---|---|
| `DEDUPE_KV` | `decole-stg-kv-funnel-dedupe` |
| `IDENTITY_KV` | `decole-stg-kv-identity-links` |

### D1

| Binding | Nome staging |
|---|---|
| `IDENTITY_DB` | `decole-stg-d1-identity` |
| `EVENT_STORE_DB` | `decole-stg-d1-event-store` |

### Rotas

| Worker | Rota staging |
|---|---|
| `api-funnel-ingress-stg` | `stg-api.decolesuacarreiraesg.com.br/funnel/*` |
| `api-funnel-ingress-stg` | `stg-api.decolesuacarreiraesg.com.br/webhooks/v1/planovoo/app/event` |
| `api-hotmart-ingress-stg` | `stg-api.decolesuacarreiraesg.com.br/webhooks/v1/*/hotmart/*` |
| `links-redirect-stg` | `stg-links.decolesuacarreiraesg.com.br/*` |

---

## Eventos e Tracking

### Ownership por tipo de evento

| Evento | Dono do tracking | Backend staging faz |
|---|---|---|
| `PAGE_VIEW` | GTM Web staging | Nao entra na Queue |
| `CTA_CLICK` | GTM Web staging | Nao entra na Queue |
| `GENERATE_LEAD` | GTM Web staging -> sGTM staging | Queue staging para DOI, Brevo e Event Store; sem `emit_tracking` |
| `SIGN_UP` | GTM Web staging -> sGTM staging | Queue staging opcional para Event Store/Brevo, sem `emit_tracking` |
| `BEGIN_CHECKOUT` | dispatcher staging via `emit_tracking` | Queue staging, D1 staging, sGTM staging |
| `PURCHASE_APPROVED` | dispatcher staging via `emit_tracking` | Queue staging, D1 staging, Plano de Voo staging, email sandbox |
| `PURCHASE_OUT_OF_SHOPPING_CART` | Sem tracking server-side por padrao atual | Queue staging, Brevo sandbox/email de teste |
| cancelamentos/reembolsos/protestos | Sem tracking server-side por padrao atual | Queue staging, D1 staging, Plano de Voo staging |

### Variaveis de tracking staging

Workers staging devem usar secrets/vars separados:

```env
SGTM_ENDPOINT_URL_DECOLE_ESG=https://stg-sgtm.example.com
SGTM_ENDPOINT_URL_PLANOVOO=https://stg-sgtm.example.com
GA4_MEASUREMENT_ID=G-STAGING
GA4_API_SECRET=staging-secret
META_TEST_EVENT_CODE=TEST...
```

Landing pages staging devem enviar:

```js
window.dataLayer.push({
  environment: "staging",
  produto: "DECOLE_PLANOVOO"
});
```

O `emit_tracking` deve incluir `environment: "staging"` nos params enviados ao sGTM. Se a implementacao atual nao enviar esse parametro, adicionar no slice de tracking.

### Anti-dupla-contagem

- `GENERATE_LEAD`: medido pelo browser; backend nao executa `emit_tracking`.
- `BEGIN_CHECKOUT`: medido pelo redirect/server; CTA da LP continua como `cta_click`.
- `PURCHASE_APPROVED`: medido pelo webhook/dispatcher; nunca pelo browser.
- Evento com mesmo significado nao deve existir simultaneamente em GTM Web e `emit_tracking`.

---

## Brevo, Hotmart e Checkout

### Brevo

Staging deve comecar em modo seguro:

1. `BREVO_SANDBOX=true` no dispatcher staging quando possivel.
2. Usar lista staging separada para testes de DOI.
3. Usar templates staging ou IDs de template dedicados.
4. Usar allowlist de emails internos/teste.
5. Nunca usar segmentos/listas de producao em testes automatizados.

### Hotmart

Opcoes de staging:

1. **Preferida:** checkout/produto/oferta de teste, se disponivel na Hotmart.
2. **Fallback seguro:** `stg-links` nao redireciona para Hotmart; retorna uma pagina dry-run com payload e botao de simulacao.
3. Webhooks de staging devem usar token proprio:

```env
HOTMART_WEBHOOK_TOKEN=staging-token
```

### Checkout links

`LINKS_PRODUCTS` staging deve apontar para checkout teste ou dry-run:

```json
[
  {
    "checkoutPath": "/decole-esg/checkout",
    "checkoutBaseUrl": "https://stg-links.decolesuacarreiraesg.com.br/dry-run/decole-esg",
    "productCode": "DECOLE_ESG_MENTORIA"
  },
  {
    "checkoutPath": "/plano-de-voo/checkout",
    "checkoutBaseUrl": "https://stg-links.decolesuacarreiraesg.com.br/dry-run/plano-de-voo",
    "productCode": "DECOLE_PLANOVOO"
  }
]
```

---

## Plano de Voo Staging

### Infra recomendada

Criar VPS separada para staging.

Motivos:

- A VPS atual tem 1GB RAM e ja roda n8n, Postgres, Caddy e Next.js de producao.
- Separar staging reduz risco de indisponibilidade e vazamento de dados.
- Permite testar compose, deploy e workflows sem reiniciar stack real.

### Variaveis por ambiente

O `docker-compose.yml` deve deixar de fixar dominios de producao e passar a ler:

```env
APP_DOMAIN=stg-plano.decolesuacarreiraesg.com.br
N8N_DOMAIN=stg-n8n.decolesuacarreiraesg.com.br
DB_DOMAIN=stg-db.decolesuacarreiraesg.com.br
DATABASE_URL=postgresql://decole:${POSTGRES_PASSWORD}@postgres:5432/decole_staging
NEXT_PUBLIC_BASE_URL=https://stg-plano.decolesuacarreiraesg.com.br
N8N_BASE_URL=https://stg-n8n.decolesuacarreiraesg.com.br
N8N_WEBHOOK_SUBMETER=https://stg-n8n.decolesuacarreiraesg.com.br/webhook/plano-de-voo/submeter
N8N_NOTIFY_SECRET=staging-secret
ADMIN_SECRET=staging-admin-secret
PLANOVOO_HOOK_SECRET=staging-hook-secret
```

### n8n

Staging deve ter workflows separados e IDs proprios:

- `workflow-principal` staging
- `subfluxo-gerador-v3` staging

O workflow de deploy deve aceitar `environment=staging|production` e usar:

- `N8N_BASE_URL_STAGING`
- `N8N_API_KEY_STAGING`
- `WORKFLOW_PRINCIPAL_ID_STAGING`
- `WORKFLOW_SUBFLUXO_ID_STAGING`

---

## Branching e CI/CD

### Branches

| Branch | Ambiente | Acao |
|---|---|---|
| PR branches | local/preview | testes e dry-run |
| `staging` | staging | deploy automatico |
| `main` | producao | deploy com aprovacao/checklist |

### FunilMKT

Adicionar suporte a `environment` nos workflows:

- `.github/workflows/deploy-all-workers.yml`
- `.github/workflows/deploy-funnel-dispatcher.yml`
- `.github/workflows/deploy-incremental-hotmart-ingress.yml`
- `.github/workflows/ci-e2e-staging.yml`

Comportamento esperado:

```bash
npx wrangler deploy --env staging
npx wrangler d1 execute decole-stg-d1-event-store --remote --file config/d1/funnel_events.sql
bash tests/run-scenarios.sh --all --skip-sgtm --env-file .env.staging
```

### Landing pages

Opcoes:

1. Cloudflare Pages com branch `staging`.
2. Deploy estatico em subdominio `staging`.
3. Preview protegido por Cloudflare Access.

Requisito minimo:

- Build/deploy staging injeta endpoints staging.
- Paginas staging incluem `noindex,nofollow`.
- Formularios staging usam `stg-api` e `stg-links`.

### Plano de Voo

Atualizar workflows:

- `.github/workflows/setup-infra.yml`
- `.github/workflows/deploy-app.yml`
- `.github/workflows/deploy-n8n.yml`
- `.github/workflows/backup.yml`

Secrets separados:

```text
VPS_HOST_STAGING
VPS_SSH_KEY_STAGING
POSTGRES_PASSWORD_STAGING
BREVO_API_KEY_STAGING
N8N_NOTIFY_SECRET_STAGING
ADMIN_SECRET_STAGING
PLANOVOO_HOOK_SECRET_STAGING
N8N_API_KEY_STAGING
N8N_BASE_URL_STAGING
```

---

## Catalogo e Configuracao

### Decisao pendente

Escolher uma abordagem:

1. **Catalogo unico com secoes por ambiente**
   - Exemplo: `environments.production`, `environments.staging`.
   - Mais visivel, mas aumenta tamanho do catalogo.

2. **Catalogo base + overlay**
   - Exemplo: `config/products.catalog.json` + `config/environments/staging.json`.
   - Melhor separacao, mas exige resolver overlay no deploy/testes.

Recomendacao: **catalogo base + overlay**.

### Overlay proposto

Arquivo:

```text
config/environments/staging.json
```

Conteudo minimo:

```json
{
  "environment": "staging",
  "domains": {
    "api": "stg-api.decolesuacarreiraesg.com.br",
    "links": "stg-links.decolesuacarreiraesg.com.br",
    "site": "staging.decolesuacarreiraesg.com.br",
    "plano": "stg-plano.decolesuacarreiraesg.com.br",
    "n8n": "stg-n8n.decolesuacarreiraesg.com.br"
  },
  "cloudflare": {
    "queue": "decole-stg-q-funnel-events",
    "dlq": "decole-stg-q-funnel-events-dlq",
    "d1": {
      "identity": "decole-stg-d1-identity",
      "eventStore": "decole-stg-d1-event-store"
    },
    "kv": {
      "identity": "decole-stg-kv-identity-links",
      "dedupe": "decole-stg-kv-funnel-dedupe"
    }
  },
  "tracking": {
    "environment": "staging",
    "ga4MeasurementId": "G-STAGING"
  },
  "safety": {
    "brevoSandbox": true,
    "noindex": true
  }
}
```

Se algum valor operacional do catalogo mudar, atualizar tambem:

- `config/products.catalog.json`
- campo `updatedAt`
- `config/README.md`, se a regra operacional mudar

---

## Slices De Implementacao

### Slice 1 - Recursos Cloudflare staging

**Objetivo:** criar recursos isolados e bindings sem mudar producao.

- Criar Queue/DLQ staging.
- Criar KV staging.
- Criar D1 staging.
- Aplicar schemas D1.
- Adicionar `[env.staging]` nos `wrangler.toml`.
- Configurar secrets staging.
- Deploy dry-run dos workers staging.

**Aceite:**

- `wrangler deploy --env staging --dry-run` passa para todos os workers.
- `wrangler d1 execute` mostra tabelas em D1 staging.
- Nenhum worker staging referencia Queue/D1/KV de producao.

### Slice 2 - Deploy dos workers staging

**Objetivo:** publicar ingress, dispatcher e links staging.

- Deploy `api-funnel-ingress-stg`.
- Deploy `api-hotmart-ingress-stg`.
- Deploy `funnel-dispatcher-stg`.
- Deploy `links-redirect-stg`.
- Validar `/health`.
- Validar envio manual para `/funnel/precheckout`.

**Aceite:**

- Evento entra na Queue staging.
- Dispatcher grava em D1 staging.
- Dedupe grava em KV staging.
- Logs identificam `environment=staging`.

### Slice 3 - Landing pages staging

**Objetivo:** publicar LPs com endpoints staging e tracking seguro.

- Criar config JS/JSON por ambiente.
- Substituir hardcodes de API e links por config.
- Publicar em `staging.decolesuacarreiraesg.com.br`.
- Adicionar `noindex,nofollow`.
- Configurar GTM/sGTM staging.

**Aceite:**

- Submit de precheckout chama `stg-api`.
- Redirect chama `stg-links`.
- `generate_lead` aparece no sGTM/GA4 staging.
- Nenhum evento aparece em GA4 producao.

### Slice 4 - Plano de Voo staging

**Objetivo:** subir app, n8n e Postgres staging.

- Criar VPS staging.
- Parametrizar compose/Caddyfile por ambiente.
- Criar `.env` staging.
- Subir stack.
- Deploy app Next.js staging.
- Importar workflows n8n staging.
- Criar seed minimo de dados.

**Aceite:**

- `stg-plano` responde.
- `stg-n8n` responde.
- `stg-db` protegido.
- Submissao chama n8n staging e retorna status para app staging.

### Slice 5 - Integração FunilMKT -> Plano de Voo staging

**Objetivo:** validar compra aprovada simulada ate token do Plano de Voo.

- Configurar `PLANOVOO_API_BASE_URL=https://stg-plano...`.
- Configurar `PLANOVOO_HOOK_SECRET` igual nos dois lados.
- Simular `PURCHASE_APPROVED`.
- Validar chamada `POST /api/hooks/purchase`.
- Validar email sandbox/purchase-link.
- Validar token no Postgres staging.

**Aceite:**

- Compra simulada gera token em staging.
- Link recebido aponta para `stg-plano`.
- Reembolso/protesto simulado atualiza status no app staging.

### Slice 6 - E2E staging no CI

**Objetivo:** automatizar regressao antes de producao.

- Corrigir `.github/workflows/ci-e2e-staging.yml` para usar recursos staging.
- Adicionar `.env.staging.example`.
- Rodar cenarios:
  - lead ESG
  - lead Plano de Voo
  - begin checkout
  - purchase approved
  - refund/protest
  - identity stitching

**Aceite:**

- Workflow manual passa contra staging.
- `main` exige staging verde antes de deploy producao.

---

## Checklist De Go-Live Do Staging

- [ ] DNS dos subdominios staging configurado.
- [ ] Cloudflare Access/basic auth em superficies privadas.
- [ ] Workers staging publicados com nomes `-stg`.
- [ ] Queue/DLQ staging criadas.
- [ ] KV/D1 staging criados e schemas aplicados.
- [ ] Landing pages staging publicadas com `noindex,nofollow`.
- [ ] Formularios staging apontam para `stg-api`.
- [ ] Links staging apontam para `stg-links`.
- [ ] sGTM/GA4/Meta staging configurados.
- [ ] `GENERATE_LEAD` nao executa `emit_tracking`.
- [ ] `BEGIN_CHECKOUT` e `PURCHASE_APPROVED` executam `emit_tracking` apenas em staging.
- [ ] Brevo em sandbox ou listas/templates staging.
- [ ] Hotmart token staging configurado.
- [ ] Plano de Voo staging com Postgres separado.
- [ ] n8n staging com workflows separados.
- [ ] E2E staging verde.
- [ ] Documentacao e catalogo/overlay atualizados.

---

## Riscos e Mitigacoes

| Risco | Mitigacao |
|---|---|
| Staging escrever em producao | Nomear recursos com `stg`, revisar `wrangler.toml`, smoke test consultando D1 staging |
| Dupla contagem de eventos | Manter ownership por evento; `GENERATE_LEAD` sem `emit_tracking` |
| Email real para leads reais | `BREVO_SANDBOX=true`, allowlist e listas staging |
| Checkout real em teste | `stg-links` com dry-run ou checkout teste |
| n8n staging chamar app producao | Variaveis `NEXT_PUBLIC_BASE_URL`, `N8N_WEBHOOK_SUBMETER` e workflow IDs separados |
| VPS staging impactar producao | VPS separada |
| Dados sensiveis em staging | Seed anonimizado e sem dump bruto de producao |

---

## Rollback

Staging nao deve exigir rollback de producao. Se um deploy staging quebrar:

1. Desativar rotas staging ou reverter worker `-stg`.
2. Pausar consumer da Queue staging.
3. Desativar workflows n8n staging.
4. Reverter branch `staging`.
5. Limpar Queue/DLQ staging, se necessario.

Producao nao deve ser alterada durante esses passos.

---

## Definition Of Done

O ambiente de staging esta pronto quando:

- Todos os dominios staging respondem.
- Todos os recursos de dados sao separados dos de producao.
- E2E completo passa usando apenas recursos staging.
- Tracking staging aparece em sGTM/GA4/Meta teste e nao aparece em producao.
- Compra aprovada simulada do Plano de Voo gera token e email de teste no app staging.
- Reembolso/protesto simulados atualizam status no app staging.
- O processo de promocao para producao esta documentado e depende do staging verde.

