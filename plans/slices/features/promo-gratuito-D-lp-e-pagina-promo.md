# Fatia D — Promo gratuito: LP propaga o código + página de resgate

> Feature: `decolesuacarreiraesg` (LP) + `decole-plano-de-voo-app` (UI de `/promo/[code]`)
> Estimativa: 3–4 horas
> Depende de: Fatias A, B e C

## Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |
| Commit final | — |

## Contexto

A pessoa precisa **entender o que é o Plano de Voo antes de resgatar** — e a página
de vendas que já existe (`site/planodevoo/index.html`, com oferta, prova social,
mecanismo P.L.A.N.O, FAQ) é o melhor ativo para isso. Não faz sentido criar uma
landing paralela para o lote-piloto.

Solução: a mesma LP serve os dois públicos. Quem chega com `?promo_code=X` na URL
vê exatamente a mesma página, preenche exatamente o mesmo formulário, e só o destino
final muda (decidido no backend, Fatia C).

Esta fatia fecha as duas pontas visuais: a LP propagando o código, e a página que
recebe o resgate.

## Mudança

### 1. LP — `site/planodevoo/index.html`

O formulário de pré-checkout (`#precheckout_planovoo`) precisa mandar `promo_code`
no payload do `POST /funnel/precheckout`.

**Antes de implementar:** localizar como os `utm_*` chegam ao payload hoje (hidden
inputs populados por JS lendo `location.search`, ou montagem no submit) e replicar
**exatamente o mesmo mecanismo** para `promo_code` — não inventar um caminho novo.

Regra: se a URL da página não tem `promo_code`, nada muda — o payload sai idêntico
ao de hoje e o lead segue para o checkout pago.

### 2. App — `app/promo/[code]/page.tsx`

Página que recebe o redirect do worker. Comportamento por caso:

| Situação | Resposta |
|---|---|
| Tem `email` na query | chama o service (Fatia A) → `302` para `/formulario/{token}` |
| Sem `email` na query | `302` de volta para a LP com `?promo_code={code}` |
| Código inválido / expirado / esgotado | página "as vagas gratuitas acabaram" + CTA da oferta paga (R$ 97) |
| E-mail já resgatou este código | `302` para o `/formulario/{token}` existente |

O redirect de volta para a LP quando falta e-mail é o ponto crítico: sem ele, quem
acessa o link cru pularia o `/funnel/precheckout` e **não entraria na lista do Brevo**
— gerando planos gratuitos para gente que não existe no funil.

A URL da LP vem de env/config do app, nunca de query param do usuário (open redirect).

### 3. Página de esgotado = oportunidade de conversão

Quem chega com código morto é lead quente: a tela precisa ter o CTA da oferta paga,
não ser um beco sem saída.

## Testes (TDD Red primeiro)

`app/promo/[code]/page.test.ts`
- com `email` → redireciona para `/formulario/{token}`
- sem `email` → redireciona para a LP com `promo_code` preservado
- código inválido/expirado/esgotado → renderiza a tela de esgotado (não 500)
- e-mail repetido no mesmo código → redireciona para o token existente
- destino da LP não é influenciável por query param (sem open redirect)

LP (manual, documentar evidência no slice):
- `?promo_code=X` → devtools confirma `promo_code` no payload do POST
- sem `promo_code` → payload idêntico ao atual, redirect para Hotmart inalterado

## Revisão G.12

> ⛔ GUARD RAIL: agente separado obrigatório antes de DONE.

Pontos de atenção:
- Tráfego pago normal segue 100% inalterado? (regressão aqui é perda de receita direta)
- Redirect de volta à LP não é open redirect?
- Mecanismo de captura do `promo_code` é o mesmo dos `utm_*`, sem código paralelo?
- Tela de esgotado tem CTA pago

## Execução (append-only)

(a preencher)

## Gotchas / lições aprendidas

(a preencher)

## Decisões tomadas

- Uma LP só para os dois públicos — zero duplicação de copy
- `/promo/{code}` sem e-mail nunca resgata: empurra para o caminho canônico,
  garantindo entrada na lista em 100% dos casos
- Código esgotado vira oferta paga, não erro seco

## Fatia E (opcional, ainda não planejada)

Tela `/admin/promo/novo` para criar códigos sem `INSERT` manual no banco, espelhando
`/admin/tokens/novo` e protegida por `admin_session`. Não bloqueia a campanha — dá
para criar a primeira linha na mão.
