# Fatia H — Promo gratuito: campo de código no formulário (substitui troca de preço na LP)

> Feature: `decolesuacarreiraesg` (site estático) + novo endpoint de validação em
> `decole-plano-de-voo-app`
> Depende de: Fatias A-G (fluxo promo completo já em produção)
> Status: **planejamento apenas** — não implementar sem confirmação explícita

## Status

| Campo | Valor |
|---|---|
| Estado | TODO (planejado, não escopado pra implementação ainda) |
| Started | — |
| Completed | — |
| Commit final | — |

## Contexto

Numa sessão anterior, implementamos uma primeira tentativa de dar sinal visual
de gratuidade na LP: trocar os 12 pontos de preço "R$97" por "GRATUITO"
riscado via JS (`applyPromoPricing()`, classes `.lp-preco-valor` /
`.lp-preco-garantia`), disparado sempre que `?promo_code=` estivesse presente
na URL. Essa abordagem teve dois problemas reais, encontrados em teste manual:

1. **Bug de estado obsoleto**: a função lia o código promocional do
   `sessionStorage` persistido (usado de propósito pra sobreviver até o
   formulário), não da URL da página atual — então o preço continuava
   "GRATUITO" indefinidamente mesmo depois de a pessoa voltar pra LP sem o
   parâmetro. Corrigido nesta mesma sessão (ler de `window.location.search`
   direto), mas expôs uma fragilidade maior do design.
