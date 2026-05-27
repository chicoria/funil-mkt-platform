# Plano — SIGN_UP Server-Side Para Confirmacao DOI

> **Status:** Concluído ✅
> **Data proposta:** 2026-05-26  |  **Data execução:** 2026-05-27
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

---

## Registo De Execucao (2026-05-27)

### Changes aplicadas

**`config/products.catalog.json`**
- `DECOLE_ESG_MENTORIA.SIGN_UP` e `DECOLE_PLANOVOO.SIGN_UP`:
  - `delivery: "both"` → `"server_queue"` (seguindo modelo `PURCHASE_APPROVED`)
  - `source: "site"` → `"links-redirect"` (documentacao precisa da origem real)
  - chain: adicionado `enrich_attribution` + `emit_tracking`
  - destinations: adicionado `"sGTM"`
- `updatedAt` actualizado para 2026-05-26

**`workers/funnel-dispatcher/src/handlers/index.ts`**
- `eventToGa4Name`: mapeamento explicito `SIGN_UP` → `"sign_up"`
- `eventToMetaName`: mapeamento explicito `SIGN_UP` → `"CompleteRegistration"` (corrige bug critico — fallback retornava `"SIGN_UP"` bruto para Meta CAPI)

**`scripts/replay-emit-tracking.mjs`**
- Idem: `eventToGa4Name` e `eventToMetaName` locais actualizados (script tinha logica duplicada dessincronizada)

**`tests/scenarios/13-sign-up-doi.mjs`** (novo)
- Cenario E2E end-to-end: redirect 302, evento D1, identity, fbp, sGTM planned + replay

**sGTM container `GTM-K6Q4H6BR`** (versao 19 publicada)
- Tag `Meta CAPI - Dynamic by Tenant/Product`: `testEventCode` alterado de `{{LT - Meta Test Event Code by Tenant/Product}}` (hardcoded `TEST19244`) para `{{ED - test_event_code}}` (lido dos params do evento dinamicamente)
- Em producao: campo vazio → sem test mode
- Em E2E: usa codigo passado no payload

**GitHub Actions secrets**
- Adicionados `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

**Cloudflare Secrets Store**
- `meta_access_token_decole` actualizado com novo token do system user `agent-api`

**`.env.local`**
- `META_SYSTEM_USER_ACCESS_TOKEN` actualizado (token regenerado)
- `META_TEST_EVENT_CODE_DECOLE_ESG` → `TEST24981`
- `META_TEST_EVENT_CODE_PLANOVOO` → `TEST53754`

### Desvios ao plano original

| Item | Plano | Executado |
|---|---|---|
| `delivery` field | Nao mencionado | Alterado `both` → `server_queue` por recomendacao da avaliacao |
| Paginas confirmacao.html | Remover fbq/dataLayer sign_up | Ja estavam limpas — nada a fazer |
| sGTM testEventCode | Nao estava no plano | Fix adicional: hardcoded → dinamico via `{{ED - test_event_code}}` |
| GitHub Actions secrets | Nao estava no plano | Adicionados durante deploy (CF_API_TOKEN ausente causou falha) |

### Validacao operacional

- Cenario E2E 13: **6/6 pass** (27s) — redirect 302, D1, identity, fbp, sGTM planned, CompleteRegistration enviado com `TEST24981`
- Deploy `funnel-dispatcher` via GitHub Actions: **sucesso** (typecheck + 183 testes + wrangler deploy)
- Meta Events Manager: `CompleteRegistration` visivel com codigo `TEST24981`

### Commits

- `068cf6d` — catalog + dispatcher (SIGN_UP chain + mapeamentos)
- `ee3c0bc` — replay script fix + cenario E2E 13
