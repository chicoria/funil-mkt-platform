# Configuração Cloudflare e Catálogo

Este diretório guarda configurações operacionais que servem como referência para agents e humanos. O arquivo principal é `products.catalog.json`.

## Regra Para Agents

Antes de finalizar qualquer alteração relacionada aos itens abaixo, verifique se `products.catalog.json` precisa ser atualizado:

- produtos, aliases, nomes comerciais, códigos Hotmart, ofertas ou URLs de checkout
- páginas de venda, páginas de confirmação, redirects ou domínios públicos
- eventos de funil, chains, handlers, workers, filas, KV, D1 ou env vars
- Brevo: DOI, templates, listas, segmentos, automações, campos de funil ou emails transacionais
- tracking: GA4, Meta, sGTM, n8n, event names, payloads ou attribution
- templates em `backend/cloudflare/config/email-templates/`

Se a mudança afeta comportamento operacional documentado no catálogo, atualize o catálogo no mesmo commit.

## Checklist Do `products.catalog.json`

- Atualizar `updatedAt` para a data da mudança.
- Conferir se `brevo.doiFlows` representa DOI nativo Brevo via `/contacts/doubleOptinConfirmation`.
- Conferir se `brevo.transactionalEmails` contém apenas emails transacionais via `/smtp/email`, como abandono de carrinho.
- Conferir `brevoConfig` dos eventos: `listId`, `doiTemplateId`, `doiRedirectUrl`, `cartAbandonmentTemplateId` e `funnelPrefix`.
- Conferir `links.checkoutPath`, `links.checkoutOfferPathTemplate` e `links.checkoutBaseUrl`.
- Conferir `handlers` e `backend.workers` quando houver mudança em Cloudflare Workers.
- Validar JSON com `node -e "JSON.parse(require('fs').readFileSync('backend/cloudflare/config/products.catalog.json','utf8'))"`.

Quando não for necessário atualizar o catálogo, registre isso no resumo final da tarefa.
