# Slice 1K — Propagar event_id do navegador até o worker (dedup Meta CAPI)

> Satélite: engagement · Outward-facing (site decolesuacarreiraesg + GTM Web + Meta CAPI)
> Estimativa: já executado (investigação + fix em sessão única)

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-07-16 por Claude Sonnet 5 |
| Completed | 2026-07-16 por Claude Sonnet 5 |
| Commit final | `696fd5c`/`9cf6d07` (api-funnel-ingress), `835ad54` (links-redirect, fix não relacionado), `26e421c` (site, test_event_code), `c27b5c1`/`249e56d` (api-funnel-ingress autofill Hotmart + teste D1 desatualizado) |
| PR | — (push direto em `main`, deploy via `deploy-all-workers.yml` runs `29507238316`/`29510796246`/`29571164074`) |

## Contexto

Disparado pelo usuário ao ver, no Events Manager da Meta ("Analisar as chaves
de deduplicação"), o dataset `1329973348435032` ("DECOLE sua carreira ESG")
com `Eventos do navegador=1` / `Eventos do servidor=0` (com aviso) em quase
todo `event_id` listado.

Confirmado via API do Meta (`ads_get_dataset_stats`, filtro `event_source`
WEB_ONLY/SERVER_ONLY) que o volume "só navegador" + "só servidor" batia
quase exatamente com o total — match real ≈ zero, não era cosmético.

**Causa raiz:** navegador e worker geravam `event_id` de forma
independente para o mesmo evento de negócio (`begin_checkout` /
`InitiateCheckout`):
- Navegador: variável GTM Web `Get_Event_ID` — `gtm.start + '.' +
  gtm.uniqueEventId`, específico do carregamento de página.
- Worker: `emitTracking()` (`funnel-dispatcher/src/handlers/index.ts:2014`)
  já usava `event.event_id` corretamente, mas esse ID (pra `BEGIN_CHECKOUT`)
  era gerado em `links-redirect/src/index.ts:322` via
  `crypto.randomUUID()` sempre que a URL não trazia `event_id`/`eventId` —
  o que nunca acontecia, porque nada propagava esse parâmetro até ali.

Achado chave: `links-redirect` **já sabia** honrar `event_id`/`eventId` da
URL — o mecanismo de propagação existia pela metade; faltava o navegador
gerar o ID e o `api-funnel-ingress` não descartá-lo no caminho.

## Mudança

### Arquivos modificados

| Arquivo | Repo | Mudança |
|---|---|---|
| `site/index.html`, `site/planodevoo/index.html` | `decole/decolesuacarreiraesg` | `generateCheckoutEventId()` + `pushBeginCheckoutEvent()` no submit do pré-checkout; `event_id` incluído no `FormData` (e no `buildRedirectUrl()` fallback do Plano de Voo) |
| `workers/api-funnel-ingress/src/index.ts` | `funil-mkt-platform` | `event_id` adicionado a `CHECKOUT_FORWARD_PARAMS` |
| `workers/api-funnel-ingress/test/unit/precheckout-redirect.test.ts` | `funil-mkt-platform` | novo teste cobrindo a propagação de `event_id` no `redirect_url` |
| `workers/links-redirect/src/index.ts` | `funil-mkt-platform` | **nenhuma mudança** — já lia `event_id`/`eventId` da URL |
| `workers/funnel-dispatcher/src/handlers/index.ts` (`emitTracking`) | `funil-mkt-platform` | **nenhuma mudança** — já usava `event.event_id` |
| GTM Web `GTM-58CQ9K7X` (variável `Get_Event_ID`, id `36`, pixel ESG `1329973348435032`) + nova variável `DL - event_id` (id `86`) | container Google Tag Manager | passa a preferir o `event_id` do dataLayer quando presente, com fallback pro `gtm.uniqueEventId` atual — publicado como versão 21 |
| GTM Web `GTM-58CQ9K7X` (variável `Get_Event_ID`, id `65`, pixel Plano de Voo `2220600768748665`) | container Google Tag Manager | **descoberto depois da 1ª publicação**: cada pixel tem sua própria variável `Get_Event_ID` gerada isoladamente pelo assistente da Meta — a var `65` tinha o mesmo bug e não foi tocada na 1ª rodada. Corrigida igual à `36` (reaproveitando `DL - event_id`), publicado como versão 22 |
| `workers/api-funnel-ingress/src/index.ts`, `workers/links-redirect/src/index.ts` | `funil-mkt-platform` | `test_event_code`/`meta_test_event_code` propagado (allowlist + payload do `BEGIN_CHECKOUT`) pra permitir checkout de teste sem poluir relatórios reais (Meta Test Events) |
| `workers/links-redirect/test/index.test.ts` | `funil-mkt-platform` | fix não relacionado: teste do WhatsApp `elizete-wp` esperava número antigo (pré-existente, bloqueava o pipeline de deploy); + novo teste cobrindo `test_event_code` no payload |
| `workers/api-funnel-ingress/src/index.ts` (`buildCheckoutRedirect`) | `funil-mkt-platform` | **bug separado, achado em 2026-07-17**: lia `payload.email`/`name`/`phoneac`/`phonenumber` (minúsculo), mas o form real (`EMAIL`/`FIRSTNAME`/`LASTNAME`/`SMS__COUNTRY_CODE`/`SMS`) nunca batia — nenhum desses campos chegava na URL de checkout do Hotmart (sem autofill). Corrigido com `resolveCheckoutForwardValue()` mapeando os nomes reais |
| `workers/funnel-dispatcher/test/unit/d1-migration.node.test.mts` | `funil-mkt-platform` | teste desatualizado (pré `3bb7afd`, regra de identidade mudou em 2026-05-19) bloqueava `deploy-all-workers.yml`; ajustado pra refletir a regra atual (email determinístico > anonymous_id) |
| GTM Server `GTM-K6Q4H6BR` (tag `Meta CAPI - Dynamic by Tenant/Product`, id `10`, workspace 23 → versão 23) | container Google Tag Manager | **causa raiz do "Servidor" nunca aparecer em Test Events**: parâmetro `testEventCode` estava fixo em `{{LT - Meta Test Event Code by Tenant/Product}}` (lookup table hardcoded: `TEST44710` Plano de Voo / `TEST19244` ESG), nunca no valor dinâmico do evento — todo tráfego real (não só teste) era marcado com esse código fixo. Corrigido pra `{{ED - test_event_code}}` (variável já existia, não era usada nesse parâmetro) |

### O que NÃO mudou

- `PURCHASE_APPROVED` — vem do webhook do Hotmart, sem disparo de Pixel
  duplicado no domínio próprio; fora do escopo (não investigado a fundo,
  não presumir que está livre do mesmo problema sem checar).

## Testes

- `npx vitest run` em `api-funnel-ingress` (25/25) e `links-redirect`
  (41/41) — verde antes do deploy.
- Sintaxe dos `<script>` do site validada via `new Function()` por bloco
  (sem build step no repo do site).
- GTM Web: `quick_preview` sem `compilerError` antes de criar/publicar
  a versão.

## Validação executável

```bash
# workers
cd funil-mkt-platform/workers/api-funnel-ingress && npx vitest run
cd funil-mkt-platform/workers/links-redirect && npx vitest run
```

Verificação end-to-end pendente (não executada nesta sessão):
1. Preencher o pré-checkout em produção com `?test_event_code=<código do
   Test Events>` (mecanismo já implementado e deployado — ver acima) e
   conferir no Meta Test Events que o mesmo `event_id` aparece nas linhas
   Navegador + Servidor, **pros dois produtos** (ESG e Plano de Voo).
2. Em 24-48h, reconsultar `ads_get_dataset_stats` (event_source
   WEB_ONLY/SERVER_ONLY) pros datasets `1329973348435032` **e**
   `2220600768748665` e confirmar queda real no volume não-deduplicado
   nos dois.

**Ainda pendente após a sessão de 2026-07-17** (ver detalhes na seção de
Execução abaixo): confirmar que a linha de **Servidor** passa a aparecer
em Test Events pro Plano de Voo com `test_event_code=TEST78251` depois do
fix da tag `Meta CAPI - Dynamic by Tenant/Product` (versão 23). Não foi
possível confirmar ao vivo nesta sessão porque o Preview do GTM Server
não rastreia chamadas servidor-a-servidor (ver Gotchas). Reconsultar
`ads_get_dataset_stats`/checar a tela de Test Events numa sessão futura.

## Rollback

- Site: `git revert` dos commits `5af7f9b`/`26e421c` em `decolesuacarreiraesg`.
- Workers: `git revert` de `696fd5c`/`9cf6d07` (e `835ad54` se necessário)
  em `funil-mkt-platform`, re-rodar `deploy-all-workers.yml`.
- GTM Web: publicar a versão 21 (reverte só o pixel Plano de Voo) ou 20
  (reverte os dois pixels) via Tag Manager API ou UI.

## Revisão G.12 — pendente

> Esta slice foi implementada em sessão única (investigação → plano →
> execução → deploy) com aprovação do usuário via Claude Code plan mode,
> **não** passou pelo fluxo formal de 2 revisores (Planning Reviewer +
> Code Quality Reviewer) descrito em `review-agents.md`. Registrar aqui se
> uma revisão formal for feita depois.

## Execução (append-only)

### 2026-07-16 por Claude Sonnet 5

- Diagnóstico completo via Meta MCP (`ads_get_dataset_stats`,
  `ads_get_dataset_quality`) + inspeção do GTM Web/Server via Tag Manager
  API (mesmo padrão de acesso do fix de `enableEventEnhancement` do mesmo
  dia, ver `T5-monitoramento-performance.md` no knowledge-core).
- Implementação: site (2 arquivos) → `api-funnel-ingress` (allowlist +
  teste) → GTM Web (nova variável + `Get_Event_ID` atualizada, publicado
  versão 21) → commit + push + deploy via `deploy-all-workers.yml`.
- Durante o deploy, `links-redirect` falhou por um teste pré-existente
  (número de WhatsApp desatualizado, não relacionado) — corrigido após
  confirmação explícita do usuário (não presumido).

### 2026-07-16/17 por Claude Sonnet 5 (continuação — generalizar pra qualquer pixel/tenant)

- Usuário pediu checkout de teste sem poluir relatórios reais →
  implementado `test_event_code`/`meta_test_event_code` propagado do
  navegador (reaproveitando o mecanismo de captura de UTMs em
  `precheckout.ts`) até `emitTracking` (que já lia esse campo, mas nada
  populava).
- Usuário pediu análise de multi-tenant/multi-produto no **GTM Server**:
  confirmado que o lado servidor (lookup tables `Tenant ID by Host`,
  `Meta Pixel ID by Tenant/Product`, `Meta CAPI Token by Tenant`) já é
  genuinamente multi-tenant/produto — nenhuma mudança necessária ali.
- Auditoria revelou que o GTM **Web** tem um segundo pixel
  (`2220600768748665`, Plano de Voo) com sua própria variável
  `Get_Event_ID` (id `65`), que **não tinha sido corrigida** na 1ª rodada
  (só a `36`/ESG foi). Corrigida e publicada (versão 22) após confirmação
  explícita do usuário.
- Confirmado (via listagem de variáveis `FB_CONVERSIONS_API-*-Web-*`) que
  não há mais nenhum outro pixel neste mesmo container.

### 2026-07-17 por Claude Sonnet 5 (verificação end-to-end pendente — dois bugs novos achados e corrigidos)

- Usuário pediu pra conduzir o teste end-to-end pendente (item 1 acima).
  Ao inspecionar a URL de redirect real pro Hotmart, faltavam
  `email`/`name`/`phoneac`/`phonenumber` — achado o bug de
  `buildCheckoutRedirect` (nomes de campo divergentes, ver tabela acima).
  Corrigido com TDD (teste novo reproduzindo o bug com os nomes reais do
  form → red → fix → green), commit `c27b5c1`.
- Ao tentar deployar, `npx vitest run` na raiz revelou falha pré-existente
  e não-relacionada em `d1-migration.node.test.mts` (bloqueava
  `deploy-all-workers.yml`). Investigado: encontrada em `git log` que a
  regra de identidade mudou intencionalmente em `3bb7afd` (2026-05-19,
  email determinístico > anonymous_id) e esse teste específico nunca foi
  atualizado. Corrigidas as asserções pra refletir a regra atual, commit
  `249e56d`.
- Deploy disparado via `gh workflow run deploy-all-workers.yml` **sem**
  `-f dry_run=false` rodou em modo dry-run (default do workflow) — nada
  foi publicado. Percebido só depois de testar o endpoint de produção via
  `curl` direto e ver que nada tinha mudado. Redisparado com
  `dry_run=false`, aí sim publicou de verdade.
- Verificação via `curl` direto no `/funnel/precheckout` e seguindo o
  redirect até `pay.hotmart.com` confirmou o fix funcionando
  (`email`/`name`/`phoneac`/`phonenumber` corretos na URL final).
  Confirmado depois também via browser real (screenshot do checkout do
  Hotmart com email/nome preenchidos).
- Usuário reportou que a tela "Eventos de teste" (Plano de Voo, Meta
  Events Manager) nunca mostrava linha de **Servidor**, só Navegador —
  mesmo com `test_event_code` correto na URL. Investigado via GTM API
  (credenciais em `~/.env.local` → `GOOGLE_APPLICATION_CREDENTIALS`,
  script ad-hoc de OAuth2 JWT + REST direto, sem `gcloud`/`googleapis`
  instalados): achada a tag `Meta CAPI - Dynamic by Tenant/Product` com
  `testEventCode` fixo numa lookup table (`TEST44710` pro Plano de Voo),
  nunca lendo o valor dinâmico do evento. Corrigido pra
  `{{ED - test_event_code}}`.
- **Quase-incidente durante o fix:** o workspace do GTM Server usado pra
  editar a tag estava desatualizado em relação à versão publicada — um
  `workspaces.sync` revelou `mergeConflict: true` com duas diferenças
  reais: `enableEventEnhancement` (live=`true`, workspace=`false`) e um
  `blockingTriggerId: ["27"]` ("Meta Blocker — section_view/vsl_section_*")
  que existia na produção mas não no workspace. Publicar direto teria
  revertido essas duas coisas. Corrigido reaplicando a tag com o estado
  completo (fix + `enableEventEnhancement: true` + `blockingTriggerId`
  restaurados) antes de sincronizar/criar versão/publicar.
- `ads_get_dataset_stats` (`SERVER_ONLY`) confirmou `InitiateCheckout`
  chegando via servidor mesmo **antes** do fix — ou seja, a tag sempre
  funcionou, só nunca foi marcada como teste corretamente.
- Tentativa de confirmar ao vivo via GTM Server Preview: usuário conseguiu
  abrir Preview e capturou um evento `cta_click` disparando as duas tags
  (Meta CAPI + GA4) sem bloqueio — mas esse payload não tinha
  `test_event_code` nenhum (só embutido dentro de `event_source_url`),
  porque eventos genéricos do GTM Web (`cta_click`, `section_view` etc.)
  nunca propagam esse parâmetro — só o fluxo do worker propaga. Não foi
  possível ver o evento `begin_checkout` real no Preview porque ele é
  gerado servidor-a-servidor (`funnel-dispatcher` → `/mp/collect`), e o
  Preview do GTM Server só rastreia requisições que carregam o header
  `X-Gtm-Server-Preview` gerado pelo `gtm.js` no navegador — uma chamada
  direta do Worker nunca carrega esse header. **Verificação ao vivo
  ficou estruturalmente bloqueada**; ver item pendente na seção de
  Validação executável.

## Gotchas / lições aprendidas

- O container GTM Server (`GTM-K6Q4H6BR`, conta `6266094107`, container
  `241313282`) e o GTM Web (`GTM-58CQ9K7X`, mesma conta, container
  `231314463`) são containers **diferentes** na mesma conta — fácil
  confundir IDs ao trocar de um pra outro via API.
- `quick_preview` da Tag Manager API exige o escopo
  `tagmanager.edit.containerversions` além de `tagmanager.edit.containers`
  — sem ele, falha com "insufficient authentication scopes" mesmo com
  permissão real configurada no painel.
- `deploy-all-workers.yml` é `workflow_dispatch` manual (não dispara em
  push) e roda teste+deploy de **todos** os workers em sequência — uma
  falha de teste em qualquer worker (mesmo não relacionado à mudança)
  bloqueia o deploy inteiro; não existe workflow individual por worker
  além de `funnel-dispatcher` e `api-hotmart-ingress`.
- **Checklist obrigatório pra qualquer pixel Meta novo (deste ou de outro
  tenant):** o assistente oficial da Meta gera, por pixel, seu próprio
  conjunto isolado de tags/variáveis `FB_CONVERSIONS_API-<pixelId>-Web-*`
  — não existe uma variável `Get_Event_ID` compartilhada entre pixels.
  Ao adicionar um pixel novo em qualquer GTM Web: (1) achar a variável
  `Get_Event_ID` gerada pro pixel novo; (2) editar pra preferir
  `{{DL - event_id}}` (criar essa DLV se o container ainda não tiver);
  (3) `quick_preview` antes de publicar. Pular esse passo reproduz
  exatamente o bug desta slice.
- Workspaces do GTM **somem/trocam de ID após cada publish** (ex.: `24`→
  `27` neste container) — sempre confirmar o ID do workspace atual via
  `workspaces.list` antes de editar, não reusar um ID de uma sessão
  anterior.
- **`buildCheckoutRedirect` só repassa campos cujo nome bate exatamente**
  com `CHECKOUT_FORWARD_PARAMS` (`email`/`name`/`phoneac`/`phonenumber`).
  O form HTML usa `EMAIL`/`FIRSTNAME`/`LASTNAME`/`SMS__COUNTRY_CODE`/`SMS`
  — não presumir que "o form já manda tudo via `FormData`" garante que o
  worker sabe ler; sempre checar o mapeamento explícito.
- `deploy-all-workers.yml` tem `dry_run` com **default `"true"`** — rodar
  `gh workflow run` sem `-f dry_run=false` não publica nada, mas o run
  aparece verde ("success") do mesmo jeito. Sempre conferir o nome do job
  nos logs (`Deploy workers (dry-run)` vs `(produção)`) ou testar o
  endpoint de produção diretamente antes de assumir que o deploy surtiu
  efeito.
- Não há `googleapis`/`jsonwebtoken`/`gcloud` instalados neste ambiente
  pra falar com APIs do Google. Funciona escrever um script Node ad-hoc
  usando só `node:crypto`/`node:fs`/`fetch` pra fazer o fluxo OAuth2 JWT
  Bearer de service account (ver script usado nesta sessão) — tanto pra
  Tag Manager API (`tagmanager.readonly`/`edit.containers`/
  `edit.containerversions`/`publish`) quanto pra Cloud Logging API
  (`logging.read`, projeto `gtm-k6q4h6br-ndq3n`, serviço Cloud Run
  `server-side-tagging`).
- **GTM API: workspace desatualizado não avisa sozinho.** Um `GET` na tag
  não informa se o workspace está fora de sincronia com a versão
  publicada — só um `workspaces.sync` revela `mergeConflict`. Antes de
  fazer `PUT` numa tag/trigger em qualquer container que outra sessão
  possa ter publicado depois, rodar `sync` primeiro (ou pelo menos depois
  do `PUT`, antes do `create_version`) pra não sobrescrever campos que
  mudaram na produção sem seu conhecimento.
- `quick_preview` via API retorna HTML de erro (não JSON) quando falha —
  não confiável pra scripts ad-hoc; é pensado pra sessão interativa no
  navegador. Pra validação sem UI, criar a versão e conferir os `tag[]`
  retornados no corpo da resposta de `create_version` antes de publicar.
- **Cloud Run do sGTM não loga por padrão a chamada HTTP de saída pra
  Meta CAPI** — só avisos genéricos de infra (beacon de uso, versão
  desatualizada). Não dá pra confirmar o payload exato enviado à Meta via
  `gcloud logging`/Cloud Logging API; só via GTM Preview (e só pra
  requisições client-side) ou instrumentação manual temporária.
- **GTM Server Preview não vê chamadas servidor-a-servidor.** A
  correlação de requisições no Preview usa o header `X-Gtm-Server-Preview`
  injetado pelo `gtm.js` no navegador — uma chamada feita direto por um
  Worker/backend (sem navegador no meio) nunca carrega esse header e
  nunca aparece no painel de Preview, mesmo enviando pro mesmo endpoint.
  Reproduzir isso via `curl` exigiria capturar esse header (não um cookie
  comum) de uma requisição real do navegador em Preview — não tentado
  nesta sessão por custo.
