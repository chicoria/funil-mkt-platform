# Plano de Migracao - Catalogo Multiproduto

Data: 2026-04-16

## Objetivo

Suportar catalogo multiproduto de ponta a ponta (Workers + paginas de venda), com precheckout por produto no Brevo e redirecionamento via links.

## Escopo

- Workers:
  - `api-precheckout`
  - `links-redirect`
  - `api-events-consumer`
- Frontend:
  - `site/index.html`
  - `site/planodevoo/index.html`
- Config central:
  - `backend/cloudflare/config/products.catalog.json`

## Diagnostico Atual

- `api-precheckout` ainda usa lista unica (`BREVO_LIST_ID`), sem resolucao por produto.
- `site/index.html` ja usa precheckout inline completo.
- `site/planodevoo/index.html` ainda nao usa o mesmo fluxo de precheckout (CTAs apontam para outra pagina).
- `links-redirect` e `api-events-consumer` tem trechos ainda fixos por produto.

## Arquitetura Alvo

1. `products.catalog.json` como source-of-truth para:
- `brevo.lists.precheckout.id`
- `brevo.templates.doi.id`
- `links.checkoutPath` e `links.checkoutBaseUrl`
- `brevo.funnelPrefix` e campos `funnelFields`

2. Workers consumindo config derivada por produto, evitando hardcode:
- `PRECHECKOUT_PRODUCTS=[{code,aliases,listId,doiTemplateId,doiRedirectUrl}]`
- `HOTMART_PRODUCTS=[{id,name,prefix,checkoutCode,offerCode,checkoutPath}]`
- `LINKS_PRODUCTS=[{checkoutPath,checkoutBaseUrl}]`

3. Frontend com precheckout reutilizavel por pagina via `data-*`:
- `data-product-code`
- `data-redirect-url`
- `data-form-id`

## Plano de Alteracoes

### Fase 1 - Catalogo e contrato de configuracao

1. Atualizar `products.catalog.json` com lista de precheckout do Plano de Voo:
- `products.DECOLE_PLANOVOO.brevo.lists.precheckout` -> lista `precheckout_planovoo`.
2. Garantir template DOI por produto (ou fallback global documentado).
3. Formalizar contrato de config derivada por worker.

### Fase 2 - Worker api-precheckout multiproduto

1. Aceitar `product_code`/`produto` no payload.
2. Resolver produto por `code` + `aliases`.
3. Selecionar `listId` por produto (em vez de `BREVO_LIST_ID` unico).
4. Selecionar DOI por produto (`templateId` e redirect).
5. Manter fallback retrocompativel para o fluxo atual.
6. Atualizar testes unitarios cobrindo os dois produtos.

### Fase 3 - Paginas de venda

1. `site/index.html`:
- manter fluxo atual
- garantir envio de `product_code=DECOLE_ESG_MENTORIA`
- manter redirect para `https://links.decolesuacarreiraesg.com.br/decole-esg/checkout`

2. `site/planodevoo/index.html`:
- aplicar o mesmo precheckout inline (mesmo padrao de formulario/validacao/captcha)
- enviar para `https://api.decolesuacarreiraesg.com.br/brevo`
- incluir `product_code=DECOLE_PLANOVOO`
- redirect para `https://links.decolesuacarreiraesg.com.br/plano-de-voo/checkout`

3. Extrair JS compartilhado de precheckout para reduzir duplicacao e facilitar novos produtos.

### Fase 4 - links-redirect e events-consumer

1. `links-redirect`:
- migrar handlers fixos para tabela derivada (`checkoutPath -> checkoutBaseUrl`).

2. `api-events-consumer`:
- garantir `HOTMART_PRODUCTS` com ambos produtos
- remover fallback fixo para checkout ESG
- usar sempre dados do produto resolvido.

3. Atualizar `wrangler.toml` dos workers conforme nova estrategia de config.

### Fase 5 - Validacao e rollout

1. Rodar testes unitarios dos 3 workers.
2. Smoke test de precheckout para DECOLE e Plano de Voo.
3. Confirmar no Brevo:
- contato DECOLE entra na lista DECOLE
- contato Plano de Voo entra na lista `precheckout_planovoo`
4. Confirmar redirects por links com query params preservados.
5. Publicar em etapas:
- workers
- paginas
- verificacao final

## Criterios de Aceite

- Cada pagina envia lead para a lista Brevo correta por produto.
- Cada pagina redireciona para checkout correto via `links.decolesuacarreiraesg.com.br`.
- Funil Brevo (`*_FUNIL_*`) atualizado corretamente por produto.
- Adicionar novo produto exige apenas catalogo + config derivada, sem novos hardcodes.

## Sugestao de Quebra em PRs

1. PR1: Catalogo + `api-precheckout` multiproduto + testes.
2. PR2: `site/index.html` e `site/planodevoo/index.html` com precheckout multiproduto.
3. PR3: `links-redirect` + `api-events-consumer` + ajustes finais de config/docs.
