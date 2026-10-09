# RUNBOOK — Onboarding de Construção de Lista (lead → DOI → SIGN_UP)

> Versão: 1.0 · Criado em: 2026-10-09
> Pré-requisito: tenant já onboardado pelo [`RUNBOOK-ONBOARDING-TENANT.md`](RUNBOOK-ONBOARDING-TENANT.md) v2.0
> (catálogo, Brevo, sGTM, GTM Web, workers, Turnstile).
> Primeira aplicação: tenant `product-engineer` — ver [Aplicação: product-engineer](#aplicação-product-engineer).
> Registro de execução de cada tenant vive em `plans/onboardings/{tenant}-{data}.md`
> (append-only), nunca neste arquivo.

## Objetivo

Fechar o funil de captura de lista de ponta a ponta, com **dois eventos distintos** no
GA4 e no Event Store:

| Etapa | Evento | Significado | Quem emite |
|---|---|---|---|
| Inscrição | `GENERATE_LEAD` | Preencheu o form, DOI enviado, **ainda não confirmou** | Site (dataLayer → GTM Web → sGTM → GA4) |
| Confirmação | `SIGN_UP` | Clicou no link do DOI — **entrou de fato na lista** | Worker `links-redirect` → fila → dispatcher → sGTM → GA4 |

`GENERATE_LEAD` sozinho mede interesse; `SIGN_UP` mede lista real. Taxa de confirmação =
`SIGN_UP / GENERATE_LEAD`. Sem `SIGN_UP`, o tenant não enxerga quem abandonou o DOI.

### Decisão de desenho v2 (2026-10-09, pós-revisão independente e spike L0.5)

Fatos que sustentam o desenho (todos verificados):

- O Brevo **não anexa** e-mail nem id ao redirect pós-DOI, mas **preserva intacta** a query
  do `redirectionUrl` (spike L0.5: `?rid=spike-0000` chegou ao destino final).
- O `links-redirect` **já resolve** `rid` → KV `{tenant}:checkout_recovery:{rid}` → identidade
  do `SIGN_UP` na rota `doi_confirmation` (`withCheckoutRecoveryParams`; teste
  "enfileira SIGN_UP ao confirmar DOI com rid"). Esse caminho **nunca rodou em produção para
  DOI**: o `doiRedirectUrl` sempre foi fixo, sem `rid` (0 de 7 `SIGN_UP` da DECOLE com `rid`).
- O `Location` do redirect sai da URL **original**; o KV só enriquece a URL do **evento**.
  Não há vazamento de identidade para a página de confirmação.
- `normalizeGa4ClientId` aceita `\d+.\d+` sem alterar → se `anonymous_id` for o client id do
  `_ga`, o `sign_up` no GA4 usa o **mesmo `client_id`** do navegador que mandou o `generate_lead`.

Decisões:

1. **Reutilizar o caminho existente.** O dispatcher grava, no DOI, um registro no formato que o
   `links-redirect` já lê (`{tenant}:checkout_recovery:{rid}` → `{ params: {…} }`) e anexa
   `?rid=` ao `redirectionUrl`. O worker não precisa de flag nem de leitor novo.
2. **Gravação dedicada, sem índice.** Não usar `storeCheckoutRecoveryRecord` (ele mantém índices
   por lead e invalida tokens antigos — um e-mail de carrinho abandonado posterior apagaria o
   `rid` do DOI pendente). Função nova e enxuta, mesma chave e formato, TTL próprio.
3. **`event_id` sem nada derivado do e-mail (M1; revisado pelo Code Quality Review S1).**
   `sign_up:{PC}:{lead_id}` quando o KV traz o `lead_id` (id aleatório do site); senão
   `sign_up:{PC}:{rid}`; UUID só sem `rid`. Hash de e-mail sem segredo foi **descartado**: se
   reverte por dicionário e continuaria sendo PII no GA4. Isso
   **muda um contrato existente da DECOLE** (hoje o teste espera `sign_up:{PC}:{email}`).
   Impacto real em produção: nenhum — nenhum `SIGN_UP` da DECOLE teve `rid`; os com e-mail
   vieram de `?email=` em testes manuais.
4. **E-mail em claro na query é ignorado** na rota `doi_confirmation`: identidade só vem do KV.
   Também é mudança de contrato (só tráfego de teste usava).
5. **Client id do GA no form (fatia L3C, site).** O form envia `anonymous_id` = client id do
   `_ga`. O dispatcher copia para o registro do `rid` **só se** estiver no formato `\d+.\d+`.
6. **Opt-in por produto** no dispatcher (`brevoConfig.doiIdentity: true` no `GENERATE_LEAD`).
   Sem a flag, o DOI segue com URL fixa (DECOLE inalterada até decidir ligar).
7. **`SIGN_UP` sem identidade não vai ao GA4 nos produtos com a flag** (`trackingRequiresIdentity`
   no evento `SIGN_UP` do catálogo): bots, scanners e `rid` expirado não inflam a razão
   `sign_up/generate_lead`. Continua indo ao Event Store para diagnóstico. **Limite (S-e):** só
   bloqueia `rid` ausente/inválido — um scanner de e-mail que segue o link real do Brevo chega
   com `rid` válido e passa.
8. **TTL do registro: 14 dias** (o mesmo do `checkout_recovery`, precedente existente e maior
   que a janela típica de confirmação). Registro guarda o mínimo: `email`, `name`, `lead_id`,
   `anonymous_id`, UTMs. **Sem `session_id`** (S-c).

## Fluxo

```
site form ──POST──▶ api.{dominio}/funnel/precheckout ──▶ fila ──▶ dispatcher
   │                                                               │ send_brevo_doi
   │ dataLayer: generate_lead                                      │  grava IDENTITY_KV: {tenant}:checkout_recovery:{rid} → {params:{email,name,lead_id,anonymous_id}}
   ▼                                                               ▼  redirectionUrl = links.{dominio}/{slug}/signup?rid={rid}
GTM Web ─▶ sGTM ─▶ GA4  (GENERATE_LEAD)                     e-mail DOI (Brevo)
                                                                   │ clique (Brevo NÃO anexa e-mail/id; só preserva o ?rid)
                                                                   ▼
                          links.{dominio}/{slug}/signup?rid=…  (links-redirect)
                             │ 1) resolve rid no KV ─▶ SIGN_UP com lead.email/lead_id ─▶ fila ─▶ dispatcher
                             │      ─▶ emit_tracking ─▶ sGTM /mp/collect ─▶ GA4
                             │ 2) 302 ─▶ página de confirmação, SEM rid e SEM e-mail na URL
```

O Brevo só grava atributos (ex.: `FIRSTNAME`) e só adiciona à lista **depois** do aceite do
DOI. O e-mail DOI, portanto, não tem nome do lead — comportamento esperado, não bug.

## Escopo

**Dentro:** domínio de links do tenant, rota `doi_confirmation`, evento `SIGN_UP` no
catálogo, identidade do `SIGN_UP` por `rid` (código de plataforma, L3B), `GA4_API_SECRET`,
redeploy dos workers, troca do `doiRedirectUrl`, validação E2E.

**Fora:** nutrição pós-DOI (Brevo não expõe por API — montar no painel), Meta
Pixel/CAPI, checkout/Hotmart, dashboard.

## Classificação e workflow

Mudança **cross-module e externa/sensível** (produção, analytics, dados pessoais) →
slices pequenos, Planning Review antes de implementar, TDD, rollback por slice. Ver
`~/git/workspace-agent-guidelines/guidelines/change-workflow.md`. **Deploys de produção
(`wrangler deploy`, Cloud Run) são bloqueados pelo harness: o operador roda os comandos.**

## Variáveis (substituir por tenant)

| Placeholder | Exemplo (product-engineer) |
|---|---|
| `{TENANT}` | `product-engineer` |
| `{TENANT_UPPER}` | `PRODUCT_ENGINEER` |
| `{DOMINIO}` | `theproductengineer.net` |
| `{LINKS_HOST}` | `links.theproductengineer.net` |
| `{PRODUCT_CODE}` | `PRODUCT_ENGINEER_NEWSLETTER` |
| `{SLUG}` | `product-engineer` (usado em `/{SLUG}/signup`) |
| `{CONFIRM_URL}` | `https://theproductengineer.net/field-notes/confirmed/` |

---

## Fatia L0 — Planning Review e baseline

> Estimativa: 30 min

### Pré-requisitos

- [ ] Tenant onboardado: lead de teste já passou por `GENERATE_LEAD` → DOI → lista (Fatia 8 do runbook de tenant)
- [ ] `git status --short --branch` revisado nos repos tocados (`funil-mkt-platform`, site do tenant)
- [ ] Planning Reviewer: `APROVADO` ou `APROVADO COM AJUSTES` — pontos que a revisão deve
      decidir: TTL do `rid` (v2: 14 dias), nome/forma das flags `doiIdentity` e
      `trackingRequiresIdentity`, e se a L3B
      vai para a plataforma antes do tenant (afeta DECOLE por compartilhar código)

### Baseline (executar antes de qualquer mudança)

```bash
cd workers/links-redirect && npm ci && npm test      # esperado: verde, anotar nº de testes
cd ../.. && npx vitest run                            # esperado: verde, anotar nº de testes
```

### Critério de aceite

Testes verdes e contagem registrada — qualquer falha posterior é regressão comparável.

### Baseline registrado (product-engineer, 2026-10-09, `main` limpo, sem código alterado)

| Suíte | Comando | Resultado |
|---|---|---|
| `links-redirect` | `cd workers/links-redirect && npm test` | **69 passaram** · 5 arquivos · 0 falhas |
| `funnel-dispatcher` | `cd workers/funnel-dispatcher && npm test` | **198 passaram, 3 ignorados** · 13 arquivos · 0 falhas |
| Raiz | `npx vitest run` | **539 passaram, 3 ignorados** · 44 de 45 arquivos · **1 falha conhecida** |

**Falha conhecida (pré-existente, não é regressão):** `tests/setup-brevo-domain.test.mjs`
(arquivo sem rastreamento no git, do setup de e-mail do domínio) usa `node:test`; o vitest não
acha suíte vitest nele ("No test suite found"). Os testes dele passam pelo runner do Node.
Depois da L3B a **única** falha da raiz deve continuar sendo essa, com as mesmas contagens
(ou maiores, só por testes novos). Não "consertar" no meio da L3B sem registrar.

**Cuidado de versão:** a raiz não tem vitest local; o `npx` baixou a **5.0.3** na hora. Os
workers usam o vitest próprio. Rodar a comparação pós-L3B com o mesmo comando e confirmar
a versão impressa em `RUN v…`.

### Dados de produção da DECOLE (2026-10-09) — reavaliam a prioridade deste runbook

Consultas só de leitura (Event Store D1 `decole-d1-event-store` + API do Brevo da DECOLE),
janela desde 2026-05-19:

| Produto | `GENERATE_LEAD` | Confirmados no Brevo (lista) | `SIGN_UP` (Event Store) | `SIGN_UP` com `rid` | `SIGN_UP` com `anonymous_id` real |
|---|---|---|---|---|---|
| ESG Mentoria | 7 | 2 (lista 7) | 4 (3 no mesmo dia 27/05, provavelmente testes) | 0 | 0 |
| Plano de Voo | 22 | 1 (lista 8) | 3 (2 no mesmo dia 19/05, provavelmente testes) | 0 | 0 |

Conclusões:

- **O caminho `rid` → KV → identidade nunca rodou em produção para DOI**: nenhum `SIGN_UP`
  tem `rid`, porque o `doiRedirectUrl` da DECOLE é fixo. Todos os `SIGN_UP` têm
  `anonymous_id` sintético (`anon-…`). Os poucos com e-mail vieram de `?email=` (testes).
- **Não há indício de `SIGN_UP` perdido**: o Brevo também tem quase nenhum confirmado.
- **O problema principal é a taxa de confirmação do DOI**: ~5% no Plano de Voo (1/22),
  ~29% no ESG (2/7). Identidade do `SIGN_UP` é secundária enquanto quase ninguém confirma.
- Os sites DECOLE/Plano de Voo enviam `ANONYMOUS_ID`, mas é UUID próprio do `localStorage`
  (`MetaAM.getAnonymousId()`), **não** o client id do `_ga` → eventos de servidor da
  DECOLE no GA4 provavelmente não ligam ao usuário do navegador (inferência, não verificado no GA4).

#### Entrega e clique do DOI (API de estatísticas do Brevo, 19/05 → 09/10/2026)

| Template | Envios | Entregues | Bounce/bloqueio | Cliques (eventos) | Confirmados na lista |
|---|---|---|---|---|---|
| 1 — DOI ESG | 13 | 12 | 1 bloqueado | 3 | 2 (lista 7) |
| 10 — DOI Plano de Voo | 19 | 16 | 2 hard bounce + 1 bloqueado | 4 | 1 (lista 8) |
| 23 — DOI Isca Digital PV | 4 (desde 17/08) | 4 | — | 5 | — (fluxo promo, outra rota) |

- Aberturas não são confiáveis: muitos `loadedByProxy` (pré-carregamento de privacidade do
  cliente de e-mail) inflam o `opened`. Usar **clique** como sinal.
- **Entrega não é o gargalo** (~88% entregue, 0 spam reports). O funil perde no clique de
  confirmação (~25% dos entregues) e, sobretudo, no **volume de topo**: ~32 DOIs em 4,5 meses.
- Os 326 envios com tag `optin` em ago–out são do **template 15 "Reativação Carreira ESG"**
  (campanha de reativação), não de DOI. Ter a tag `optin` num template de campanha mistura as
  estatísticas de DOI por tag — filtrar sempre por `templateId`, nunca por `tag=optin`.
- `promoDoiTemplateId` não está no catálogo dos produtos DECOLE, mas o template 23 foi enviado:
  a config de promo vive em outro nível (evento/promo). Não investigado.

**Conclusão de prioridade:** com ~3 confirmações reais em 4,5 meses, a identidade do `SIGN_UP`
(L3B) não muda nenhuma decisão de negócio da DECOLE hoje. Para o PE, que está começando, ela
ainda vale como fundação — mas o retorno maior está em volume de leads e na taxa de clique do DOI.

### Planning Review independente (Opus 5.5) — 2026-10-09: **BLOQUEADO**

> **Status:** v2 revisada de forma independente (Opus 5.5, 2ª rodada) → **APROVADO COM AJUSTES**.
> Ajustes MF1, MF2 e S-a…S-g incorporados (ver *Ajustes da 2ª revisão*). Liberado para a L1.

#### Execução (append-only)

**2026-10-09 — L1, L3B e L3C implementadas, SEM commit, SEM deploy.**

| Fatia | Arquivos | Testes |
|---|---|---|
| L1 + L3B.2 | `workers/links-redirect/src/index.ts`, `workers/links-redirect/test/index.test.ts` | vermelho: 8 falhas pelo motivo certo → verde: **78/78**; `tsc` limpo |
| L1 + L3B.1 | `workers/funnel-dispatcher/src/handlers/index.ts`, `workers/funnel-dispatcher/test/unit/doi-identity.test.ts` (novo) | vermelho: 3 falhas → verde: **207 passaram, 3 ignorados**; `tsc` limpo |
| Raiz | — | **557 passaram, 3 ignorados**; única falha = a conhecida do baseline (vitest 5.0.3) |
| L3C (site PE) | `assets/field-notes-signup.js`, `assets/subscribe-form.js`, `scripts/test_ga_client_id.cjs` (novo) | `getGaClientId` 7/7; `test_subscribe.cjs` (navegador) verde |

- Passo 0 da L3C: `_ga` existe e é legível por JS no site do PE (`GA1.1.<n>.<n>`; também há `FPLC` do sGTM). Fallback não foi necessário.
- Os testes de identidade expuseram **dois bugs já existentes em produção** (todos os tenants) e corrigidos pela L3B.2: `?email=` vazava para o `Location` da página de confirmação, e `?event_id=` na query sobrescrevia o `event_id` do `SIGN_UP`.
- Mudanças de contrato confirmadas no teste existente da DECOLE: `event_id` com hash e `recovery_id` preenchido.
- **L1 completa (2026-10-09):** testes de host/rota do PE (`links-redirect`, +4: 2 vermelhos até a L3)
  e de catálogo (`funnel-dispatcher/test/unit/catalog-list-building.test.ts`, novo: 4 do PE vermelhos
  até a L3; 4 genéricos verdes — todo DOI da DECOLE aponta para host/rota atendidos).
- **L3 aplicada no working tree (2026-10-09):** `domains` + bloco `links` + evento `SIGN_UP`
  (`trackingRequiresIdentity`) + `doiFlows[0].redirectionUrl` atualizado (sai o `_pending`, a
  página existe) + `GENERATE_LEAD.brevoConfig` (`doiRedirectUrl` → host de links, `doiIdentity: true`)
  + rota da zona `theproductengineer.net` no `links-redirect/wrangler.toml`. JSON válido,
  `check-config` ok. Testes: `links-redirect` **82/82**, dispatcher **217 + 3 ignorados**, raiz
  **571 + 3 ignorados** (só a falha conhecida). `tsc` limpo nos dois workers.
- **L2 DONE (2026-10-09):** registro `AAAA links.theproductengineer.net → 100::` (proxied, TTL auto)
  criado via API Cloudflare (token de agents, zona `theproductengineer.net`), id
  `c543888192331307c7e9a1b31641a2f8`, comentário "links-redirect worker (RUNBOOK-ONBOARDING-LISTA L2)".
  `dig` resolve para IPs Cloudflare (`104.21.5.112`, `172.67.133.90`, `2606:4700:…`). Ainda sem
  worker na rota até o deploy da L5. Rollback: `DELETE /zones/{zona}/dns_records/c543888192331307c7e9a1b31641a2f8`.
- **Divisão de commits obrigatória (S1):** commit A = domains, `links`, `SIGN_UP`, `wrangler.toml`;
  commit B = `doiRedirectUrl` + `doiIdentity` + `doiFlows` (só depois do passo 2 da L5). O teste de
  catálogo "GENERATE_LEAD redireciona o DOI…" fica vermelho entre A e B — esperado.
- **Code Quality Review independente (Opus 5.5): APROVADO COM RESSALVAS**, sem MUST-FIX.
  Confirmou em código que a chave gravada pelo dispatcher (`product-engineer:checkout_recovery:{rid}`,
  tenant vindo do host `api.`) é a mesma lida pelo `links-redirect` no host `links.`, e que
  `trackingRequiresIdentity` é encontrada para o `SIGN_UP` sem `tenant_id`. SHOULD-FIX aplicados:
  - S1: `event_id` por `lead_id`/`rid` (sem hash de e-mail); telefone e nome também descartados da query.
  - S2: o teste da troca do DOI foi para `catalog-doi-switch.test.ts`, que entra só no commit B
    (cada commit verde).
  - S3: import do helper no site sobe para `?v=3` (evita form novo com helper antigo em cache).
  - S4: testes com o tenant PE real nos dois workers.
  Resultado: `links-redirect` 84/84, dispatcher 217 + 3 ignorados, raiz 574 + 3 ignorados (só a
  falha conhecida), `tsc` limpo, site 7/7 + `test_subscribe.cjs` verde.
  Ressalva aceita: dedupe de 90 dias por `lead_id` pula o `SIGN_UP` de quem se descadastra e
  se reinscreve no mesmo navegador dentro de 90 dias.
- Pendente: commits (L3B.1, L3B.2, catálogo A, catálogo B na plataforma; 1 no site), L4, L5, L6.

#### Ajustes da 2ª revisão (incorporados)

| Id | Ajuste | Onde |
|---|---|---|
| MF1 | `payload.link_url` grava a URL **enriquecida pelo KV** (e-mail, nome…) em `payload_json` no D1. Passar a usar a URL original sem `email`/`EMAIL` e sem valores do KV | L3B.2 passo 6, L1 |
| MF2 | Rollback ordenado: desligar `doiIdentity` + deploy do dispatcher **antes** de reverter a L3B.2 (o código antigo volta a pôr e-mail no `event_id`) | L3B Rollback |
| S-a | `?email=` era repassado ao `Location` → `page_location` no GA4. Incluir `email`/`EMAIL` nos `ignoreKeys` da rota DOI | L3B.2 passo 5 |
| S-b | Na rota DOI a query tinha precedência sobre o KV e podia sobrescrever `event_id`. Ignorar `event_id`/`eventId` e chaves de identidade vindas da query | L3B.2 passo 3 |
| S-c | Não gravar `session_id` (UUID de `sessionStorage`; o MP o envia como sessão do GA4) | Decisão 8, L3B.1 |
| S-d | Critério de aceite do M2 na L6 + fallback se o `_ga` não for legível por JS; L3C antes da L5 | L3C, L6 |
| S-e | O filtro `trackingRequiresIdentity` só bloqueia `rid` ausente/inválido; scanner que segue o link real passa | Decisão 7 |
| S-f | Montar a chave com `checkoutRecoveryTokenKey` (mesmo formato por construção) | L3B.1 |
| S-g | Testar **em host DECOLE** cada mudança de contrato, incluindo `payload.recovery_id` (hoje `undefined`) | L1 |

Notas registradas: KV falha no 1º clique e funciona no 2º → 2 `SIGN_UP` (raro, aceito); o `rid`
do DOI também funciona em `/checkout?rid=` (mesmo comportamento do `checkout_recovery`,
inofensivo); atualizar `doiFlows[].redirectionUrl` do catálogo (só documentação).

> **Esta revisão substitui a auto-revisão logo abaixo**, que está mantida só como histórico.
> MUST-FIX conferidos no código pelo autor do plano (todos confirmados).
> **A L3B e a L1 de identidade NÃO devem ser executadas como estão escritas.**

```text
Planning Review: BLOQUEADO

MUST-FIX:
M1. event_id = sign_up:{PC}:{email} vaza o e-mail: vai como parâmetro do evento no GA4 (MP),
    para a chave do DEDUPE_KV (90d), para funnel_events.event_id (D1) e para
    anonymous_id = anon-{event_id} (identity_links no D1 + IDENTITY_KV, 365d).
    Usar sign_up:{PC}:{sha256(email)} ou sign_up:{PC}:{rid}.
M2. Não existe anonymous_id real para copiar: o form do PE envia só LEAD_ID, session_id e
    utm (sem client id do _ga); resolve_identity grava anon-{event_id} sintético. O sign_up
    nunca ligará ao usuário do generate_lead no GA4 sem uma fatia no SITE (capturar _ga →
    anonymous_id, ou user_id) — ou o objetivo deve abrir mão disso explicitamente.
M3. Diagnóstico da auto-revisão errado: na rota doi_confirmation o Location sai da URL
    ORIGINAL; withCheckoutRecoveryParams só enriquece a URL do EVENTO. O caminho
    rid → KV ({tenant}:checkout_recovery:{rid}) → SIGN_UP com identidade JÁ EXISTE e tem
    teste. O plano duplica isso e ainda esconde uma decisão: como o links-redirect
    descobriria a flag doiIdentity (que mora no brevoConfig do GENERATE_LEAD).
    Alternativa: reutilizar/estender o caminho existente, sem flag no worker.

SHOULD-FIX:
S1. doiRedirectUrl + doiIdentity em commit próprio, só após validar a L5 passo 2
    (deploy-all-workers.yml sobe todos os workers juntos a partir do main).
S2. Rollback da L5 deve reverter só URL/flag, não domains/links/rota (DOIs em trânsito → 404).
S3. Falha aberta anônima infla a métrica (bots/scanners em /signup). Sem identidade:
    não emitir ao GA4 ou marcar identity_status=miss.
S4. rid desconhecido: manter event_id = sign_up:{PC}:{rid} (não UUID) para não duplicar.
S5. Padronizar prefixo de chave como o código: {tenant}:doi_confirmation:{rid}.
S6. Fatos errados no plano: host fora de domains dá 404 (não cai na DECOLE); o dispatcher
    resolve tenant pelo product_code (Gotcha 1 e L1 errados); curl -sI é HEAD e não
    enfileira nada — usar GET com rid de teste na L5.
S7. Teste: rid válido não pode pôr e-mail em event_id, anonymous_id, chaves de KV ou MP.

Notas: idempotência real vem do DEDUPE_KV por handler (90d), não do KV de identidade;
session_id do PE é UUID de sessionStorage, não ga_session_id; checkout_recovery já guarda
e-mail por 14d (precedente para TTL). Spike L0.5 continua válido.
```

Evidências (conferidas): `links-redirect/src/index.ts:547-562, 666-674`;
`links-redirect/test/index.test.ts:231-279`; `funnel-dispatcher/src/handlers/index.ts:389-392,
2078-2086`; `sites/theproductengineer.net/assets/subscribe-form.js:190-198`.

### Planning Review — 2026-10-09 (auto-revisão do autor — SUPERADA, ver acima)

> Feita pelo mesmo agente que escreveu o plano: vale como checagem contra o código, **não
> como revisão independente**. Antes da L3B, pedir uma segunda revisão (humano ou outro
> agente) — o checklist abaixo não substitui isso.

```text
Planning Review: APROVADO COM AJUSTES

MUST-FIX:
1. Rota doi_confirmation hoje passa por withCheckoutRecoveryParams ANTES do SIGN_UP
   (links-redirect/src/index.ts, ramo handleDoiConfirmationPath). Essa função APAGA
   rid/recovery_id da URL (linhas ~240-244), então o buildSignUpEvent nunca veria o rid.
   A L3B.2 precisa resolver a identidade a partir da URL ORIGINAL, e o comportamento da
   rota deve depender da flag do produto para a DECOLE ficar byte-idêntica.
2. emit_tracking monta o client_id do GA4 a partir de identity.anonymous_id e, se faltar,
   deriva um id sintético do event_id. Sem anonymous_id no SIGN_UP, o sign_up aparece no GA4
   como OUTRO usuário (não liga ao generate_lead da mesma pessoa). O e-mail sozinho no KV
   não resolve isso. O registro do KV precisa carregar anonymous_id/session_id do
   GENERATE_LEAD, e é preciso VERIFICAR que o form do PE realmente os envia (os campos
   ocultos que vi são product_code, event_type, LEAD_ID e session_id — sem client_id do GA).
3. Spike L0.5 (abaixo) antes de escrever código: provar que o Brevo preserva ?rid= no
   redirectionUrl. Se não preservar, a L3B inteira cai e o desenho muda.

SHOULD-FIX:
4. Idempotência: NÃO apagar o registro do KV no primeiro uso. Se apagar, o segundo clique
   perde a identidade e gera outro event_id (duplica o SIGN_UP). Deixar expirar pelo TTL.
5. Tipo do catálogo: adicionar doiIdentity ao tipo de brevoConfig no dispatcher
   (doiTemplateId/doiRedirectUrl já estão tipados) e confirmar que `npm run check-config`
   e quaisquer validadores de catálogo aceitam a chave nova.
6. L3B vira 2 commits (dispatcher, links-redirect), cada um com seus testes verdes.
7. TTL de 7 dias: aceitável, mas é dado pessoal (e-mail) parado no KV. Registrar a
   justificativa e guardar o mínimo no registro (email, nome, lead_id, anonymous_id).

Notas:
- Slice L3B (3–4h) cabe em um dia; L1+L3+L3B juntos NÃO — manter como fatias separadas.
- Rollback ok: flag desligada = comportamento atual; registros no KV expiram sozinhos.
- Ordem de deploy (links-redirect antes do dispatcher) está explícita na L5.
- Lacuna documentada, não escondida: sem anonymous_id o sign_up não liga ao usuário no
  GA4. A razão sign_up/generate_lead (contagem) continua válida mesmo assim.
- Aprovação final da L3B depende do resultado do spike L0.5.
```

### Fatia L0.5 — Spike: o Brevo preserva `?rid=`?

> Estimativa: 20 min · Não escreve código · Envia 1 e-mail real para o alias de teste

Objetivo: eliminar a premissa que sustenta a L3B antes de investir nela.

1. Via API do Brevo (`POST /v3/contacts/doubleOptinConfirmation`), enviar um DOI para um
   alias de teste novo (`conta+{tenant}-spike@gmail.com`) com
   `redirectionUrl = {CONFIRM_URL}?rid=spike-0000`.
2. Pegar o link do botão no e-mail e seguir os redirects pelo servidor, imprimindo **só os
   nomes dos parâmetros** de cada salto (`curl` sem `-L`, um salto por vez).
3. **Esperado:** o salto final para `{CONFIRM_URL}` ainda contém `rid=spike-0000`.

| Resultado | Consequência |
|---|---|
| `rid` preservado | L3B aprovada como desenhada |
| `rid` descartado/alterado | **BLOQUEADO**: redesenhar (ex.: identidade por `lead_id` no template, ou aceitar `SIGN_UP` anônimo — opção 2) |

Limpeza: apagar o contato do spike no Brevo ao final.

#### Resultado — executado em 2026-10-09: **`rid` PRESERVADO**

DOI enviado pela API (conta Brevo do PE, template 1, lista 3) para
`chicoria+pe-spike@gmail.com` com `redirectionUrl = …/field-notes/confirmed/?rid=spike-0000`.
Cadeia observada seguindo o botão do e-mail, um salto por vez:

| Salto | HTTP | Host | Parâmetros |
|---|---|---|---|
| 0 | 302 | `bcdgfdif.r.bh.d.sendibt3.com` (tracking) | — |
| 1 | 302 | `sibcontacts.com/confirm/…` | `utm_source`, `utm_campaign`, `utm_medium` |
| 2 | 200 | `theproductengineer.net/field-notes/confirmed/` | **`rid=spike-0000`** |

Conclusão: o Brevo mantém a query do `redirectionUrl` intacta (e não acrescenta nada). A
premissa da L3B está confirmada; o bloqueio que resta é o desenho (MUST-FIX M1–M3 da revisão
independente), não a viabilidade. Limpeza: contato do spike removido da lista 3.

---

## Fatia L1 — Testes primeiro (TDD)

> Estimativa: 1–2h · Falham agora; os de host/rota passam após a L3, os de identidade após a L3B.

Em `workers/links-redirect/test/index.test.ts` (padrão dos testes de `doi_confirmation`
existentes da DECOLE):

- [x] Host `{LINKS_HOST}` resolve para o tenant `{TENANT}` (hoje: **404** `tenant_not_configured`)
- [ ] `GET {LINKS_HOST}/{SLUG}/signup` → **302** para `{CONFIRM_URL}`
- [ ] Mesmo request enfileira **exatamente 1** `SIGN_UP` com `product_code={PRODUCT_CODE}`
- [ ] Rota inexistente em `{LINKS_HOST}` → não enfileira nada
- [ ] **Regressão:** hosts e rotas da DECOLE continuam idênticos

**Identidade do `SIGN_UP` (links-redirect) — inclui mudanças de contrato:**

- [ ] `?rid=<válido>` com registro `{tenant}:checkout_recovery:{rid}` → `SIGN_UP` com `lead.email`, `identity.anonymous_id`, `identity.lead_id`
- [x] **M1:** `event_id` = `sign_up:{PC}:{lead_id}` (ou `:{rid}`) — **nunca** contém `@` nem nada derivado do e-mail (asserção em `event_id`, `payload`)
- [ ] **Contrato alterado:** atualizar o teste existente "enfileira SIGN_UP ao confirmar DOI com rid" (hoje espera `sign_up:DECOLE_PLANOVOO:lead@exemplo.com`) para o `event_id` com hash — registrar no commit como mudança intencional
- [ ] `?rid=<desconhecido/expirado>` → 302; `SIGN_UP` sem e-mail; `event_id` = `sign_up:{PC}:{rid}` (S4, não UUID)
- [ ] Sem `rid` → 302; `event_id` com UUID (comportamento atual)
- [ ] `?email=x@y.z` em claro, sem `rid` → **ignorado** (contrato alterado; não vira `lead.email`)
- [ ] `Location` do 302 **não contém** `rid`, e-mail nem nenhum valor do KV (regressão de privacidade)
- [ ] `rid` de outro tenant → não resolve (chave com prefixo de tenant)
- [ ] KV com erro no `get` → 302 + `SIGN_UP` sem identidade, sem 5xx
- [ ] HEAD em `/signup` → não enfileira (comportamento atual, documentar)
- [ ] **MF1:** `payload.link_url` sem `email`, `name`, `lead_id`, `anonymous_id` nem `@`; `payload_json` serializado sem `@`
- [ ] **S-a:** `?email=` na rota DOI não aparece no `Location`
- [ ] **S-b:** `?event_id=` / `?anonymous_id=` / `?lead_id=` na query não sobrescrevem os valores do KV
- [ ] **S-g (host DECOLE):** cada mudança de contrato testada em `links.decolesuacarreiraesg.com.br`: `event_id` com hash, `recovery_id` preenchido (era `undefined`), `?email=` descartado, `rid` desconhecido → `sign_up:{PC}:{rid}`

**DOI com `rid` (funnel-dispatcher):**

- [ ] Produto **com** `doiIdentity`: `redirectionUrl` = `doiRedirectUrl?rid=<uuid>`; KV `{tenant}:checkout_recovery:{rid}` = `{ params: {email,name,lead_id,anonymous_id?,session_id?,utm_*} }` com TTL de 14 dias
- [ ] `anonymous_id` só entra no registro se casar `^\d+\.\d+$`; `anon-…` sintético **não** entra
- [ ] Registro **sem** `session_id` (S-c)
- [ ] Produto **sem** a flag (DECOLE): `redirectionUrl` idêntico ao atual e **nenhuma** escrita no KV
- [ ] Escrita no KV falha → DOI enviado com a URL fixa + `handler_warn`
- [ ] Gravação **não** toca os índices de `checkout_recovery` (um carrinho abandonado posterior não invalida o `rid` do DOI)
- [ ] Promo continua precedendo (com `promo_code` + `promoSignupUrl`)
- [ ] `emit_tracking` de `SIGN_UP` com `trackingRequiresIdentity` e sem `lead.email` → **pula** o GA4 com log `tracking_skip_no_identity`; sem a flag → comportamento atual
- [ ] `SIGN_UP` com `anonymous_id` no formato GA → `client_id` do MP = o mesmo valor (sem hash)

Em testes de catálogo (`tests/`): evento `SIGN_UP` presente no produto; toda rota
`doi_confirmation` tem `redirectUrl` absoluta e `productCode` existente no tenant.

### Critério de aceite

Novos testes falham pelo motivo certo (host/rota ausentes), os da DECOLE seguem verdes.

---

## Fatia L2 — DNS e zona: `{LINKS_HOST}`

> Estimativa: 30 min · Operador: dono da zona Cloudflare

O worker é roteado por zona. O `wrangler.toml` do `links-redirect` hoje tem **uma** rota
(zona da DECOLE); a zona do tenant precisa de rota própria **no mesmo worker**.

### Mudança

Registro DNS na zona `{DOMINIO}` — precisa existir e estar **proxied** para o Worker
receber o tráfego (padrão para hostname só de Worker):

| Tipo | Nome | Conteúdo | Proxy |
|---|---|---|---|
| AAAA | `links` | `100::` | Proxied (laranja) |

```bash
# Verificar após criar
dig +short {LINKS_HOST}            # esperado: IPs da Cloudflare (proxied)
```

### Critério de aceite

`{LINKS_HOST}` resolve para IPs Cloudflare. (Ainda 404/erro do edge — o worker só
responde após L5.)

### Rollback

Remover o registro `links` da zona.

---

## Fatia L3 — Catálogo e código

> Estimativa: 1h

### 3.1 Domínio do tenant (resolução por hostname)

Em `tenants.{TENANT}.domains`, adicionar `{LINKS_HOST}`:

```jsonc
"domains": ["api.{DOMINIO}", "{DOMINIO}", "{LINKS_HOST}"]
```

> `tryResolveTenantIdFromHostname` só reconhece hosts listados aqui. Esquecer isso faz
> o tenant cair no fallback `decole` — **o SIGN_UP seria gravado no tenant errado**.

### 3.2 Bloco `links` do tenant

```jsonc
"links": {
  "linksDomain": "{LINKS_HOST}",
  "routes": [
    {
      "path": "/{SLUG}/signup",
      "type": "doi_confirmation",
      "productCode": "{PRODUCT_CODE}",
      "redirectUrl": "{CONFIRM_URL}"
    }
  ]
}
```

### 3.3 Evento `SIGN_UP` no produto

Copiar a definição de `DECOLE_ESG_MENTORIA` (`source: links-redirect`):

```jsonc
{
  "funnelStage": "CONVERSION",
  "eventType": "SIGN_UP",
  "delivery": "server_queue",
  "source": "links-redirect",
  "ingress": "decole-q-funnel-events",
  "queue": "decole-q-funnel-events",
  "chain": ["resolve_identity", "upsert_event_store", "enrich_attribution", "update_brevo_funnel", "emit_tracking"],
  "destinations": ["Brevo", "Event Store", "sGTM"],
  "trackingRequiresIdentity": true
}
```

Em `brevoConfig` do `GENERATE_LEAD`, trocar o `doiRedirectUrl` e **ligar a identidade**
(a flag só tem efeito depois da L3B):

```jsonc
"doiRedirectUrl": "https://{LINKS_HOST}/{SLUG}/signup",
"doiIdentity": true
```

> `doiRedirectUrl` continua sendo a URL **base**; o `?rid=` é anexado pelo dispatcher em
> runtime. Produto sem `doiIdentity` mantém o comportamento atual.

> **Commit próprio (S1):** a troca de `doiRedirectUrl` + `doiIdentity` vai num commit separado,
> aplicado ao `main` só depois do passo 2 da L5 — o `deploy-all-workers.yml` sobe todos os
> workers juntos a partir do `main`.
>
> **Não fazer o deploy do dispatcher com o `doiRedirectUrl` novo antes de a L5 validar o
> host.** Se o worker ainda não responde em `{LINKS_HOST}`, todo DOI enviado leva a um
> link quebrado. A troca entra em produção por último.

### 3.4 `wrangler.toml` do `links-redirect`

Adicionar a rota da zona do tenant, mantendo a da DECOLE:

```toml
routes = [
  { pattern = "links.decolesuacarreiraesg.com.br/*", zone_name = "decolesuacarreiraesg.com.br" },
  { pattern = "{LINKS_HOST}/*", zone_name = "{DOMINIO}" }
]
```

### 3.5 Validação

```bash
node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"
npm run check-config
cd workers/links-redirect && npm test     # L1 agora verde
cd ../.. && npx vitest run                # sem regressão vs baseline L0
```

### Rollback

`git revert` do commit da fatia. Nada em produção mudou ainda (catálogo é embutido no
bundle do worker, só vale após o deploy da L5).

---

## Fatia L3B — Plataforma: `rid` no DOI + `event_id` sem PII

> Estimativa: 3h · **2 commits** (L3B.1 dispatcher, L3B.2 links-redirect), cada um verde
> Pré-requisitos: spike L0.5 ✅ (`rid` preservado); testes da L1 escritos e falhando.
> **Toca código compartilhado com a DECOLE** e **muda dois contratos** (formato do `event_id`
> do `SIGN_UP`; `?email=` ignorado na rota de DOI). Code Quality Review obrigatório ao fim.

### L3B.1 — `funnel-dispatcher`

Arquivo: `workers/funnel-dispatcher/src/handlers/index.ts`.

1. `resolveDoiRedirectionUrl`: depois do ramo de promo e antes do retorno da URL fixa, se
   `brevoConfig.doiIdentity === true`, houver `IDENTITY_KV` e e-mail:
   - `rid = crypto.randomUUID()`
   - `storeDoiConfirmationRecord(event, env, rid)` → grava
     `tenantScopedKey(tenantId, "checkout_recovery:" + rid)` =
     `{ params: { email, name, lead_id, anonymous_id?, utm_* }, kind: "doi_confirmation" }`
     (sem `session_id` — S-c); chave montada com `checkoutRecoveryTokenKey` (S-f)
     com `expirationTtl: CHECKOUT_RECOVERY_TTL_SECONDS` (14 dias). **Sem índices.**
   - retorna a URL com `rid` via `URL.searchParams.set` (preserva query já existente).
   - Falha no KV → `handler_warn` (`doi_identity_store_failed`) e URL fixa.
2. `anonymous_id` só é gravado se `/^\d+\.\d+$/` (client id do GA). Sintético fica de fora.
3. `emit_tracking`: se o evento do catálogo tiver `trackingRequiresIdentity: true` e o evento não
   tiver `lead.email`, logar `tracking_skip_no_identity` e não chamar o MP.
4. Tipos: adicionar `doiIdentity?: boolean` ao `brevoConfig` e `trackingRequiresIdentity?: boolean`
   ao evento do catálogo; garantir que `npm run check-config` aceita as chaves.

### L3B.2 — `links-redirect`

Arquivo: `workers/links-redirect/src/index.ts` (rota `doi_confirmation` + `buildSignUpEvent`).

1. Capturar o `rid` da URL **original** antes de `withCheckoutRecoveryParams` (que o apaga) e
   passá-lo ao `buildSignUpEvent` como `recovery_id`.
2. `event_id`: `sign_up:{PC}:{lead_id}` se o `lead_id` veio do KV;
   `sign_up:{PC}:{rid}` se há `rid` sem identidade; UUID sem `rid`.
3. Na rota `doi_confirmation`, apagar da URL **antes** do enriquecimento: `email`/`EMAIL`,
   `event_id`/`eventId`, `anonymous_id`/`anonymousId`, `lead_id`/`LEAD_ID`, `session_id` (S-b).
   Só o KV é fonte de identidade.
4. Log `sign_up_identity_miss` quando há `rid` e o KV não resolve.
5. `Location`: acrescentar `email`/`EMAIL` aos `ignoreKeys` de `handleDoiConfirmationPath` (S-a).
   Nada muda nas rotas de checkout/promo.
6. **MF1:** `payload.link_url` = URL **original** sem `email`/`EMAIL` e sem nenhum valor do KV
   (hoje é a URL enriquecida, que leva e-mail para `payload_json` no D1).

### Validação

```bash
cd workers/funnel-dispatcher && npm test
cd ../links-redirect && npm test
cd ../.. && npx vitest run   # só a falha conhecida do baseline; contagens ≥ L0
grep -rn "sign_up:.*@" workers/*/test   # esperado: nenhum event_id com e-mail
```

### Critério de aceite

- Testes de identidade da L1 verdes; baseline da L0 sem regressão (exceto o teste com contrato
  alterado, atualizado de forma explícita no mesmo commit).
- Nenhum `event_id` com e-mail em testes ou fixtures.

### Rollback

**Ordem obrigatória (MF2):**

1. Desligar `doiIdentity` no catálogo e fazer o deploy do dispatcher (para de gerar `rid`).
2. Esperar o TTL (14 dias) **ou** aceitar o risco: links de DOI já enviados com `rid`, se o
   `links-redirect` antigo voltar, geram `event_id` com e-mail (código antigo).
3. Só então `git revert` da L3B.2 e deploy do `links-redirect`.

Reverter só a L3B.1 é seguro a qualquer momento (para de gravar no KV).

---

## Fatia L3C — Site: client id do GA no form (`anonymous_id`)

> Estimativa: 1h · Repo do site do tenant (PE: `adilson-hub/sites/theproductengineer.net`)
> Independente da L3B — pode ir antes (sem L3B, o campo só passa a existir no `GENERATE_LEAD`).
> Push do site **publica em produção**: confirmar com o dono antes.

### Contexto

O form envia hoje `LEAD_ID`, `session_id` e UTMs, sem o client id do GA. Evidência de que o
client id existe no navegador do PE: os hits ao sGTM do E2E de 2026-10-09 traziam
`cid=<n>.<n>`. Falta verificar se ele está no cookie `_ga` (modo JS) ou só num cookie de
servidor (FPID) — **passo 0 desta fatia**.

**Fallback decidido (S-d):** se o `_ga` não for legível por JS (FPID/HttpOnly), a fatia não
muda o site; o `sign_up` segue com `client_id` sintético e o M2 fica registrado como **não
resolvido** para este tenant. **Ordem:** L3C antes da L5/L6.

### Mudança

Em `assets/subscribe-form.js` (e no helper compartilhado `field-notes-signup.js`):

```javascript
// getGaClientId(): lê o cookie _ga ("GA1.<n>.<a>.<b>") e devolve "<a>.<b>"; senão "".
// No submit: if (cid) data.set('anonymous_id', cid);
```

- Sem cookie (bloqueio/consentimento) → não envia o campo (dispatcher usa o sintético).
- **Não** usar o UUID do `localStorage` como na DECOLE: ele não é o id do GA.
- `ga_session_id` fica fora do escopo (o `session_id` atual é UUID do `sessionStorage`).

### Testes

- [ ] Unit: `getGaClientId` com `GA1.1.123.456` → `123.456`; cookie ausente → `""`; formato inválido → `""`
- [ ] Manual no navegador: `document.cookie` contém `_ga`; o POST do form inclui `anonymous_id`
- [ ] Event Store: `GENERATE_LEAD` de teste com `anonymous_id` no formato `\d+.\d+`

### Critério de aceite

`GENERATE_LEAD` de teste chega com `anonymous_id` igual ao `cid` visto nos hits do GA4.

### Rollback

Reverter o commit do site; o campo simplesmente deixa de ser enviado.

### Aplicação à DECOLE (decisão separada, não executar aqui)

O site da DECOLE envia `anonymous_id` = UUID do `MetaAM` (também usado como `external_id` da
Meta). Trocar por client id do GA afetaria a Meta; se for feito, enviar o client id num campo
novo (ex.: `ga_client_id`) e mapear no ingress, sem mexer no `external_id`.

---

## Fatia L4 — `GA4_API_SECRET`

> Estimativa: 15 min · Operador (UI do GA4) + Secrets Store

O `emit_tracking` do `SIGN_UP` chama `{sgtm}/mp/collect?measurement_id=…&api_secret=…`
(Measurement Protocol). **Sem o secret, o `SIGN_UP` é gravado no Event Store e no Brevo,
mas não chega ao GA4.** O binding `GA4_API_SECRET_{TENANT_UPPER}` já existe no
`wrangler.toml` do dispatcher; falta o **valor**.

### Passos

1. GA4 Admin → Data Streams → (stream do tenant) → Measurement Protocol API secrets → **Create**.
2. Gravar no Secrets Store como `ga4_api_secret_{tenant_snake}` (nome conforme o binding
   do `funnel-dispatcher/wrangler.toml`). Nunca em arquivo versionado nem em chat.
3. Redeploy do dispatcher **só se** o binding for novo; secret já bindado não exige.

```bash
npx wrangler secrets-store secret list --store-id <STORE_ID> | grep ga4_api_secret_{tenant_snake}
# esperado: o nome listado (valor nunca é exibido)
```

### Critério de aceite

Secret existe no store e o binding resolve (log do dispatcher sem
`secret_missing` ao processar um `SIGN_UP`).

### Rollback

Deletar o secret no GA4 (invalida) e no Secrets Store.

---

## Fatia L5 — Deploy e troca do redirect (ordem importa)

> Estimativa: 45 min · **Operador roda os comandos** (bloqueio do harness em deploy de produção)

Ordem obrigatória, com validação entre os passos:

```bash
# 1) Worker passa a atender o novo host (catálogo novo vai no bundle)
npx wrangler deploy --config workers/links-redirect/wrangler.toml
npx wrangler deployments list --name decole-links-redirect | head -3   # versão nova, timestamp recente

# 2) Validar o host ANTES de mexer no DOI
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://{LINKS_HOST}/{SLUG}/signup?rid=00000000-0000-4000-8000-000000000000"   # GET (HEAD não enfileira)
# esperado: HTTP 302 + location: {CONFIRM_URL} (rid desconhecido → falha aberta, sem e-mail/rid no Location)
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://links.decolesuacarreiraesg.com.br/decole-esg/signup"
# esperado: 302 (DECOLE intacta)

# 3) Só então: dispatcher com o catálogo novo (doiRedirectUrl novo + SIGN_UP)
npx wrangler deploy --config workers/funnel-dispatcher/wrangler.toml
npx wrangler deployments list --name decole-funnel-dispatcher | head -3
```

> O dispatcher lê o `doiRedirectUrl` do catálogo embutido: o deploy dele é o momento
> em que **novos DOIs passam a usar o link novo**. DOIs já enviados antes continuam
> apontando direto para `{CONFIRM_URL}` (funcionam, só não geram `SIGN_UP`).
>
> O passo 2 usa um `rid` inexistente: o `curl` **gera um `SIGN_UP` anônimo real** na fila
> (sem e-mail). Anotar o horário para filtrar/limpar esse registro depois (ver Limpeza da L6).
>
> **Ordem entre os dois workers é parte do contrato:** o `links-redirect` (passo 1) precisa
> estar em produção, já entendendo `rid`, **antes** de o dispatcher (passo 3) começar a
> gerar links com `?rid=`.

### Critério de aceite

Passos 1–3 com a saída esperada; sem 5xx no `npm run tail:dispatcher` durante 5 min.

### Rollback

```bash
git revert <commit-só-da-troca-de-doiRedirectUrl+doiIdentity> && npx wrangler deploy --config workers/funnel-dispatcher/wrangler.toml
```
Reverter **só** a troca de URL/flag (S2) — **não** os `domains`, `links` e a rota do `wrangler`:
DOIs já enviados com `links.…?rid=` continuam em trânsito e dariam 404 sem a rota.
Reverter o dispatcher primeiro (DOIs novos voltam a apontar direto para a página de
confirmação); o worker `links-redirect` pode ficar — a rota nova é inócua sem DOI
apontando para ela.

---

## Fatia L6 — Validação E2E (obrigatória; "feito" só com evidência)

> Estimativa: 30 min · Usar e-mail de teste com alias, ex.: `conta+{tenant}-e2e@gmail.com`

Requer **navegador real** (o Turnstile do form exige token de browser).

### Passos

1. Abrir `https://{DOMINIO}/`, preencher e-mail + nome, aguardar o Turnstile ("Success"), enviar.
2. UI mostra "Check your inbox". `POST /funnel/precheckout` → **202**.
3. E-mail DOI chega (segundos). **O link do botão aponta para `{LINKS_HOST}/{SLUG}/signup`**
   (conferir o `href` — é a prova de que a troca da L5 pegou).
4. Clicar no link → termina em `{CONFIRM_URL}`.
5. Conferir cada camada:

| Camada | Como verificar | Esperado |
|---|---|---|
| Brevo | `GET /v3/contacts/{email}` | `listIds` contém a lista do tenant; `FIRSTNAME` preenchido |
| Brevo funil | atributos `{PREFIX}_FUNIL_STEPS` | `GENERATE_LEAD` **e** `SIGN_UP` |
| GA4 Realtime | `runRealtimeReport` (janela máx. **29 min**) | `generate_lead` e `sign_up` ≥ 1 |
| Event Store | consulta D1 / dashboard | 1 linha `SIGN_UP` com o `product_code` certo, tenant certo |
| Identidade | `SIGN_UP` no Event Store | `lead.email` = o e-mail do teste (não anônimo) e `lead_id` do `GENERATE_LEAD` |
| Privacidade | URL final no navegador e `dl=` das requisições ao sGTM | **sem** e-mail e **sem** `rid` na URL de `{CONFIRM_URL}` |
| Idempotência | clicar no link de novo | **sem** segundo `SIGN_UP` (mesmo `event_id`) |
| Link expirado | simular `rid` inexistente | 302 normal + `SIGN_UP` anônimo (falha aberta) |
| Mesmo usuário no GA4 (M2, S-d) | `cid` do hit `generate_lead` no navegador × `client_id` do MP do `sign_up` (log do dispatcher) | **iguais** (se a L3C entrou) |
| PII no D1 (MF1) | `payload_json` do `SIGN_UP` de teste | sem `@` |

### Pontos que o E2E ainda precisa responder

- ~~O e-mail chega no `SIGN_UP`?~~ **Respondido (2026-10-09, PE em produção): não.** O
  Brevo não anexa e-mail nem id; a identidade vem do `rid` (L3B). O que o E2E precisa
  confirmar agora é que **o Brevo preserva o `?rid=` no `redirectionUrl`** ao confirmar o
  DOI (o fluxo de promo da DECOLE já depende disso, mas não foi verificado neste tenant).
  Conferir também o `href` do e-mail: é o link de tracking do Brevo, então o `rid` só é
  visível seguindo os redirects (`curl -sIL`, olhando só os nomes dos parâmetros).
- **Nome do evento no GA4:** confirmar se o `emit_tracking` publica `sign_up` (nome
  recomendado do GA4) e registrar o nome real no onboarding do tenant.
- **Cold start do sGTM:** o Cloud Run `server-side-tagging` (`minScale=0`) pode devolver
  503 na primeira chamada. Observado em 2026-10-09 sem perda de evento, mas o
  `emit_tracking` do worker **não** tem o retry do navegador — conferir se um 503
  isolado perde o `SIGN_UP` ou se a fila reprocessa.

### Critério de aceite

Todas as linhas da tabela confirmadas **com saída colada** no registro do onboarding.
Só então marcar a fatia DONE.

### Limpeza

Remover do Brevo o contato de teste (o alias do E2E) e, se aplicável, as linhas
correspondentes do Event Store — incluindo o `SIGN_UP` anônimo gerado pelo `curl` da L5
(filtrar pelo horário anotado). Os registros `{tenant}:checkout_recovery:{rid}` do DOI expiram pelo TTL (14 dias).

---

## Fatia L7 — Fechamento

- [ ] Registro append-only atualizado em `plans/onboardings/{tenant}-{data}.md` (fatias L0–L6, gotchas reais)
- [ ] `RUNBOOK-ONBOARDING-TENANT.md`: apontar para este runbook como passo opcional pós-Fatia 8 ("construção de lista")
- [ ] `ARQUITETURA-COMPONENTES-ONBOARDING.md`: registrar o requisito de `links.{dominio}` em `domains`
- [ ] Commit com escopo (`git status` antes — o repo tem arquivos não relacionados soltos)

---

## Gotchas conhecidos

| # | Gotcha | Consequência |
|---|---|---|
| 1 | `links.{dominio}` fora de `tenants.*.domains` | o `links-redirect` responde **404** (`tenant_not_configured`); o dispatcher resolve o tenant pelo `product_code`, não pelo host |
| 2 | `doiRedirectUrl` em produção antes do deploy do `links-redirect` | todo DOI novo leva a link quebrado |
| 3 | `GA4_API_SECRET` ausente | `SIGN_UP` vai ao Brevo/Event Store mas não ao GA4 (falha silenciosa no tracking) |
| 4 | Catálogo é embutido no bundle | mudar o JSON não surte efeito sem redeploy do worker |
| 5 | Atributos Brevo só entram após o DOI | e-mail DOI sem nome é esperado |
| 6 | GA4 Realtime Standard aceita no máximo 29 min | `startMinutesAgo` maior dá `INVALID_ARGUMENT` |
| 7 | Template DOI sem tag `optin` | envio falha silenciosamente (já tratado no runbook de tenant) |
| 8 | Zona sem registro proxied para `links` | Worker nunca recebe a requisição |
| 9 | Brevo não anexa e-mail/id ao redirect pós-DOI (verificado) | sem `rid`, `SIGN_UP` é anônimo; identidade exige L3B |
| 10 | Reusar `withCheckoutRecoveryParams` no DOI | e-mail vai para a URL pública → vira `page_location` no GA4 (PII). Identidade só no evento |
| 11 | `rid` com TTL curto e lead que confirma depois | `SIGN_UP` anônimo (aceito; falha aberta). Medir a taxa de `sign_up_identity_miss` |
| 12 | `doiIdentity` ligado antes do `links-redirect` novo estar em produção | links com `?rid=` caem num worker que ainda não resolve → `SIGN_UP` anônimo |
| 13 | KV é compartilhado entre tenants | `rid` resolve só com a chave `{tenant}:checkout_recovery:{rid}` — `rid` de outro tenant não resolve |

## Aplicação: product-engineer

Estado de partida (verificado em 2026-10-09 com E2E em produção):
`GENERATE_LEAD` → DOI → lista 3 → `/field-notes/confirmed/` funcionando; `sign_up` **não
existe** (o `doiRedirectUrl` vai direto para a página). Diferenças a tratar:

| Item | Estado atual do PE | Ação |
|---|---|---|
| `tenants.product-engineer.domains` | `api.`, apex | adicionar `links.theproductengineer.net` (L3.1) |
| `tenants.product-engineer.links` | ausente | criar bloco com a rota `/product-engineer/signup` (L3.2) |
| Evento `SIGN_UP` | ausente | copiar do ESG (L3.3) |
| `doiRedirectUrl` | `/field-notes/confirmed/` direto | trocar por `links.…/product-engineer/signup` + `doiIdentity: true` (L3.3, deploy na L5) |
| Identidade do `SIGN_UP` | inexistente (Brevo não anexa e-mail/id — verificado no E2E de 2026-10-09) | implementar o `rid` em código de plataforma (L3B); DECOLE não muda (sem a flag) |
| `links-redirect/wrangler.toml` | só zona da DECOLE | adicionar rota da zona `theproductengineer.net` (L3.4) |
| DNS `links.theproductengineer.net` | ausente | L2 |
| `GA4_API_SECRET_PRODUCT_ENGINEER` | binding existe, **valor pendente** | L4 (era a pendência aberta do onboarding) |
| Eventos de engajamento (`SECTION_VIEW` etc.) | ausentes | fora de escopo; decisão separada |
| `cta_click` | no catálogo, sem `dataLayer.push` encontrado no site | verificar à parte, não bloqueia este runbook |
