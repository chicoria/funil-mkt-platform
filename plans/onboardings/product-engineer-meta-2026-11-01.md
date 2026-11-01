# Product Engineer — Meta Pixel + CAPI (2026-11-01)

Tenant `product-engineer`, site theproductengineer.net. Segue a Frente 3c do
[runbook](../RUNBOOK-ONBOARDING-TENANT.md). O onboarding de 2026-10-08 ficou
"sem Meta nesta fase"; esta é essa fase.

## Decisões do titular

- Business próprio: "Adilson Chicoria - Business" (`1147709561172015`), não o
  da DECOLE.
- **Sem banner de consentimento**: o titular decidiu instalar o Pixel sem
  banner e assume o risco RGPD para visitantes da UE.
- Mesmo padrão da DECOLE/Plano de Voo; nada de Pixel no código do site. Uma
  primeira instalação em `assets/analytics.js` (commit `f6282a0` no repo do
  site) foi revertida antes de publicar (`4f5c3d7`).

## M1 — Ativos Meta — DONE (2026-11-01)

Passos, casos de uso e permissões: [RUNBOOK-META-BUSINESS-NOVO.md](../RUNBOOK-META-BUSINESS-NOVO.md).

| Ativo | ID | Como |
|---|---|---|
| Business | `1147709561172015` | titular |
| App "PE Agents API" (Business; Marketing API, Instagram, Páginas) | `1652135719775313` | Claude pelo Chrome; senha pelo titular |
| System user `agent-api-pe` (Admin) | `61596252744678` (app-scoped `122095196313541758`) | Claude pelo Chrome |
| Ativos do system user | Página The Product Engineer, app, Instagram @adilsonchicoria (`17841400141127553`) | Claude + titular |
| Token sem expiração, 24 permissões | `META_SYSTEM_USER_ACCESS_TOKEN_PRODUCT_ENGINEER` em `~/.env.local` | gravado do clipboard; GET `me` confirma |
| Dataset/Pixel "The Product Engineer (theproductengineer.net)" | `3208451502837323` | interface; `POST /{business}/adspixels` deu #10 |

Fecho de M1 (2026-11-01):
- `agent-api-pe` atribuído ao Pixel pela interface (separador Pessoas, acesso
  total); GET `assigned_users` confirma `ADVERTISE, UPLOAD, ANALYZE, EDIT`.
- Test event code `TEST43942` (`META_TEST_EVENT_CODE_PRODUCT_ENGINEER`).
- CAPI de teste com o token do `agent-api-pe`: `events_received: 1`. Esse token
  serve de token CAPI; não foi gerado outro.
- `~/.env.local`: `META_BUSINESS_ID_`, `META_APP_ID_`, `META_SYSTEM_USER_ACCESS_TOKEN_`,
  `META_PIXEL_ID_`, `META_TEST_EVENT_CODE_PRODUCT_ENGINEER`.

## M2 — GTM Web `GTM-TK6V8G33` (`266435700`) — NOT_STARTED

Live v4 tem só GA4 Configuration + GA4 Event - All Custom Events. Replicar do
live v23 da DECOLE as 5 tags, 2 triggers e 8 variáveis
`FB_CONVERSIONS_API-1329973348435032-Web-*` com o pixel `3208451502837323`.
Mapa `FBEventName`: `generate_lead` → `Lead` (já no mapa do template); `bio_link_click`
não tem nome padrão Meta e sai com o próprio nome (`bio_link_click`), igual no browser e
no servidor, porque os dois usam `FBEventName`. Publicar só com diff revisto; exportar para `trafego/gtm/`.

## M3 — sGTM `241313282` — NOT_STARTED

Live v25. `LT - Tenant ID by Host` já tem `theproductengineer.net → product-engineer`.
Acrescentar:
- `LT - Meta Pixel ID by Tenant/Product`: `product-engineer|PRODUCT_ENGINEER_NEWSLETTER` → `3208451502837323`
- `LT - Meta CAPI Token by Tenant`: `product-engineer` → `META_SYSTEM_USER_ACCESS_TOKEN_PRODUCT_ENGINEER`
- `LT - Meta Test Event Code by Tenant/Product`: `product-engineer|PRODUCT_ENGINEER_NEWSLETTER` → `TEST43942`

