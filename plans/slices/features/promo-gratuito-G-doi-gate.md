# Fatia G — Promo gratuito: gate de confirmação (DOI) antes de liberar o link

> Feature: `funnel-dispatcher` + catálogo + `links-redirect` + Brevo (template novo)
> Depende de: Fatias A-F (fluxo promo completo já em produção)
> Status: **planejamento apenas** — não implementar sem confirmação explícita

## Status

| Campo | Valor |
|---|---|
| Estado | TODO (planejado, não escopado pra implementação ainda) |
| Started | — |
| Completed | — |
| Commit final | — |

## Contexto

Hoje (Fatias A-F), o link de resgate do Plano de Voo gratuito é gerado **na hora**,
assim que o e-mail chega em `/promo/[code]?email=X` — sem nenhuma verificação de
que o e-mail é real. Isso é diferente do fluxo pago, onde o pagamento em si já
funciona como prova de pessoa real; no gratuito, com cota limitada (ex.:
`PLANODEVOO100`, 10 vagas), alguém pode queimar a cota inteira com e-mails
falsos/typo em segundos.

Seguindo a lógica VTSD (Módulo 04, Aula 10 — Fluxo de Isca Digital), esse é
literalmente um funil de isca digital: **Atração → Captura → Entrega → Nutrição →
Conversão**. A etapa "Entrega" deveria só liberar a isca (o link do plano) depois
de uma confirmação real — e a confirmação mais natural, que o produto já usa pro
fluxo pago, é o **DOI nativo do Brevo**.

### Decisão de arquitetura (resultado da investigação nesta sessão)

Avaliadas e descartadas três alternativas antes de chegar na solução final:

1. ~~Self-hosted DOI (e-mail transacional nosso, link nosso)~~ — resolveria sem
   depender do Brevo, mas o Brevo nunca marcaria o contato como opt-in
   confirmado de verdade (isso é uma flag interna do Brevo, amarrada ao clique
   no link *hospedado por eles*; um `POST /v3/contacts` nosso não ativa essa
   flag, mesmo adicionando à lista certa).
2. ~~Automação do Brevo + webhook~~ — funcionaria, mas depende de configuração
   manual no painel do Brevo e de um comportamento de timing (`listAddition` vs
   `contactUpdated`) não documentado com precisão.
3. ~~Merge tag no `redirectionUrl`~~ — **não existe**: confirmado na doc oficial
   da API (`developers.brevo.com/reference/create-doi-contact`) que
   `redirectionUrl` é uma string estática por chamada, sem suporte a merge tag
   de atributo do contato.

**Solução escolhida**: `redirectionUrl` é um **parâmetro do `POST
/contacts/doubleOptinConfirmation`**, montado pelo nosso próprio código
(`funnel-dispatcher`) uma vez por evento `GENERATE_LEAD` — ou seja, **nós**
escrevemos essa URL antes de mandar pro Brevo, já com os dados que precisamos
embutidos. Isso permite usar o DOI 100% nativo do Brevo (opt-in marcado
corretamente, clique real no link deles) e ainda assim recuperar `email` +
`promo_code` no redirect final, sem webhook nem automação.

## Mudança

### 1. Brevo — novo template DOI (isca digital)

Segundo template, dedicado à campanha gratuita (distinto do template id 10,
usado pelo fluxo pago). Copy própria, não a genérica "receber informações
exclusivas":

- **Assunto**: `Confirme para acessar seu Plano de Voo gratuito`
- **Corpo**: adaptar o template `doi-v1.html` existente
  (`config/email-templates/planovoo/doi-v1.html`) trocando a Mensagem 2
  ("Confirme sua inscrição para receber informações exclusivas...") por algo
  como *"Confirme seu e-mail para garantir sua vaga gratuita no Plano de Voo
  ESG e receber o link de acesso."* — manter o resto do layout (header, CTA,
  assinatura da Elizete) idêntico ao existente.

### 2. Catálogo — `config/products.catalog.json`

Nova entrada em `products.DECOLE_PLANOVOO.brevo.doiFlows` (ao lado da
existente `precheckoutDoi`), ex.: `key: "precheckoutPromoDoi"`, com o novo
`templateId`. **Sem `redirectionUrl` fixo aqui** — esse valor passa a ser
calculado em runtime pelo dispatcher (ver item 3), não é mais uma constante de
config.

### 3. `funnel-dispatcher/src/handlers/index.ts`

`resolveDoiTemplateId(event, env)` e `resolveDoiRedirectionUrl(event, env)` —
ambas hoje resolvem por config de evento → config de produto → env var, sem
olhar o payload. Adicionar branch **antes** dessas resoluções: se
`event.payload?.promo_code` estiver presente,

- `resolveDoiTemplateId` retorna o `templateId` da nova entrada `doiFlows`
  (isca digital).
