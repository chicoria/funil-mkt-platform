# Slice 1K — Propagar event_id do navegador até o worker (dedup Meta CAPI)

> Satélite: engagement · Outward-facing (site decolesuacarreiraesg + GTM Web + Meta CAPI)
> Estimativa: já executado (investigação + fix em sessão única)

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-07-16 por Claude Sonnet 5 |
| Completed | 2026-07-16 por Claude Sonnet 5 |
| Commit final | `696fd5c`/`9cf6d07` (api-funnel-ingress), `835ad54` (links-redirect, fix não relacionado), `26e421c` (site, test_event_code) |
| PR | — (push direto em `main`, deploy via `deploy-all-workers.yml` runs `29507238316`/`29510796246`) |

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