Container partilhado com DECOLE e Entrepontos: Planning Review antes de publicar.

## M4 — Catálogo e smoke — NOT_STARTED

`tenants.product-engineer` no catálogo (`metaPixel`, `metaCapi`), `updatedAt`.
Smoke: Pixel Helper (PageView), Testar eventos (Lead com test code),
deduplicação browser/servidor pelo `event_id`.

## Execução M2–M4 (2026-11-01)

Verificação prévia: o GA4 Configuration do PE já tem
`transport_url = https://sgtm.theproductengineer.net`. A `LT - Tenant ID by
Host` só tinha `theproductengineer.net`, mas o pedido chega com host
`sgtm.theproductengineer.net` (DECOLE e Entrepontos usam `sgtm.…`). O GA4
chega na mesma (a tag GA4 do sGTM usa o measurement ID do pedido), mas a tag
Meta CAPI precisa do tenant: acrescentada a linha `sgtm.theproductengineer.net`.

**M2 — workspace `meta-pixel-2026-11-01` (GTM Web 266435700), por publicar.**
Copiado do live v23 da DECOLE, pixel trocado, com adaptações:
- não copiada a `GA4_Config` do template (o PE já tem a sua com `transport_url`);
- pausada (não apagada) `GA4 Event - All Custom Events`: a `GA4_Event` do
  template substitui-a e manda `event_id`, `user_data`, `produto`;
- `Custom_Event` exclui `^gtm\.` (o PageView vem do `DOM_Ready`);
- `DOM_Ready` só em `^(www\.)?theproductengineer\.net$`;
- `DL - produto` com default `PRODUCT_ENGINEER_NEWSLETTER` (sem ele o PageView
  não acha pixel no sGTM); `DL - event_id`; built-in Container ID.
Diff: 4 tags, 2 triggers, 10 variáveis, 1 built-in, 1 tag pausada; 0 conflitos.

**M3 — workspace `meta-product-engineer-2026-11-01` (sGTM 241313282), por publicar.**
Só linhas acrescentadas: Tenant by Host `sgtm.theproductengineer.net`;
Pixel, Token e Test code para `product-engineer|PRODUCT_ENGINEER_NEWSLETTER`.
Diff: 4 variáveis atualizadas; 0 conflitos.

**Publicação (2026-11-01, autorizada pelo titular):** sGTM live **v26**, GTM
Web live **v5**, ambos confirmados por `versions:live` logo após o publish.
Exports: `trafego/gtm/product-engineer-web-v5.json` e
`trafego/gtm/sgtm-v26-sanitized.json` (tokens das LTs como `<redacted>`;
verificado que nenhum token real do `.env.local` aparece; os `EAA…` restantes
são imagens base64 dos templates).

**Smoke (2026-11-01, site ao vivo, /bio):**
- Browser: `facebook.com/tr?id=3208451502837323&ev=PageView` e
  `ev=bio_link_click`, ambos com `eid`. Stats do pixel: `BROWSER` 2.
- sGTM: pedidos `sgtm.theproductengineer.net` com `gtm.dom`/`page_view` e
  `produto=PRODUCT_ENGINEER_NEWSLETTER`.
- Servidor (CAPI via sGTM): **não confirmado**. Polling de 40 min às stats
  (`aggregation=event_source`) só mostrou o balde das 08:00 com `BROWSER` 2;
  nem os eventos de browser do smoke das ~09:30 tinham entrado, logo o atraso
  das stats não permite concluir. Confirmar no Events Manager (Visão geral,
  coluna Servidor) mais tarde, ou com um evento de teste com `test_event_code`.
