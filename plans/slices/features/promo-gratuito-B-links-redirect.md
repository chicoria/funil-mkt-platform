# Fatia B — Promo gratuito: rota genérica no links-redirect

> Feature: `workers/links-redirect` + catálogo
> Estimativa: 2–3 horas
> Depende de: nada (pode ir antes ou em paralelo com a Fatia A)

## Status

| Campo | Valor |
|---|---|
| Estado | Em revisão final — código completo e verde, aguardando decisão do usuário sobre commit/deploy |
| Started | 2026-09-11 |
| Completed | — |
| Commit final | — (nenhum commit criado ainda; ver Execução) |

## Contexto

O link que a Elizete manda na DM precisa ser curto, de marca e rastreável
(`links.decolesuacarreiraesg.com.br/...`) — não a URL crua do app.

O worker já resolve um path dinâmico análogo: `/{produto}/checkout/offer/{codigo}`
via regex `^(.+)\/checkout\/offer\/([^/]+)$` (`src/index.ts:500`). Esta fatia
espelha esse padrão para promo, de forma que **criar uma campanha nova nunca exija
mexer no worker nem no catálogo** — só inserir uma linha na tabela de códigos.

Diferença central para o `channel_referral`: o destino não é a LP fixa da rota, é
`{promoBaseUrl}/promo/{code}`, com o `{code}` vindo do path.

## Mudança

### 1. Catálogo — `config/products.catalog.json`

Um campo novo por produto, configurado **uma vez**:

```json
"DECOLE_PLANOVOO": {
  "links": {
    "checkoutBaseUrl": "<ja existe>",
    "promoBaseUrl": "https://plano.decolesuacarreiraesg.com.br"
  }
}
```

### 2. `workers/links-redirect/src/index.ts`

Nova função pura (exportada para teste), espelhando `resolveCheckoutByCatalog`:

```ts
export function resolvePromoByCatalog(
  catalog: LinksCatalog,
  tenantId: string,
  productPrefix: string
): { promoBaseUrl: string; productCode: string } | null
```

No `fetch`, junto do bloco de `checkout/offer` (~linha 500):

```ts
const promoMatch = rawPath.match(/^(.+)\/promo\/([^/]+)$/i);
// promoMatch[1] = prefixo do produto (ex.: "planodevoo")
// promoMatch[2] = code da campanha
```

Resultado: `302` para `{promoBaseUrl}/promo/{code}`, repassando a query string
recebida (`email`, `name`, `utm_*`) via `appendQueryParams`, com `cache-control: no-store`.

**Sem evento de funil.** `BEGIN_CHECKOUT` não se aplica — não há checkout. Se um dia
for preciso medir resgates, criar um tipo próprio (`PROMO_CLICK`), fora desta fatia.

### 3. `README.MD` do worker

Documentar a rota nova na seção de rotas, junto das de checkout e `channel_referral`.

## Testes (TDD Red primeiro)

`workers/links-redirect/test/unit/promo-redirect.test.ts`
- `/planodevoo/promo/abc123` → 302 para `https://plano.../promo/abc123`
- query params repassados (`?email=x@y.com&name=Fulana` sobrevivem ao redirect)
- produto sem `promoBaseUrl` no catálogo → não casa a rota (404/fallback), sem 500
- código com caracteres de path (`/promo/a/b`) não casa a regex — só um segmento
- prefixo desconhecido (`/inexistente/promo/x`) → não resolve
- `cache-control: no-store` presente
- worker continua agnóstico: `grep -rE "DECOLE|PLANOVOO|ESG" src/index.ts` → 0 matches

## Revisão G.12

> ⛔ GUARD RAIL: agente separado obrigatório antes de DONE.

Pontos de atenção:
- **Open redirect impossível?** O host tem que vir de `promoBaseUrl` do catálogo;
  nada do path/query do usuário pode influenciar host ou path de destino — mesmo
  critério aplicado na revisão do `precheckout-catalog-redirect`
- Regex não captura mais de um segmento no `{code}`
- Zero hardcode de tenant/produto no worker
- TDD Red antes de Green no log