- `resolveDoiRedirectionUrl`:
  1. Gera um `rid` (mesmo padrão de `randomUUID` já usado em
     `checkout_recovery`).
  2. Grava no `IDENTITY_KV`: `promo_confirmation:<rid>` →
     `{ email, nome, promo_code }` (JSON, mesmo formato de
     `checkout_recovery:<rid>`), com TTL razoável (ex.: 48h — decidir na
     execução).
  3. Retorna `https://links.decolesuacarreiraesg.com.br/planodevoo/promo-signup?rid=<rid>`.

Sem `promo_code` no payload → comportamento idêntico ao atual, zero mudança
pro fluxo pago.

### 4. `links-redirect/src/index.ts` — nova rota `/planodevoo/promo-signup`

Handler novo (ou extensão de `handleDoiConfirmationPath`, decidir na
execução qual fica mais limpo): lê `rid` da query, busca
`promo_confirmation:<rid>` no `IDENTITY_KV`.

- **KV encontrado**: extrai `email`+`promo_code`, redireciona (302,
  `cache-control: no-store`) pra
  `https://plano.decolesuacarreiraesg.com.br/promo/{promo_code}?email={email}`
  — a rota que **já existe** (Fatia D) e já chama `PromoService.redeem()`.
  Sem emitir evento de funil adicional aqui (o `SIGN_UP` já é tratado pela
  rota `doi_confirmation` genérica, se optarmos por reaproveitá-la).
- **KV ausente/expirado**: fallback pra LP (`?promo_code=` sem email — cai no
  bounce-back já existente na Fatia D) em vez de erro seco.

### 5. `app/promo/[code]/page.tsx` (decole-plano-de-voo-app)

**Nenhuma mudança** — já trata `email` presente chamando `redeem()` (Fatia D).
Essa fatia só muda **quando** o e-mail chega até essa rota (depois da
confirmação real, não antes).

## Testes (TDD Red primeiro)

`workers/funnel-dispatcher/test/unit/index.test.ts` (estende o existente)
- `GENERATE_LEAD` com `promo_code` no payload → `templateId` do template de
  isca, não o genérico
- `GENERATE_LEAD` com `promo_code` → `redirectionUrl` contém `/planodevoo/promo-signup?rid=`
  e um `IDENTITY_KV.put` foi chamado com `email`/`nome`/`promo_code` corretos
- `GENERATE_LEAD` sem `promo_code` → comportamento idêntico ao atual
  (regressão zero)

`workers/links-redirect/test/unit/promo-doi-signup.test.ts` (novo)
- `rid` válido no KV → redireciona pra `/promo/{code}?email={email}`
- `rid` ausente/inválido/expirado → fallback pra LP, não 500
- `cache-control: no-store` presente
- host do redirect sempre de config/catálogo (sem open redirect via `rid`
  malicioso — o `rid` só indexa uma leitura de KV, nunca compõe host/path
  diretamente)

## Revisão G.12

> ⛔ GUARD RAIL: agente separado obrigatório antes de DONE, mesmo padrão A-F.

Pontos de atenção:
- `rid` não pode virar vetor de open redirect nem de acesso a dado de outro
  e-mail (KV é só leitura por chave opaca, nunca aceita path/host do usuário)
- TTL do `IDENTITY_KV` — o que acontece se a pessoa confirmar depois do TTL
  expirar? (fallback pra LP, não erro — já coberto acima, mas vale reforçar
  na review)
- Fluxo pago (`GENERATE_LEAD` sem `promo_code`) genuinamente inalterado —
  regressão aqui é ruim (afeta receita)
- Dedupe/cota do `redeem()` (Fatia A) já cobre o caso de alguém clicar o link
  de confirmação duas vezes — não precisa reinventar nada aqui

## Execução (append-only)

**2026-09-12** — Implementado, TDD Red→Green nos dois workers (funnel-dispatcher
198/201 verde — 3 skips pré-existentes, não relacionados; links-redirect 67/67
verde). Template Brevo id 23 criado via API ("Plano de Voo - DOI Isca Digital").
Revisão G.12 por agente separado: 0 MUST-FIX. 2 SHOULD-FIX:
- Drift de config entre `promoDoiTemplateId`/`promoSignupUrl` (um setado sem o
  outro faz o e-mail ter a copy certa mas cair no destino errado, silenciosamente)
  — corrigido com log de warning (`handler_warn`/`promo_signup_url_missing_with_promo_code`).
- Fallback de `rid` expirado (TTL 48h) devolve 404 JSON, não o bounce-back pra LP
  que o plano original previa — **decisão**: aceitar o 404 por ora. O `code`
  promocional só é conhecido via o próprio KV que expirou, então não há dado
  pra montar um bounce-back útil (`?promo_code=` sem esse dado vira uma LP
  genérica, sem contexto de campanha) sem uma segunda fonte de verdade. Não há
  reenvio de confirmação em lugar nenhum do fluxo hoje — se isso se provar um
  problema real (pessoas confirmando depois de 48h), tratar como fatia própria
  (reenvio de DOI), não como ajuste pontual aqui.

