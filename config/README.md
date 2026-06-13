# Configuração Cloudflare e Catálogo

Este diretório guarda configurações operacionais que servem como referência para agents e humanos. O arquivo principal é `products.catalog.json`.

## Regra Para Agents

Antes de finalizar qualquer alteração relacionada aos itens abaixo, verifique se `products.catalog.json` precisa ser atualizado:

- produtos, aliases, nomes comerciais, códigos Hotmart, ofertas ou URLs de checkout
- páginas de venda, páginas de confirmação, redirects ou domínios públicos
- eventos de funil, chains, handlers, workers, filas, KV, D1 ou env vars
- Brevo: DOI, templates, listas, segmentos, automações, campos de funil ou emails transacionais
- tracking: GA4, Meta, sGTM, n8n, event names, payloads ou attribution
- templates em `config/email-templates/`

Se a mudança afeta comportamento operacional documentado no catálogo, atualize o catálogo no mesmo commit.

## Checklist Do `products.catalog.json`

- Atualizar `updatedAt` para a data da mudança.
- Conferir se `brevo.doiFlows` representa DOI nativo Brevo via `/contacts/doubleOptinConfirmation`.
- Conferir se `brevo.transactionalEmails` contém apenas emails transacionais via `/smtp/email`, como abandono de carrinho.
- Conferir `brevoConfig` dos eventos: `listId`, `doiTemplateId`, `doiRedirectUrl`, `cartAbandonmentTemplateId` e `funnelPrefix`.
- Conferir `links.checkoutPath`, `links.checkoutOfferPathTemplate` e `links.checkoutBaseUrl`.
- Conferir `handlers` e `backend.workers` quando houver mudança em Cloudflare Workers.
- Validar JSON com `node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"`.

Quando não for necessário atualizar o catálogo, registre isso no resumo final da tarefa.

## Route Types (`tenants.{id}.links.routes`)

Cada entrada de `tenants.{id}.links.routes` tem `path`, `type`, `productCode` e `redirectUrl`. O `type` determina o comportamento do worker `links-redirect`:

- **`checkout`** — redireciona para `checkoutBaseUrl` do produto e emite `BEGIN_CHECKOUT` em `funnel_events`.
- **`doi_confirmation`** — redireciona para a página de confirmação DOI (`redirectUrl`) e emite `SIGN_UP` em `funnel_events`. Parâmetros `rid`/`recovery_id`/`recoveryId` são removidos do redirect.
- **`channel_referral`** — redirect puro para `redirectUrl` (landing page do produto), sem emitir evento de funil. Usado para slugs de canal memoráveis (ex.: `/planodevoo/ref/cecilia`). Suporta `defaultParams`.

### `defaultParams` (apenas em `channel_referral`)

Objeto opcional de pares chave/valor (ex.: `utm_source`, `utm_medium`, `utm_campaign`) aplicados ao redirect **somente quando a chave não está presente na query string recebida** — UTMs enviados pelo visitante sempre têm precedência sobre os defaults do canal.

Convenção de path para novos canais:

- `/{produto}/ref/{slug}` para um produto específico (ex.: `/planodevoo/ref/cecilia`).
- `/ref/{slug}` (sem prefixo de produto) para a marca principal/Decole ESG (ex.: `/ref/cecilia` → `DECOLE_ESG_MENTORIA`).

O mesmo `slug`/`utm_campaign` pode ser reutilizado em ambas as formas para o mesmo canal, permitindo medir conversão por canal e por produto (`customEvent:produto`) no GA4.