2. **Nunca valida o código de verdade**: a troca de preço acontecia só pela
   *presença* do parâmetro na URL, não por checagem contra o banco — um
   `?promo_code=qualquercoisa` forjado mostraria "GRATUITO" mesmo pra um
   código inexistente, expirado ou esgotado. Isso é enganoso: a pessoa vê
   "gratuito" na LP inteira e só descobre que não é (tela de "vagas
   esgotadas") depois de preencher o formulário.

Decisão: abandonar a troca de todos os pontos de preço da LP (reverter pro
estado original, R$97 sempre visível igual ao fluxo pago — sem alteração
visual nenhuma nos textos de oferta) e substituir por um mecanismo mais
honesto e mais simples de manter: um **campo de código no próprio
formulário**, que só aparece quando o código é validado de verdade contra o
backend.

## Mudança

### 1. Reverter a troca de preço na LP

Remover de `decole/decolesuacarreiraesg`:
- `site/src/precheckout.ts`: função `applyPromoPricing()` e a chamada no
  auto-init (`applyPromoPricing();`, junto de `saveUtms();`).
- `site/planodevoo/index.html`: classes `class="lp-preco-valor"` e
  `class="lp-preco-garantia"` adicionadas aos 12 pontos de preço (remover a
  classe, manter o resto do markup idêntico).
- Rebuildar `assets/precheckout.js`.

Não reverter (continuam válidos, não fazem parte do que estamos abandonando):
- `_headers` (cache mais curto pros assets) — hardening independente, útil
  de qualquer forma.
- `UTM_KEYS` incluindo `promo_code` em `saveUtms()`/`getUtmParams()` — ainda
  necessário pra propagar o código até o formulário/precheckout.

### 2. Novo endpoint de validação (leitura, sem side-effect)

Falta um endpoint público que só **verifica** se um código é válido, sem
resgatar (não cria token, não consome cota, não depende de DOI). Hoje só
existem: `GET /promo/[code]` (página, exige token assinado desde a Fatia G) e
`POST /api/promo/[code]` (exige token assinado desde a Fatia G, resgata de
verdade). Nenhum dos dois serve pra uma checagem leve de "esse código ainda
tem vaga?" disparada ao clicar no CTA.

Proposta: `GET /api/promo/[code]/status` em `decole-plano-de-voo-app`,
reaproveitando `PromoRepository.getPromoCode(code)` (já existe, só leitura):

```ts
// Resposta: { valid: true } | { valid: false, reason: 'invalid' | 'expired' | 'exhausted' }
```

Regras (mesma lógica de `PromoService.redeem`, sem a parte de criar token):
- Código não existe ou `ativo = false` → `{ valid: false, reason: 'invalid' }`
- `expira_em` no passado → `{ valid: false, reason: 'expired' }`
- `usos_atuais >= max_usos` → `{ valid: false, reason: 'exhausted' }`
- Caso contrário → `{ valid: true }`

**Decisão a tomar na execução**: esse endpoint precisa ser chamado
cross-origin (site em `decolesuacarreiraesg.com.br`, API em
`plano.decolesuacarreiraesg.com.br`) — precisa de CORS. Duas opções, decidir
na execução:
- CORS direto na rota do Next.js (`Access-Control-Allow-Origin` restrito ao
  domínio do site, mesmo padrão que já existiria se outras rotas públicas do
  app precisassem disso).
- Proxy via `api-funnel-ingress` (`funil-mkt-platform`), que já tem CORS
  configurado por tenant/origem — adicionaria uma chamada extra
  worker→app, mais latência, mas mantém o app sem precisar lidar com CORS
  ele mesmo. Consistente com o padrão de "tudo passa pelo ingress" já usado
  pro form de precheckout.

### 3. Campo de código no formulário + validação no clique do CTA

Em `site/planodevoo/index.html` (e possivelmente `site/index.html`, se o
mesmo form padrão for reusado lá):

- Campo novo no form de precheckout: `<input type="text" id="PROMO_CODE"
  name="promo_code" readonly hidden />` (ou equivalente) — escondido por
  padrão.
- No handler de clique dos botões `[data-open-precheckout]` (já existe em
  `index.html`, por volta da linha 3723): antes de abrir/mostrar o form,
  checar se há `promo_code` capturado (via `getUtmParams()`, que já
  persiste em sessionStorage desde a Fatia D). Se houver:
  1. Mostrar um estado de "validando..." (loading, não travar o clique).
  2. Chamar `GET /api/promo/{code}/status` (endpoint da seção 2).
  3. Se `valid: true`: revelar o campo `PROMO_CODE` preenchido e read-only,
     mais uma mensagem de destaque tipo "🎉 Código válido — seu Plano de Voo
     é gratuito" acima do form.
  4. Se `valid: false`: manter o campo escondido, abrir o form normal (fluxo
     pago, sem menção a promo) — **não mostrar erro nenhum** pro usuário;
     um código forjado/expirado não deveria expor detalhe nenhum, só cai no
     caminho padrão silenciosamente.
- Sem `promo_code` capturado: abre o form normal, sem chamar o endpoint
  (zero mudança de comportamento pra quem chega sem código).

### 4. Backend de resgate — sem mudança

`/funnel/precheckout` (Fatia C, já corrigido nesta sessão) continua
recebendo `promo_code` no payload do form e não retornando `redirect_url`
quando há rota promocional configurada — a entrega continua 100% via e-mail
de DOI (Fatia G). Este novo endpoint de validação é só leitura/UX, não entra
no caminho de resgate real.

## Testes (TDD Red primeiro)

**Novo endpoint** (`decole-plano-de-voo-app`,
`app/api/promo/[code]/status/route.test.ts`):
- código válido (ativo, não expirado, com cota) → `200 { valid: true }`
- código inexistente → `{ valid: false, reason: 'invalid' }`
- código com `ativo = false` → `{ valid: false, reason: 'invalid' }`
- código expirado → `{ valid: false, reason: 'expired' }`
- código com `usos_atuais >= max_usos` → `{ valid: false, reason: 'exhausted' }`
- nunca chama `createTokenForPromo` nem qualquer método de escrita — só
  `getPromoCode` (verificar via mock que os métodos de escrita não são
  chamados)
- CORS: `OPTIONS` responde com os headers certos pro domínio do site (se a
  decisão da seção 2 for CORS direto na rota)
- Origin: request com `Origin` do domínio esperado → processa normal;
  `Origin` de domínio diferente/desconhecido → 403, nunca chega a checar o
  código; sem header `Origin` nenhum (script simples) → decidir na execução
  se bloqueia ou deixa passar pro rate limit segurar (navegadores sempre
  mandam `Origin` em cross-origin; scripts não mandam por padrão)
- rate limit por IP: N+1 requisições rápidas do mesmo IP → alguma resposta
  de limite excedido (429), não deixa escanear códigos sem restrição

**Frontend** (`decolesuacarreiraesg`, `site/test/unit/precheckout.test.ts` —
nota: suíte deste repo está quebrada por incompatibilidade Node 26/vitest/jsdom,
pré-existente, não relacionada a esta fatia; verificar manualmente via
browser como já feito nas fatias anteriores desta sessão):
- clique no CTA sem `promo_code` capturado → não chama `fetch` de validação,
  abre form normal
- clique com `promo_code` válido → chama o endpoint, revela campo
  `PROMO_CODE` preenchido + mensagem de destaque
- clique com `promo_code` inválido/expirado/esgotado → não revela o campo,
  abre form normal, sem mensagem de erro
- falha de rede ao validar (timeout, 500) → não trava o form; abre normal
  (fail-safe pro caminho pago, nunca bloqueia o clique por causa da
  validação de promo)

## Revisão G.12

> ⛔ GUARD RAIL: agente separado obrigatório antes de DONE, mesmo padrão A-G.

Pontos de atenção:
- Endpoint de validação é **só leitura** — confirmar que nenhum caminho gera
  side-effect (token, e-mail, incremento de `usos_atuais`)
- CORS restrito ao(s) domínio(s) reais do site, não `*` — mas **CORS não é
  proteção contra abuso direto**: é uma restrição só de navegador, não
  impede um script/curl de bater direto no endpoint ignorando CORS
  inteiramente.
- **Checagem de `Origin` no servidor** (camada adicional, além do CORS
  header): a rota rejeita com 403 qualquer request cujo header `Origin` não
  bata com o(s) domínio(s) esperados — isso é diferente de só configurar
  CORS, é o próprio código da rota recusando o request antes de processar.
  Barra scanners genéricos que nem tentam disfarçar a origem (maioria dos
  casos reais). **Não é à prova de attacker deliberado**: `Origin` é
  enviado automaticamente pelo navegador, mas um script pode forjar esse
  header manualmente — não tem como o servidor ter certeza absoluta de que
  o request veio do navegador de alguém no nosso site. Ainda assim, vale
  implementar por ser barato e levantar a régua contra abuso casual.
- **Rate limiting por IP** no endpoint — a proteção real contra
  scanning/força-bruta de códigos (funciona mesmo se o `Origin` for
  forjado). Precisa ser implementado junto com a checagem de `Origin`, não
  é opcional nem alternativo a ela — são camadas complementares. Risco é
  baixo (códigos de campanha, cota pequena, não são segredo de alto valor),
  mas rate limit é barato e fecha a classe de abuso óbvia (alguém varrendo
  milhares de códigos por minuto)
- Código inválido/expirado/esgotado nunca deve vazar detalhe (mensagem de
  erro específica) pro usuário final — o comportamento correto é
  silenciosamente cair no form pago, igual não ter código nenhum
  (mesmo princípio de "nunca vazar diferença observável" já aplicado nas
  fatias anteriores pra evitar enumeration/scanning de códigos válidos por
  força bruta)
- Falha de rede/timeout na validação não pode travar ou atrasar
  perceptivelmente a abertura do form pra quem não tem código nenhum

## Decisões tomadas (até aqui, nesta etapa de planejamento)

- Abandonar a troca de texto de preço em toda a LP — reverter pro estado
  visual original, sem exceção
- Validação de verdade contra o backend, disparada só no clique do CTA (não
  no carregamento da página) — evita chamada de rede desnecessária pra quem
  nunca vai clicar, e evita mostrar "gratuito" antes de confirmar que é real
- Código inválido nunca gera mensagem de erro visível — cai silenciosamente
  no fluxo pago
- CORS (rota direta vs. proxy via ingress) — deixado como decisão de
  execução, não fechado aqui