Verificado também (G.12, com evidência no código, não suposição): dedupe/cota
de `PromoService.redeem()` já cobre clique duplicado no link de confirmação
(`SELECT ... FOR UPDATE` + `UNIQUE(email, promo_code)` com recovery de
conflito) — nenhuma mudança necessária no repo `decole-plano-de-voo-app`.

## Execução (append-only) — correção CRITICAL pós-deploy

**2026-09-12** — Usuário reportou em produção: "fui direcionado direto para o
form do plano de voo após o cadastro" (sem passar pela confirmação de e-mail).
Investigação encontrou DUAS falhas em cadeia, ambas fechadas nesta correção:

1. `api-funnel-ingress` (`buildPromoRedirect`, Fatia C): montava `redirect_url`
   síncrono com `email` na query, seguido na hora pelo navegador — corrigido,
   ver nota em `promo-gratuito-C-funnel-ingress.md`.
2. **[CRITICAL, achado pelo G.12 desta correção]** `links-redirect`
   (`/{prefixo}/promo/{code}`, Fatia B): mesmo depois do fix #1, essa rota
   pública continuava repassando **qualquer** `email` vindo da própria query
   string do request, sem nenhuma verificação de confirmação. Isso significa
   que o bug não dependia do `api-funnel-ingress` nem do formulário — bastava
   conhecer `promo_code` + prefixo do produto (ambos essencialmente públicos)
   e acessar `https://links.decolesuacarreiraesg.com.br/planodevoo/promo/{code}?email={qualquer}`
   diretamente pra resgatar sem DOI. O fix #1 sozinho não resolvia o problema
   real — só removia uma das formas de chegar lá.

   Corrigido em `links-redirect/src/index.ts`: a rota `/promo/{code}` agora
   remove explicitamente `email`/`EMAIL` da query antes de montar o redirect
   pro app, mantendo `utm_*` e demais params de atribuição intactos. O único
   caminho legítimo pra `email` chegar no app passa a ser
   `/promo-signup?rid=...` (KV confirmado por DOI, já existente nesta fatia).

Revisão G.12 rodada duas vezes: a primeira (sobre o fix #1 isolado) devolveu
**BLOCK** com esse achado CRITICAL — o guard rail funcionou como devia,
impedindo que uma correção incompleta fosse a produção.

3. **[fechamento real do CRITICAL]** A 2ª rodada do G.12 achou que mesmo com
   #1 e #2 corrigidos, o domínio final (`plano.decolesuacarreiraesg.com.br`,
   `decole-plano-de-voo-app`) sempre aceitou `email` cru na query string de
   `/promo/{code}` — público, sem gate próprio nenhum. Fechado com um token
   assinado (HMAC-SHA256, segredo compartilhado `PROMO_SIGNUP_SECRET`) que
   `links-redirect` emite só após ler o KV confirmado por DOI, e que o app
   passa a exigir e verificar (`lib/promo/promo-token.ts`) antes de chamar
   `redeem()` — tanto na página pública quanto na API pública
   (`app/api/promo/[code]/route.ts`, mesmo vetor, mesma correção). Verificado
   em produção após deploy: `/promo/{code}?email=forjado` no domínio do app
   agora bounca pra LP (307) em vez de resgatar; `links-redirect` remove
   `email`/`EMAIL` da query antes do redirect; `/funnel/precheckout` com
   `promo_code` não retorna mais `redirect_url`.

**Incidente durante o deploy**: `setup-infra.yml` (modo `full-restart`,
necessário pra levar o novo `PROMO_SIGNUP_SECRET` ao `.env` do VPS) rodou em
paralelo com o `deploy-app.yml` disparado automaticamente pelo push — os dois
tentaram recriar o container `nextjs` ao mesmo tempo, e a stack inteira ficou
em estado `Created` (nunca chegou a `Running`), causando indisponibilidade
total (plano/n8n/links fora do ar por ~9 minutos). Corrigido re-executando
`setup-infra.yml` sozinho (sem `deploy-app.yml` concorrente); confirmado via
smoke test do próprio workflow e `curl` externo (200/200/200). Lição: não
disparar `setup-infra.yml` (full-restart) e um push pro `main` que aciona
`deploy-app.yml` ao mesmo tempo — esperar um terminar antes do outro.

## Decisões tomadas

- DOI **nativo** do Brevo mantido (não self-hosted) — opt-in fica marcado
  corretamente no Brevo, sem trade-off de compliance
- Zero automação/webhook do Brevo — toda a lógica de branch vive no nosso
  código (`funnel-dispatcher` + `links-redirect`), testável e versionado
- `redirectionUrl` deixa de ser constante de catálogo pro caso promo — passa a
  ser calculado em runtime, carregando um `rid` opaco (mesmo padrão já usado
  em `checkout_recovery`, reaproveitado em vez de inventado)
- Segundo template DOI dedicado — assunto **"Confirme para acessar seu Plano
  de Voo gratuito"**, copy própria de isca digital, não reusa o template 10
  (genérico, fluxo pago)
