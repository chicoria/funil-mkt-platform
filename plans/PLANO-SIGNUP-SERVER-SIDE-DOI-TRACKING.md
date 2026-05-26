# Plano — SIGN_UP Server-Side Para Confirmacao DOI

> **Status:** Proposto
> **Data:** 2026-05-26
> **Escopo:** `links-redirect` -> Queue -> `funnel-dispatcher` -> `emit_tracking` -> sGTM -> GA4 + Meta CAPI

## Objetivo

Tornar `SIGN_UP` o evento canonico server-side para confirmacao DOI dos produtos DECOLE.

O caminho desejado passa a ser:

```text
links-redirect -> decole-q-funnel-events -> funnel-dispatcher -> emit_tracking -> sGTM -> GA4 + Meta CAPI
```

Com isso, a confirmacao DOI deixa de depender de evento browser-side `sign_up`/`CompleteRegistration` em paginas de confirmacao ou regras GTM por URL.

## Escopo

Produtos afetados:

- `DECOLE_ESG_MENTORIA`
- `DECOLE_PLANOVOO`

Repos/areas afetadas:

- `funil-mkt-platform/config/products.catalog.json`
- `funil-mkt-platform/workers/funnel-dispatcher/src/handlers/index.ts`
- `decolesuacarreiraesg/site/confirmacao.html`
- `decolesuacarreiraesg/site/planodevoo/confirmacao.html`
- GTM Web `GTM-58CQ9K7X`, se houver regra de conversao por URL

Fora de escopo:

- Alterar checkout Hotmart.
- Alterar template DOI Brevo, exceto se for encontrada referencia direta a tracking.
- Alterar `GENERATE_LEAD`.
- Criar campanhas Meta Ads.

## Mudancas Detalhadas

### 1. Catalogo

Arquivo: `config/products.catalog.json`

Para os eventos `SIGN_UP` dos dois produtos, alterar a chain para:

```text
resolve_identity
upsert_event_store
enrich_attribution
update_brevo_funnel
emit_tracking
```

Atualizar `destinations` para incluir:

```text
Brevo
Event Store
sGTM
```

Atualizar `updatedAt` para a data da mudanca.

Remover ou ajustar a documentacao de `landingPages[].events` que hoje indica `sign_up` browser-side mapeado para Meta `CompleteRegistration`. O catalogo deve deixar claro que `CompleteRegistration` nasce do `SIGN_UP` server-side via `emit_tracking`, nao da pagina de confirmacao.

### 2. Dispatcher

Arquivo: `workers/funnel-dispatcher/src/handlers/index.ts`

Adicionar mapeamento explicito:

```ts
if (eventType === "SIGN_UP") return "sign_up";
```

em `eventToGa4Name()`.

Adicionar mapeamento explicito:

```ts
if (eventType === "SIGN_UP") return "CompleteRegistration";
```

em `eventToMetaName()`.

Nao alterar os mapeamentos existentes:

- `GENERATE_LEAD` -> GA4 `generate_lead` / Meta `Lead`
- `BEGIN_CHECKOUT` -> GA4 `begin_checkout` / Meta `InitiateCheckout`
- `PURCHASE_APPROVED` -> GA4 `purchase` / Meta `Purchase`

### 3. Paginas De Confirmacao

Arquivos:

- `/Users/chicoria/git/decole/decolesuacarreiraesg/site/confirmacao.html`
- `/Users/chicoria/git/decole/decolesuacarreiraesg/site/planodevoo/confirmacao.html`

Verificar e remover qualquer emissao direta de conversao:

```js
dataLayer.push({ event: "sign_up" })
fbq("track", "CompleteRegistration")
gtag("event", "sign_up")
```

Manter `dataLayer.push({ produto: "..." })` e GTM nas paginas, pois isso preserva pageview e contexto de produto sem duplicar conversao.

### 4. GTM Web

Verificar se o container `GTM-58CQ9K7X` tem trigger por URL que dispara `sign_up` ou Meta `CompleteRegistration` em:

- `/confirmacao.html`
- `/planodevoo/confirmacao.html`

Se existir, desativar a conversao browser-side apos publicar o server-side `SIGN_UP`.

Regra final:

- Pageview da confirmacao pode continuar browser-side.
- Conversao `CompleteRegistration` deve ser emitida uma unica vez, pelo server-side `SIGN_UP`.

### 5. Diagrama

Atualizar `plans/architecture.puml` para mostrar:

- `/decole-esg/signup` e `/plano-de-voo/signup` chegam em `links-redirect`.
- Essas rotas disparam `SIGN_UP`.
- `SIGN_UP` executa:

```text
resolve_identity -> upsert_event_store -> enrich_attribution -> update_brevo_funnel -> emit_tracking
```

- `emit_tracking` envia para sGTM, que roteia para GA4 `sign_up` e Meta `CompleteRegistration`.
- Nao ha `sign_up`/`CompleteRegistration` browser-side nas paginas de confirmacao.

Regenerar:

```text
plans/funil-mkt-platform-architecture.png
```

## Testes

No `workers/funnel-dispatcher`:

```bash
npm test
npm run typecheck
```

Adicionar/ajustar testes para garantir:

- `SIGN_UP` resolve chain com `emit_tracking`.
- Payload sGTM de `SIGN_UP` usa GA4 `sign_up`.
- Payload sGTM de `SIGN_UP` usa `meta_event_name: "CompleteRegistration"`.
- `GENERATE_LEAD` continua sem `emit_tracking` no dispatcher.

Para diagramas:

```bash
plantuml -checkonly plans/architecture.puml
plantuml -tpng plans/architecture.puml
```

Validacao final:

```bash
git diff --check
```

## Validacao Operacional

1. Clicar link DOI real ou de teste.
2. Confirmar `SIGN_UP` na Queue/Event Store.
3. Confirmar execucao de `emit_tracking`.
4. Confirmar hit no sGTM.
5. Confirmar no GA4 evento `sign_up`.
6. Confirmar no Meta Events Manager um unico `CompleteRegistration`.
7. Confirmar ausencia de duplicidade browser-side.

## Riscos

- Duplicidade se GTM Web ainda tiver regra de `CompleteRegistration` por URL.
- Perda temporaria de atribuicao se o DOI link nao carregar parametros suficientes e `enrich_attribution` nao encontrar evento anterior do mesmo perfil.
- Divergencia entre catalogo e diagramas se `plans/architecture.puml` nao for atualizado no mesmo slice.

## Rollback

1. Remover `emit_tracking` da chain `SIGN_UP` no catalogo.
2. Reverter mapeamentos `SIGN_UP` em `eventToGa4Name()` e `eventToMetaName()`.
3. Reativar tracking browser-side de `sign_up`/`CompleteRegistration`, se ele tiver sido desativado no GTM.
4. Revalidar que DOI ainda grava `SIGN_UP` operacional em Brevo/Event Store.

## Criterios De Aceite

- `SIGN_UP` e processado server-side e executa `emit_tracking`.
- GA4 recebe `sign_up`.
- Meta recebe `CompleteRegistration`.
- Nao ha duplicidade de `CompleteRegistration`.
- `GENERATE_LEAD` continua sem dupla contagem.
- Diagrama e PNG representam o fluxo real.