## Execução (append-only)

**2026-09-11** — Implementação completa em `workers/links-redirect`, TDD Red→Green:

- Red: `test/unit/promo-redirect.test.ts` escrito primeiro, confirmado falhando
  (`resolvePromoByCatalog` inexistente, rota `/promo/` não wireada).
- Green: `resolvePromoByCatalog` (espelha `resolveCheckoutByCatalog`), branch novo em
  `fetch()` antes do bloco `checkout`, campo `promoBaseUrl` em
  `config/products.catalog.json` (produto `DECOLE_PLANOVOO`), `README.MD` atualizado.
  55/55 testes do worker verdes (0 regressão nos 42 pré-existentes), `tsc --noEmit`
  limpo. `npm run check-config` limpo. Único outro consumidor de teste do catálogo
  (`workers/funnel-dispatcher/test/unit/catalog-adapter.test.ts`) segue 24/24 verde.
- Revisão G.12 por agente separado (`ecc:code-reviewer`, sem contexto prévio):
  **0 MUST-FIX**. 1 SHOULD-FIX (rotas `type: "checkout"` eram aceitas como alias de
  prefixo, criando `/plano-de-voo/promo/...` como segunda URL canônica não
  documentada para o mesmo destino de `/planodevoo/promo/...` — inofensivo hoje, mas
  contradizia a decisão documentada). 1 NICE-TO-HAVE (`encodeURIComponent(code)` por
  defesa em profundidade, mesmo sem exploit confirmado). Ambos corrigidos — filtro
  restrito a `channel_referral`, teste de regressão adicionado
  (`test/unit/promo-redirect.test.ts`, "nao reaproveita o prefixo de checkout").
  Suite final: 56/56 verde, tsc limpo.
- **Pendente**: nenhum commit criado (sessão não commita sem pedido explícito).
  Nenhum deploy do worker disparado — diferente da Fatia A (Next.js/VPS via
  GitHub Actions já mapeado nesta sessão), o pipeline de deploy do
  `links-redirect` (Cloudflare Workers, provavelmente via `wrangler`) ainda não foi
  investigado nesta sessão.

## Gotchas / lições aprendidas

- **Duas convenções de prefixo coexistem no catálogo para o mesmo produto**: rota
  `checkout` usa `plano-de-voo` (slug histórico da Hotmart), rotas
  `channel_referral` usam `planodevoo` (sem hífen). O exemplo do próprio slice
  (`/planodevoo/promo/abc123`) só faz sentido com a convenção `channel_referral` —
  reaproveitar cegamente qualquer rota existente por prefixo (incluindo `checkout`)
  cria uma segunda URL válida não intencional para o mesmo destino. Corrigido
  restringindo `resolvePromoByCatalog` a `type === "channel_referral"` apenas
  (achado da revisão G.12, não estava explícito na spec original).
- **Verificação "zero hardcode" (`grep -rE "DECOLE|PLANOVOO|ESG" src/index.ts")**:
  vitest não tem `readFileSync`/tipos do Node disponíveis neste worker
  (`tsconfig.json` usa só `lib: ["ES2022", "WebWorker"]`, sem `@types/node`) — a
  forma que funciona sem mexer no tsconfig é importar o arquivo fonte via sufixo
  `?raw` do Vite (`import indexSource from "../../src/index.ts?raw"`), que devolve
  o conteúdo como string em tempo de build/teste.

## Decisões tomadas

- `resolvePromoByCatalog` reaproveita **apenas** rotas `channel_referral`
  existentes (não `checkout`) para derivar `productCode` a partir do prefixo —
  ajuste feito na revisão G.12, divergindo levemente do pseudocódigo original do
  slice que não especificava essa restrição de `type`.

## Decisões tomadas

- Path genérico `/{produto}/promo/{code}` — campanha nova = linha no banco, não
  entrada no catálogo (diferente dos slugs `channel_referral`, que são 1 por pessoa)
- `promoBaseUrl` por produto no catálogo, espelhando `checkoutBaseUrl`
- Nenhum evento de funil emitido nesta rota
