# Fatia C — Promo gratuito: desvio do destino no api-funnel-ingress

> Feature: `workers/api-funnel-ingress`
> Estimativa: 2–3 horas
> Depende de: **Fatia B** (destino precisa existir) + reconciliação do slice
> `precheckout-catalog-redirect.md` (ver bloqueio abaixo)

## Status

| Campo | Valor |
|---|---|
| Estado | BLOCKED |
| Started | — |
| Completed | — |
| Commit final | — |

## ⚠️ Bloqueio a resolver antes de começar

O slice `precheckout-catalog-redirect.md` está marcado **IN_PROGRESS**, sem commit
final, e descreve o handler devolvendo `302 redirect` direto. O código atual em
`src/index.ts:303` devolve **`202 JSON` com `redirect_url`**, e o JS da LP faz
`window.location.href` (`site/planodevoo/index.html:3697-3701`).

Ou o slice não foi concluído, ou foi revertido, ou o doc está desatualizado.
**Primeira tarefa desta fatia:** confirmar o comportamento real em produção e
atualizar aquele slice (marcar DONE com o commit correto, ou corrigir o texto).
A implementação abaixo muda conforme a resposta — em ambos os casos o ponto de
decisão é o mesmo, só muda o formato da resposta.

## Contexto

Hoje o destino pós-precheckout é sempre o checkout da Hotmart, montado por
`buildCheckoutRedirect()` (`src/index.ts:216-234`), que resolve a rota do produto no
catálogo e anexa os `CHECKOUT_FORWARD_PARAMS` (email, nome, UTMs, fbp/fbc, etc.).

Para campanhas promocionais, o lead precisa seguir **o mesmo caminho até aqui**
(mesmo formulário, mesma entrada na lista Brevo, mesmo evento de funil) e só então
divergir: em vez do checkout pago, ir para o resgate gratuito.

## Mudança

### `workers/api-funnel-ingress/src/index.ts`

1. Adicionar `promo_code` à lista de params aceitos/propagados (ao lado de
   `CHECKOUT_FORWARD_PARAMS`), resolvido via `resolveCheckoutForwardValue`
   (o form manda maiúsculo/minúsculo inconsistente — ver mapeamento `EMAIL`/`FIRSTNAME`).

2. Nova função pura, espelhando `buildCheckoutRedirect`:

```ts
function buildPromoRedirect(
  catalog: CatalogV5,
  tenantId: string,
  promoCode: string,
  payload: Record<string, unknown>
): URL | null
```

Monta `https://{linksDomain}/{produtoPrefix}/promo/{promoCode}` com os mesmos params
propagados. O host vem do catálogo (`tenantLinks.linksDomain`); o `promoCode` entra
**apenas como segmento de path devidamente encodado** (`encodeURIComponent`), nunca
concatenado cru.

3. No handler `/funnel/precheckout` (~linha 298):

```ts
const promoCode = resolveCheckoutForwardValue(payload, "promo_code");
const redirect = promoCode
  ? buildPromoRedirect(catalog, tenantId, promoCode, payload)
  : buildCheckoutRedirect(catalog, tenantId, event.product_code, payload);
```

Fallback intacto: se `buildPromoRedirect` devolver `null`, cai no checkout normal
(nunca deixa o lead sem destino).

**O evento de funil continua sendo enfileirado igual, antes do redirect** — a entrada
na lista Brevo não muda em nada entre fluxo pago e promocional.

## Testes (TDD Red primeiro)

`workers/api-funnel-ingress/test/unit/promo-redirect.test.ts`
- payload com `promo_code` → `redirect_url` aponta para `/planodevoo/promo/{code}`
- payload sem `promo_code` → comportamento atual preservado (checkout Hotmart)
- `promo_code` presente mas produto sem rota/`linksDomain` → fallback para checkout
- `email`/`name` propagados no destino promocional (necessários para o resgate)
- `promo_code` com caractere especial (`../`, espaço, `%`) → encodado, sem escapar do path
- evento enfileirado **antes** do redirect, nos dois caminhos
- `promo_code` vazio (`""`) tratado como ausente

## Revisão G.12

> ⛔ GUARD RAIL: agente separado obrigatório antes de DONE.

Pontos de atenção:
- Path traversal via `promo_code` é impossível? (encodado, host do catálogo)
- Fallback para checkout coberto por teste?
- O slice `precheckout-catalog-redirect` foi reconciliado antes do DONE?
- Worker segue agnóstico de tenant/produto

## Execução (append-only)

(a preencher)

## Gotchas / lições aprendidas

(a preencher)

## Decisões tomadas

- O desvio acontece **no backend** (`api-funnel-ingress`), não na LP — a página não
  decide destino, só obedece o `redirect_url`
- Lead entra na lista do Brevo nos dois fluxos, sem exceção
- Fallback silencioso para o checkout pago se o promo não resolver
