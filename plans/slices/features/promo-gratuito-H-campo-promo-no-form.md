# Fatia H — Promo gratuito: campo de código no formulário (substitui troca de preço na LP)

> Feature: `decolesuacarreiraesg` (site estático) + novo endpoint de validação em
> `decole-plano-de-voo-app`
> Depende de: Fatias A-G (fluxo promo completo já em produção)
> Status: **planejamento apenas** — não implementar sem confirmação explícita

## Status

| Campo | Valor |
|---|---|
| Estado | DONE — deployado e verificado em produção. Rate limiting da Cloudflare fica pendente como BL-031 (backlog de segurança do produto), não bloqueante |
| Started | 2026-09-14 |
| Completed | 2026-09-14 |
| Commit final | `decole-plano-de-voo-app@124d582`, `funil-mkt-platform@43c0922`, `decolesuacarreiraesg@0475ece` |

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

**Decisão fechada: proxy via `api-funnel-ingress`, não CORS direto na rota
do app.** Arquitetura:

- **LP (browser) → `api-funnel-ingress`**: novo endpoint público, ex.
  `GET /funnel/promo-status/{code}` — mesmo worker que já recebe
  `/funnel/precheckout`, mesmo CORS por tenant/origem já configurado ali
  (`corsHeaders()`/`isOriginAllowed()`, já existentes em
  `workers/api-funnel-ingress/src/index.ts`). Zero código de CORS novo.
- **`api-funnel-ingress` → `decole-plano-de-voo-app`**: chamada
  servidor-servidor, autenticada por um segredo novo compartilhado (mesmo
  padrão de `PROMO_SIGNUP_SECRET`/`PLANOVOO_HOOK_SECRET` já usados nesta
  sessão) — ex. `PROMO_STATUS_SECRET`, enviado num header
  (`x-promo-status-secret` ou similar) que o endpoint do app exige pra
  responder. Sem o segredo certo → 401, nunca chega a consultar o banco.

Por que isso é melhor que CORS+Origin-check+rate-limit direto no app: um
segredo não é adivinhável/forjável como um header `Origin` — fecha por
completo o vetor "alguém bate direto no domínio do app" (o endpoint do app
deixa de ser efetivamente público; só responde pra quem tem o segredo). O
`api-funnel-ingress` continua precisando de proteção própria contra
scanning (rate limiting — Cloudflare Workers tem mecanismos nativos pra
isso, ou um contador simples via `IDENTITY_KV`), já que ELE é o endpoint
público de fato. Mas a superfície de ataque encolhe pra um único lugar
(o worker), em vez de dois (worker + app).

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

**App** (`decole-plano-de-voo-app`, `app/api/promo/[code]/status/route.test.ts`):
- header do segredo (`x-promo-status-secret`) ausente ou errado → `401`,
  nunca chega a consultar `getPromoCode`
- header do segredo correto + código válido (ativo, não expirado, com cota)
  → `200 { valid: true }`
- header correto + código inexistente → `{ valid: false, reason: 'invalid' }`
- header correto + código com `ativo = false` → `{ valid: false, reason: 'invalid' }`
- header correto + código expirado → `{ valid: false, reason: 'expired' }`
- header correto + código com `usos_atuais >= max_usos` → `{ valid: false, reason: 'exhausted' }`
- nunca chama `createTokenForPromo` nem qualquer método de escrita — só
  `getPromoCode` (verificar via mock que os métodos de escrita não são
  chamados)
- sem `PROMO_STATUS_SECRET` configurado no ambiente → falha fechada (500 de
  config, nunca vira 200 aceitando qualquer coisa) — mesmo padrão de
  `promoSignupSecret()` já usado nesta sessão

**Worker** (`funil-mkt-platform`, `workers/api-funnel-ingress/test/unit/promo-status.test.ts`):
- CORS: reaproveita `corsHeaders()`/`isOriginAllowed()` já existentes —
  `OPTIONS` e origem não permitida seguem o mesmo comportamento das outras
  rotas deste worker, sem lógica nova
- chamada ao app inclui o header do segredo (mock do `fetch` pro app,
  verificar que o header foi enviado)
- rate limit por IP: N+1 requisições rápidas do mesmo IP → alguma resposta
  de limite excedido (429), antes mesmo de chamar o app

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
- **O endpoint do app não é público de fato**: exige `PROMO_STATUS_SECRET`
  num header, verificado antes de qualquer consulta ao banco — quem não
  tem o segredo não consegue nem descobrir se um código existe. Isso é mais
  forte que CORS ou checagem de `Origin` (que dependem de header que dá pra
  forjar): sem o segredo certo, não tem request válido possível, ponto.
- O único endpoint público de fato é o novo do `api-funnel-ingress` — esse
  sim precisa de CORS (reaproveitado, já existe no worker) e de rate
  limiting por IP, já que é o que fica exposto na internet. Confirmar que o
  worker nunca repassa o `PROMO_STATUS_SECRET` de volta pro browser (nem em
  erro, nem em log acessível)
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
- Validação vai via proxy no `api-funnel-ingress` (não CORS direto no app) —
  o endpoint do app fica protegido por segredo compartilhado
  (`PROMO_STATUS_SECRET`), nunca diretamente exposto; o worker é o único
  ponto público de fato, e reaproveita CORS já existente ali
- CORS (rota direta vs. proxy via ingress) — deixado como decisão de
  execução, não fechado aqui