- Inscrição de teste (2026-11-01 11:46 UTC, autorizada pelo titular; email
  `chicoria+pe-smoke-20261101@gmail.com`, nome "Smoke", em /bio):
  - dataLayer `generate_lead` com `event_id` `7f117a4b-…`, `placement=bio`,
    `produto=PRODUCT_ENGINEER_NEWSLETTER`;
  - browser → Meta: `ev=Lead`, `eid=7e098146-…_7f117a4b-…` (prefixo do
    template + `event_id` do lead; é o mesmo `event_id` que a `GA4_Event` manda
    ao sGTM, logo deduplicável);
  - D1 `funnel_events`: `GENERATE_LEAD` product-engineer às 11:46:50 (worker
    OK; o `event_id` da D1 é gerado pelo worker e não entra na Meta, porque
    `GENERATE_LEAD` não tem `emit_tracking`);
  - Logs do sGTM (Cloud Run, projeto `gtm-k6q4h6br-ndq3n`, só leitura): às
    11:46:51 `GET /g/collect` em `sgtm.theproductengineer.net`, 200, com
    `en=generate_lead`, `ep.event_name=Lead`, `ep.produto=PRODUCT_ENGINEER_NEWSLETTER`
    e `evnid=7e098146-…_7f117a4b-…`, **igual ao `eid` do Lead do browser** →
    deduplicação garantida do lado dos dados. (O GA4 manda o `event_id` em
    `evnid`, não em `ep.event_id`; os hits da DECOLE têm a mesma forma.)
  - A chamada de saída do sGTM para a Meta **não aparece nos logs**: o Cloud Run
    só regista pedidos de entrada e a tag Meta CAPI não tem log de consola em
    produção. Confirmar pelo Events Manager (coluna Servidor) ou pelo modo de
    pré-visualização do sGTM.
  - Desde a publicação (09:30 UTC) só houve hits de `sgtm.theproductengineer.net`
    (19, todos 200); nenhum da DECOLE, por falta de tráfego: regressão ainda não
    observável, sem erros.
  - Pendente: abrir o email DOI no alias e confirmar → `SIGN_UP` pelo worker
    (`emit_tracking`) → sGTM → CAPI.
  - Limpeza depois do teste: `scripts/cleanup-test-data.sh` / `remove-contact.sh`
    (Brevo + D1), com confirmação do titular.
- Ruído a rever (SHOULD-FIX): o `Custom_Event` também envia à Meta os eventos
  automáticos do GA4 (`scroll`, `form_start`, `form_submit`), como na DECOLE.
  Avaliar limitar o trigger aos eventos de negócio (`generate_lead`,
  `bio_link_click`, …).
- Regressão DECOLE: stats dos pixels DECOLE vazias nas últimas 6 h (sem
  tráfego); **não confirmável** agora. O diff do sGTM só acrescentou linhas
  (confirmado pelo Codex contra o v25).

**Checagem Codex (read-only, 2026-11-01): REPROVADO**, com MUST-FIX
(nome `BioLinkClick` no plano vs. `bio_link_click` publicado → plano
alinhado ao publicado; evidência de smoke → registada acima) e SHOULD-FIX
(passagem do test code; caminho do `metaPixel` no runbook 3c.4 → corrigidos
no runbook). Nova checagem Codex depois de SERVER, Lead dedup e DECOLE.

**M4 — catálogo:** `tenants.product-engineer.tracking.metaCapi` e
`products.PRODUCT_ENGINEER_NEWSLETTER.tracking.metaPixel`, `updatedAt`
2026-11-01. Vitest: 583 passam; 1 ficheiro falha por motivo alheio
(`tests/setup-brevo-domain.test.mjs` sem suite vitest).

**Contra-checagem Codex de todos os tenants (2026-11-01): REPROVADO**, sem
falhas causadas por este onboarding:
- IDs, hosts, pixels e measurement IDs de decole, product-engineer e
  entrepontos: OK; nenhuma linha visível de outro tenant alterada v25→v26.
- MUST-FIX "env vars ausentes no .env.local" (20 nomes, quase todos de
  Workers/DECOLE): critério do runbook estava errado (secrets dos Workers vivem
  no Secrets Store); runbook corrigido. Não é regressão.
- MUST-FIX "export Web DECOLE ausente": guardado `trafego/gtm/decole-web-v23.json`
  (live lido hoje, sem segredos).
- MUST-FIX "preservação dos tokens CAPI não verificável": provado por hash
  SHA-256 v25→v26: `decole` IGUAL, `superare-test` IGUAL, `product-engineer` NOVO.
