# Fatia B — Promo gratuito: rota genérica no links-redirect

> Feature: `workers/links-redirect` + catálogo
> Estimativa: 2–3 horas
> Depende de: nada (pode ir antes ou em paralelo com a Fatia A)

## Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |
| Commit final | — |

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

(a preencher)

## Gotchas / lições aprendidas

(a preencher)

## Decisões tomadas

- Path genérico `/{produto}/promo/{code}` — campanha nova = linha no banco, não
  entrada no catálogo (diferente dos slugs `channel_referral`, que são 1 por pessoa)
- `promoBaseUrl` por produto no catálogo, espelhando `checkoutBaseUrl`
- Nenhum evento de funil emitido nesta rota
