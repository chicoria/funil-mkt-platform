# Fatia C — Promo gratuito: desvio do destino no api-funnel-ingress

> Feature: `workers/api-funnel-ingress`
> Estimativa: 2–3 horas
> Depende de: **Fatia B** (destino precisa existir) + reconciliação do slice
> `precheckout-catalog-redirect.md` (ver bloqueio abaixo)

## Status

| Campo | Valor |
|---|---|
| Estado | Em revisão final — código completo e verde, aguardando decisão do usuário sobre commit/deploy |
| Started | 2026-09-11 |
| Completed | — |
| Commit final | — (nenhum commit criado ainda; ver Execução) |

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

**2026-09-11** — Bloqueio resolvido e implementação completa, TDD Red→Green:

- Bloqueio: `precheckout-catalog-redirect.md` estava desatualizado (descrevia 302,
  código real sempre foi 202 JSON + `redirect_url` — mudança técnica posterior à
  aprovação G.12 original, não revert/incompletude). Reconciliado e marcado DONE.
- Red: `test/unit/promo-redirect.test.ts` (7 casos do plano + verificação de
  agnosticismo), confirmado com 2/7 falhando antes da implementação.
- Green: `buildPromoRedirect()` em `workers/api-funnel-ingress/src/index.ts`,
  espelhando `buildCheckoutRedirect`. Prefixo de produto derivado de uma rota
  `channel_referral` existente no catálogo (mesma convenção do
  `resolvePromoByCatalog` da Fatia B). 34/34 testes verdes (0 regressão nos 26
  pré-existentes), `tsc --noEmit` limpo, `check-config` limpo.
- Revisão G.12 por agente separado (`ecc:code-reviewer`, sem contexto prévio):
  **0 MUST-FIX — APPROVE**. Verificou de forma independente (lendo o catálogo e o
  código do `links-redirect`, não só confiando na minha descrição) que o filtro
  `channel_referral`-only é necessário para bater com o que `resolvePromoByCatalog`
  aceita, e que produtos sem prefixo (`/ref/{slug}` puro) corretamente caem no
  fallback. 2 SHOULD-FIX aplicados: teste de agnosticismo adicionado (mesmo padrão
  da Fatia B) e comentário explicando por que `promo_code` fica fora de
  `CHECKOUT_FORWARD_PARAMS`. 1 SHOULD-FIX registrado como follow-up, não corrigido
  agora (ver Gotchas). Suite final: 34/34 verde.
- **Pendente**: nenhum commit criado, nenhum deploy disparado.

## Gotchas / lições aprendidas

- **Teste de agnosticismo pegou hardcode no próprio comentário que eu escrevi**:
  o teste novo (`match(/DECOLE|PLANOVOO|ESG/g)` sobre o source via `?raw`) falhou
  porque um comentário explicativo citava "ESG" como exemplo — reescrito de forma
  genérica. Prova que o teste funciona (pegou uma violação real, não só passou por
  acaso) e reforça por que vale a pena ter esse guard automatizado.
- **Follow-up não corrigido nesta fatia**: o `.find()` que resolve a rota
  `channel_referral` por `productCode` assume implicitamente que todas as rotas
  desse tipo para o mesmo produto compartilham o mesmo prefixo — verdade hoje
  (verificado contra o catálogo real), mas não é validado por `check-config` nem
  por tipo. Se um dia um produto ganhar uma segunda rota `channel_referral` com
  prefixo divergente, `buildPromoRedirect` pode escolher a rota errada
  dependendo da ordem do array, sem nenhum erro — silencioso. Registrado pelo
  revisor como SHOULD-FIX; decidi não resolver agora (mudança em `check-config`
  é escopo maior, fora desta fatia) — fica como follow-up explícito.

## Decisões tomadas (execução)

- `buildPromoRedirect` recebe `productCode` explicitamente (diferente do
  pseudocódigo original do slice, que não tinha esse parâmetro) — sem ele não há
  como resolver o prefixo de produto a partir do catálogo.

## Decisões tomadas

- O desvio acontece **no backend** (`api-funnel-ingress`), não na LP — a página não
  decide destino, só obedece o `redirect_url`
- Lead entra na lista do Brevo nos dois fluxos, sem exceção
- Fallback silencioso para o checkout pago se o promo não resolver

## Execução (append-only) — correção pós-Fatia G

**2026-09-12** — Bug de produção reportado pelo usuário ("fui direcionado direto
para o form do plano de voo após o cadastro") revelou que `buildPromoRedirect`
(implementado nesta fatia, **antes** da G existir) continuava montando um
`redirect_url` síncrono com `email`/`name` na query string
(`CHECKOUT_FORWARD_PARAMS`), apontando direto pro endpoint de resgate
(`/promo/{code}`). Isso furava por completo o gate de DOI da Fatia G: o
navegador seguia esse redirect na hora, sem nenhuma confirmação de e-mail.

Causa raiz: a Fatia G só gateou o caminho assíncrono (evento `GENERATE_LEAD` →
funnel-dispatcher → e-mail de DOI), mas nunca revisitou/desativou este caminho
síncrono mais antigo — G.12 da Fatia G não pegou essa lacuna porque revisou só
o código novo, não o comportamento combinado dos dois.

**Fix**: `buildPromoRedirect` removido; substituído por
`hasPromoRouteConfigured` (boolean, não monta URL nem carrega email/nome).
Quando há rota promocional configurada pro produto, a resposta do
`/funnel/precheckout` não traz `redirect_url` nenhum — o frontend já trata essa
ausência mostrando "Cadastro enviado! Confirme no e-mail para liberar o
acesso." (`site/planodevoo/index.html`, comportamento pré-existente, não
alterado). Entrega do link passa a depender exclusivamente do e-mail de DOI.
Produtos sem rota promocional configurada continuam caindo no checkout normal,
sem mudança.