- SHOULD-FIX (pré-existentes, DECOLE): `workerViews` refere
  `META_PIXEL_ID_DECOLE_PLANOVOO` e o produto usa `META_PIXEL_ID_PLANOVOO`;
  `BREVO_BASE_URL`/`BREVO_TIMEOUT_MS`/`BREVO_SANDBOX` sem fonte documentada.
  Ficam no backlog da plataforma, fora deste onboarding.

## Filtro de ruído (2026-11-01)

Stats mostraram `gtm.js`, `bio_link_click`, `scroll`/`form_*` no pixel. Preparado
(workspaces `meta-noise-2026-11-01` no Web e `meta-noise-pe-2026-11-01` no sGTM,
0 conflitos):
- Web: trigger `…-Web-Trigger-Business_Events` (`^(generate_lead|bio_link_click|cta_click)$`)
  só na `Pixel_Event`.
- sGTM: `Meta Blocker — product-engineer fora da allowlist` (tenant =
  product-engineer e evento fora de `^(gtm\.dom|generate_lead|sign_up|bio_link_click|cta_click)$`)
  acrescentado aos bloqueadores da tag CAPI (mantém o `27`).
- Publicado (sem auto mode, autorizado pelo titular): sGTM **v27** (tag CAPI
  com bloqueadores `27` e `29`), GTM Web **v6**. Exports:
  `trafego/gtm/sgtm-v27-sanitized.json`, `trafego/gtm/product-engineer-web-v6.json`
  (sem tokens reais).
- Smoke no site após reload sem cache: browser → Meta só `PageView` e
  `bio_link_click` (antes também `scroll`); o sGTM continua a receber `scroll`
  para o GA4, bloqueado para o CAPI pelo `29`.

## CompleteRegistration (SIGN_UP do worker) sem user agent — corrigido (2026-11-01)

- Sintoma: Lead aparece no pixel (browser + servidor), CompleteRegistration nunca,
  apesar de 2 DOIs confirmados (12:01 e 13:43 UTC) e `/mp/collect` 200 no sGTM.
- Causa: logs do sGTM mostram os `/mp/collect` do worker com `userAgent` vazio. A tag
  Meta CAPI fica sem `client_user_agent`, obrigatório para eventos `website`. Vale para
  todos os tenants (o `emit_tracking` nunca enviou user agent); na DECOLE o
  CompleteRegistration só foi validado em maio em Eventos de teste (`TEST24981`) e não
  há conversões DECOLE na D1 desde 23/09 para confirmar produção.
- Correção (commit `137a10f`): `links-redirect` grava `attribution.user_agent`;
  `emit_tracking` envia-o no header `User-Agent` e em `user_agent`, e o IP do visitante
  em `ip_override`. Testes novos nos dois workers; 585 testes passam; typecheck OK.
- Deploy (autorizado, sem auto mode): `decole-funnel-dispatcher` `5aced385`,
  `decole-links-redirect` `dc1c2d70`; `/health` 200 em links.theproductengineer.net,
  links.decolesuacarreiraesg.com.br e links.entrepontos.club. Os `wrangler.toml` com
  alterações não commitadas do Entrepontos já estavam ao vivo desde 16/10.
- Prova: 3.ª inscrição (`…+pe-smoke-20261101c`), DOI confirmado pelo titular; `/mp/collect`
  às 14:38:49 UTC, 200, com o User-Agent do iPhone/Safari do titular. CompleteRegistration
  no pixel: aguardar as stats (atraso de 1–2 h).

## Ledger

| Fatia | Aceite | Status |
|---|---|---|
| M1 | Ativos, token, atribuição ao pixel e CAPI de teste | DONE |
| M2 | GTM Web live com tags Meta, PageView no site | DONE (live v5) |
| M3 | LTs sGTM live, CAPI recebido | IN_PROGRESS (live v26; evento SERVER ainda não visível nas stats) |
| M4 | Catálogo + smoke de deduplicação + checagem Codex | IN_PROGRESS (Lead dedup e regressão DECOLE por confirmar) |