## Execução (append-only)

**2026-09-14** — implementadas as 3 partes, TDD Red→Green em cada uma:

1. **App** (`decole-plano-de-voo-app`): `promoStatusSecret()` em
   `lib/promo/promo-token.ts` + `GET /api/promo/[code]/status`
   (`app/api/promo/[code]/status/route.ts` + `route.test.ts`, 9 testes).
   Suíte completa: 149/149.
2. **Worker** (`funil-mkt-platform`, `api-funnel-ingress`): novo campo
   `statusSecretEnv` em `CatalogV5Integration` + catálogo
   (`integrations.planovoo.statusSecretEnv = "PROMO_STATUS_SECRET_DECOLE"`);
   `findPromoStatusIntegration()` (genérico, não hardcoda nome de
   integração); rota `GET /funnel/promo-status/{code}` inserida antes do
   gate POST-only; `wrangler.toml` ganhou bindings pro Secrets Store —
   `PLANOVOO_API_BASE_URL_DECOLE` (reaproveita secret já existente, criado
   pro funnel-dispatcher) e `PROMO_STATUS_SECRET_DECOLE` (**novo, ainda não
   criado no store**). `promo-status.test.ts`, 7 testes. Suíte completa do
   repo: 539/539. `check-config`: limpo.
   - Rate limiting por IP: decisão do usuário foi usar regra nativa de Rate
     Limiting da Cloudflare na zona (fora do código do worker), não KV — não
     implementado em código, fica como configuração de infra a confirmar
     antes do deploy.
3. **Site** (`decolesuacarreiraesg`): revertido `applyPromoPricing()` +
   classes `lp-preco-valor`/`lp-preco-garantia` (12 pontos); campo
   `#PROMO_CODE` (dentro de `#precheckout-promo-code-field`, com label
   "Código promocional") + badge `#precheckout-promo-badge`, ambos
   escondidos por padrão, só revelados após `GET /funnel/promo-status/{code}`
   responder `{valid:true}`; URL derivada de
   `window.EngagementConfig.ingressUrl` (evita hardcodar um terceiro
   literal do domínio). `npm test` do site confirmado quebrado por causa
   pré-existente (Node 26/vitest/jsdom), documentada — validação manual via
   Chrome DevTools (servidor estático local + mock de `fetch`) cobrindo:
   sem `promo_code` (zero fetch, form normal), código válido (badge +
   campo revelados), falha de rede (fallback silencioso), `valid:false`
   (fallback silencioso). `npm run typecheck` e `build:precheckout` limpos.

**G.12** — revisão por agente separado (`ecc:code-reviewer`): **APPROVE**,
0 CRITICAL/HIGH/MEDIUM. 2 LOW não-bloqueantes:
- `access-control-allow-methods` do worker não anuncia GET pra
  `/funnel/promo-status/*` (hoje inofensivo — a chamada da LP não dispara
  preflight; só importa se um header não-safelisted for adicionado no
  futuro).
- Confirmar que a regra de rate limiting da Cloudflare na zona realmente
  cobre `/funnel/promo-status/*` antes do deploy (a rota tem prefixo limpo
  pra isso, só não foi criada ainda).

**Deploy em produção (2026-09-14)**: todas as pendências acima executadas,
uma por vez, com confirmação do usuário em cada passo:
- `PROMO_STATUS_SECRET` gerado e criado no Cloudflare Secrets Store
  (`promo_status_secret_decole`, escopo `workers`)
- GitHub Actions secret `PROMO_STATUS_SECRET` criado em
  `decole-plano-de-voo-app`; `docker-compose.yml` e `setup-infra.yml`
  atualizados pra propagar o valor pro `.env` do VPS
- `decole-plano-de-voo-app`: commit `124d582`, push → `deploy-app.yml`
  automático (sucesso, 2m58s) → `setup-infra.yml` (`full-restart`,
  manual, sucesso, 4m10s) — confirmado via smoke test
  (`curl .../api/promo/X/status` sem header → `401`, não `500`)
- `funil-mkt-platform`: commit `43c0922`, push → `deploy-all-workers.yml`
  (manual, `dry_run=false`, sucesso, 1m14s)
- `decolesuacarreiraesg`: commit `0475ece`, push → deploy automático via
  integração Cloudflare Pages (sem GitHub Actions neste repo) — confirmado
  propagado (`lp-preco-valor` ausente, `precheckout-promo-badge` presente)
- **Smoke test end-to-end em produção**: `curl
  https://api.decolesuacarreiraesg.com.br/funnel/promo-status/CODIGO-TESTE`
  → `{"valid":false,"reason":"invalid"}`, HTTP 200 — pipeline completo
  (worker → app → banco) confirmado funcionando

**Pendência remanescente (não bloqueante)**: regra de Rate Limiting da
Cloudflare pra `/funnel/promo-status/*` — tentativa de criar via API
(Rulesets, fase `http_ratelimit`) falhou repetidamente com "request is not
authorized" mesmo após conceder `Zone WAF:Edit` a dois tokens diferentes;
suspeita não confirmada de limitação de plano da zona (API reporta
`plan.name: "Free Website"`, usuário contesta). Registrado como **BL-031**
no backlog de segurança do produto
(`mkt-brain/knowledge-core/tenants/decole/products/plano-de-voo/artifacts/00-plano/backlog.md`)
com os parâmetros sugeridos pra criação manual no dashboard.
