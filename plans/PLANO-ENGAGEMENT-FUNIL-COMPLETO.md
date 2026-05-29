# PLANO — Funil completo + jornada do usuário (engajamento por identidade, multicamadas)

> Tipo: PLANO de design (define o quê e por quê). Ativo (pré-execução).
> STATUS / progresso: ver `STATUS-ENGAGEMENT.md` (source of truth).
> Slices: `slices/engagement/{N}-{título}.md`.
> Origem: estudos preliminares em `decole/decolesuacarreiraesg/trafego/` + pedido de funil completo por tenant/produto.
> Criado: 2026-05-29.

## Contexto

Hoje `PAGE_VIEW`/`CTA_CLICK` saem do browser via `dataLayer` → GTM Web → sGTM → GA4 + Meta (`delivery: gtm_web_only`) e **não** vão para D1. O dashboard lê só agregação diária do GA4 (`ga4_daily_metrics`, via `dashboard-sync/src/ga4.ts`). Eventos server-side (`GENERATE_LEAD`, `BEGIN_CHECKOUT`, `PURCHASE_*`) vão linha-por-evento para D1 `funnel_events`, costurados por `resolve_identity`. A jornada (`/dashboard/user/[profile_id]` + `UserTimeline`) lê só `funnel_events` por `profile_id`, e a busca é só email→profile (sem lista, sem anônimos).

Isso responde *quantos*, mas não responde as perguntas de **coorte e jornada por identidade**: *dos que assistiram a seção X da VSL / leram a seção Y da página, qual % virou lead e comprou? Como foi o caminho de um usuário específico (anônimo ou identificado)?*

Existem 4 estudos preliminares em `decole/decolesuacarreiraesg/trafego/` que definem a taxonomia desejada (`PaginaVendas-Secoes-Metricas.md` — 18 seções LP com `section_view`/`section_engaged`; `VSL v1 - mapeamento-secoes.md` — 12 seções VSL com SRT; `VSL-Metricas.md` — `vsl_section_start/end/progress`; `Arquitetura-Eventos-D1.md` — modelo D1 antigo, hoje superado).

**Objetivo:** integrar essa taxonomia num modelo **híbrido e multicamadas** — D1 `session_engagement` (rollup por sessão, costurado por identidade) como fonte primária do funil completo e da jornada; GA4 como reconciliação; Workers Analytics Engine para drill-down cru (fase 2) — com **frontend TS modular reutilizável** entre páginas/tenants, e um **dashboard de jornada** (timeline de eventos únicos + comportamento agregado) navegável para usuários anônimos e identificados.

## Decisões travadas (confirmadas com o usuário)

1. **Fonte primária = D1 `session_engagement`** costurado por identidade; GA4 agregado = reconciliação.
2. **Drill-down cru (fase 2) = Workers Analytics Engine** (fica no Cloudflare; sem JOIN, só GROUP BY; retenção ~90d → rollup).
3. **GA4 aditivo, não substituído**: `section_view`/`section_engaged`/`vsl_section_*` continuam por `dataLayer`→GTM→sGTM→GA4.
4. **Jornada: agregada por sessão na fase 1**; drill-down evento-a-evento na fase 2 (Analytics Engine por `anonymous_id`/`session_id`).
5. **Lista de usuários: anônimos + identificados, rota de jornada unificada** (aceita `profile_id` ou `anonymous_id`).
6. **Execução sob os guard rails dos `AGENTS.md`**: TDD, Planning Review + Code Quality Review por slice, TS strict, sem hardcode, catálogo como fonte única.

## Fronteira entre repos (regras locais dos `AGENTS.md`)

- **`decole/decolesuacarreiraesg`**: só frontend/conteúdo — `site/src/engagement/*` e wiring no HTML. **Não pode conter backend Cloudflare** (regra local). Qualquer mudança em funil/tracking exige verificar o catálogo no repo irmão.
- **`funil-mkt-platform`** (este repo): backend compartilhado — migration D1, `packages/shared` (tipos + merge puro), `event-normalizer`, handler do funnel-dispatcher, e **o catálogo `config/products.catalog.json` (fonte única)**. Ao mudar o catálogo: atualizar `updatedAt` e seguir `config/README.md`; se não mudar, registrar no resumo.
- **`mkt-dashboard`**: leitura/visualização — manter SoC entre UI, auth, clients, queries (`lib/d1.ts`) e integrações; avaliar mudanças contra o catálogo.

## Arquitetura multicamadas e SoC

Aplicando `workspace-agent-guidelines/guidelines/change-workflow.md` (domínio puro separado de IO/rede/DB/DOM; TS strict; nada de hardcode de tenant/produto — tudo via config/catálogo):

| Camada | Responsabilidade | Onde / reuso |
|---|---|---|
| **Config/dados** | Mapa de seções LP + VSL (SRT, `vsl_version`) e eventos `engagement_rollup`. Fonte única. | `config/products.catalog.json` (consumido por site, worker e dashboard) |
| **Domínio puro (frontend)** | Resolver `currentTime`→seção; acumular engajamento de sessão; mesclar idempotente. Funções puras, sem DOM. | `site/src/engagement/core.ts` (testável, sem IO) |
| **Adaptadores IO (frontend)** | IntersectionObserver, YouTube IFrame API, `dataLayer.push`, `sendBeacon`. | `site/src/engagement/dom.ts` + `index.ts` (entry IIFE) |
| **Ingress/transporte** | Receber `ENGAGEMENT_SNAPSHOT`, validar origem/tenant. | `api-funnel-ingress` (reuso, sem worker novo) |
| **Domínio puro (server)** | Mesclar snapshot↔linha existente; elevar `funnel_stage`. Função pura testável. | `packages/shared/src` (ex.: `session-engagement.ts`) |
| **Persistência** | UPSERT `session_engagement`; stitching `anonymous_id→profile_id`. | funnel-dispatcher handler `upsert_session_engagement` |
| **Query/leitura** | Funil agregado, coorte, jornada, lista de usuários. | `mkt-dashboard/lib/d1.ts` (funções puras de SQL) |
| **Apresentação** | Funil, coorte, retenção VSL, timeline, lista. | `mkt-dashboard/components/*` + `app/dashboard/*` |

Princípio: a regra de domínio (resolver seção, mesclar rollup) é pura e testada nas duas pontas; DOM/rede/D1 ficam em adaptadores finos. Nenhum tenant/produto/mapa hardcoded — tudo do catálogo.

## Frontend TS modular reutilizável (`site/src/engagement/`)

Segue o padrão já em produção (`meta-am.ts`/`precheckout.ts`: módulo TS strict → esbuild IIFE com `--global-name` → `assets/*.js`, config por `data-*`/`window.XxxConfig`, multi-tenant via `namespace`). Novo módulo **genérico e config-driven** — sem nada específico de DECOLE no código:

- `site/src/engagement/core.ts` — **puro**: `resolveVslSection(timeSec, sectionMap)`, `SessionAccumulator` (merge de `lp_sections_*`, `vsl_sections`, `cta_clicks`, `max_scroll_pct`), serialização do snapshot. 100% testável em vitest, sem DOM.
- `site/src/engagement/dom.ts` — **adaptador**: IntersectionObserver para o `sectionSelector` (thresholds 50%/1s e 8s, do doc `PaginaVendas`); YouTube IFrame API (poll `getCurrentTime()` → `resolveVslSection`); hook no CTA existente (`pushCtaEvent`, `site/index.html:5976`).
- `site/src/engagement/index.ts` — entry IIFE: lê `window.EngagementConfig`/`data-*` (`namespace`, `productCode`, `ingressUrl`, `vslVersion`), faz `dataLayer.push` (GA4, aditivo) **e** emite `ENGAGEMENT_SNAPSHOT` ao `api-funnel-ingress` em play da VSL, clique de CTA, lead e `beforeunload` (via `navigator.sendBeacon`).
- Build: adicionar `build:engagement` ao `site/package.json` (`esbuild ... --global-name=Engagement --outfile=assets/engagement.js`), incluir em `build`/`build:prod`/`watch`.
- **Reuso**: o mesmo bundle serve `site/index.html` (DECOLE_ESG, 18 seções + VSL) e `site/planodevoo/index.html` (DECOLE_PLANOVOO, 9 seções, **sem VSL**) — só muda a config injetada e o mapa de seções no catálogo (incl. `sectionSelector` próprio, já que os IDs do Plano de Voo não usam `lp-secao-*`). Sem bloco `vsl`, o adaptador de VSL não é ativado. Pronto para novos tenants pelo mesmo `namespace`.
- O mapa de seções é entregue ao cliente via config derivada do catálogo (mesma fonte do worker/dashboard); o resolver é reimplementado puro em `core.ts` por ser cross-repo, mas os **dados** são únicos (catálogo).

## Modelo de dados — `session_engagement` (D1, additive)

Uma linha por sessão (bounded = nº de sessões, não de eventos); encoda LP + VSL + CTA em colunas JSON e já vem com identidade para JOIN com compra.

```sql
CREATE TABLE IF NOT EXISTS session_engagement (
  tenant_id        TEXT NOT NULL DEFAULT 'decole',
  session_id       TEXT NOT NULL,
  anonymous_id     TEXT,
  profile_id       TEXT,              -- preenchido na stitching quando vira lead
  product_code     TEXT NOT NULL,
  funnel_stage     TEXT,              -- maior estágio atingido na sessão
  first_seen_at    TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL,
  page_views       INTEGER DEFAULT 0,
  max_scroll_pct   INTEGER DEFAULT 0,
  lp_sections_viewed   TEXT,          -- JSON: section_ids com section_view
  lp_sections_engaged  TEXT,          -- JSON: section_ids com section_engaged
  cta_clicks       TEXT,              -- JSON: [{cta_id, count}]
  vsl_version      TEXT,
  vsl_max_pct      INTEGER DEFAULT 0,
  vsl_sections     TEXT,              -- JSON: {section_key: {started, ended, watched_sec}}
  became_lead      INTEGER DEFAULT 0,
  purchased        INTEGER DEFAULT 0,
  PRIMARY KEY (tenant_id, session_id)
);
CREATE INDEX idx_se_tenant_profile ON session_engagement(tenant_id, profile_id);
CREATE INDEX idx_se_tenant_anon    ON session_engagement(tenant_id, anonymous_id, last_seen_at);
CREATE INDEX idx_se_tenant_product_stage ON session_engagement(tenant_id, product_code, funnel_stage, last_seen_at);
```

Migration idempotente no padrão `dashboard-sync/src/index.ts` (`__funilmkt_schema_migrations`). Tipos em `packages/shared/src` (junto de `funnel-event.ts`).

### Exemplo de dados na base (3 coortes, usando as seções reais)

```text
tenant │ session_id │ anonymous_id │ profile_id │ stage        │ pv │ scroll │ vsl_ver │ vsl% │ lead │ buy
decole │ s_a1f…      │ anon_7c2…    │ (null)     │ CONSIDERATION│ 1  │ 62     │ v1      │ 37   │ 0    │ 0
decole │ s_b9e…      │ anon_4d8…    │ prof_512…  │ CONVERSION   │ 2  │ 88     │ v1      │ 80   │ 1    │ 0
decole │ s_c3d…      │ anon_4d8…    │ prof_512…  │ PURCHASE     │ 1  │ 100    │ v1      │ 100  │ 1    │ 1
```

Detalhe das colunas JSON (linha 3, comprador `prof_512…`):
```jsonc
lp_sections_viewed:  ["lp-secao-inicio","lp-secao-aula-gratuita","lp-secao-oferta","lp-secao-metodo","lp-secao-garantia","lp-secao-oferta-final"]
lp_sections_engaged: ["lp-secao-aula-gratuita","lp-secao-oferta","lp-secao-garantia"]
cta_clicks:          [{"cta_id":"hero-cta","count":1},{"cta_id":"oferta-final-cta","count":2}]
vsl_sections:        {"vslv1_promessa":{"started":true,"ended":true,"watched_sec":40}, …}  // 12 seções
```

`anon_4d8…` aparece em duas sessões — após o lead, a stitching preenche `profile_id`/`became_lead` retroativamente. Nenhum PII na tabela (só hashes/ids).

## Reconciliação dos docs preliminares com a produção

`Arquitetura-Eventos-D1.md` (`contacts`+`events`, Collector `POST /events`, `anon_id=hash(fbp|fbc|fbclid)`) é **superado**: Collector→`api-funnel-ingress`; `anon_id`/`session_id`→`anonymous_id`+`resolve_identity`; `contacts`→Identity KV + Brevo; `events`→`funnel_events` + `session_engagement`. **Não criar coletor paralelo.** Marcar o doc como histórico.

Catálogo ganha o mapa de seções versionado e os eventos:
```jsonc
{ "funnelStage": "AWARENESS",     "eventType": "SECTION_VIEW",        "delivery": "engagement_rollup", "source": "site" }
{ "funnelStage": "AWARENESS",     "eventType": "SECTION_ENGAGED",     "delivery": "engagement_rollup", "source": "site" }
{ "funnelStage": "CONSIDERATION", "eventType": "VSL_SECTION_START",   "delivery": "engagement_rollup", "source": "site" }
{ "funnelStage": "CONSIDERATION", "eventType": "VSL_SECTION_END",     "delivery": "engagement_rollup", "source": "site" }
{ "funnelStage": "AWARENESS",     "eventType": "ENGAGEMENT_SNAPSHOT", "delivery": "engagement_rollup", "source": "site" }
```

### Config de seções — DECOLE_ESG (dados reais de `site/index.html`)

`tenants.decole.products.DECOLE_ESG_MENTORIA.engagement`. VSL = 12 seções de `VSL v1 - mapeamento-secoes.md`, SRT→segundos; `videoId = GXfMV8KxUsA`:

```jsonc
"engagement": {
  "vsl": {
    "videoId": "GXfMV8KxUsA", "activeVersion": "v1",
    "versions": { "v1": { "durationSec": 1612.7, "sections": [
      { "id": "01", "key": "vslv1_promessa",                                      "name": "PROMESSA",                       "startSec": 0.4,    "endSec": 40.7 },
      { "id": "02", "key": "vslv1_transicao-panorama-do-mercado-crescimento",      "name": "TRANSICAO - panorama do mercado", "startSec": 40.833, "endSec": 211.833 },
      { "id": "03", "key": "vslv1_para-quem-e",                                     "name": "PARA QUEM E",                    "startSec": 212.4,  "endSec": 261.033 },
      { "id": "04", "key": "vslv1_provas-reais",                                    "name": "PROVAS REAIS",                   "startSec": 261.333,"endSec": 319.566 },
      { "id": "05", "key": "vslv1_historia-pessoal",                                "name": "HISTORIA PESSOAL",               "startSec": 319.666,"endSec": 390.6 },
      { "id": "06", "key": "vslv1_exercicio-1-possibilidade-para-todas-as-areas",  "name": "EXERCICIO 1",                    "startSec": 391.766,"endSec": 591.0 },
      { "id": "07", "key": "vslv1_exercicio-2-jeito-errado-x-jeito-certo",         "name": "EXERCICIO 2",                    "startSec": 591.2,  "endSec": 643.7 },
      { "id": "08", "key": "vslv1_por-que-esse-erro-falha",                        "name": "POR QUE ESSE ERRO FALHA?",       "startSec": 644.0,  "endSec": 916.3 },
      { "id": "09", "key": "vslv1_como-criar-uma-carreira-em-esg-6-passos-metodo", "name": "COMO CRIAR UMA CARREIRA EM ESG", "startSec": 917.266,"endSec": 1227.9 },
      { "id": "10", "key": "vslv1_por-que-meu-metodo-funciona",                    "name": "POR QUE MEU METODO FUNCIONA?",   "startSec": 1227.9, "endSec": 1486.766 },
      { "id": "11", "key": "vslv1_ancoragem-oferta",                               "name": "ANCORAGEM + OFERTA",             "startSec": 1487.333,"endSec": 1593.966 },
      { "id": "12", "key": "vslv1_cta-emocional",                                  "name": "CTA EMOCIONAL",                  "startSec": 1594.4, "endSec": 1612.7 }
    ] } }
  },
  "landing": {
    "sectionSelector": "section[id^=\"lp-secao-\"]",
    "viewThreshold": 0.5, "viewTimeMs": 1000, "engagedTimeMs": 8000,
    "sections": [
      { "id": "lp-secao-inicio", "index": 1, "name": "Hero / Início" },
      { "id": "lp-secao-aula-gratuita", "index": 2, "name": "Aula gratuita (VSL)" },
      { "id": "lp-secao-oferta", "index": 3, "name": "Oferta" },
      { "id": "lp-secao-metodo", "index": 4, "name": "Método" },
      { "id": "lp-secao-publico-alvo", "index": 5, "name": "Público-alvo" },
      { "id": "lp-secao-depoimentos", "index": 6, "name": "Depoimentos" },
      { "id": "lp-secao-mentoria-grupo", "index": 7, "name": "Mentoria em grupo" },
      { "id": "lp-secao-whatsapp-1a1", "index": 8, "name": "WhatsApp 1a1" },
      { "id": "lp-secao-mentora", "index": 9, "name": "Mentora" },
      { "id": "lp-secao-midia", "index": 10, "name": "Mídia" },
      { "id": "lp-secao-garantia", "index": 11, "name": "Garantia" },
      { "id": "lp-secao-perguntas-frequentes", "index": 12, "name": "FAQ" },
      { "id": "lp-secao-diferenca-decole", "index": 13, "name": "Diferença DECOLE" },
      { "id": "lp-secao-jornada-decole", "index": 14, "name": "Jornada DECOLE" },
      { "id": "lp-secao-mitos-verdades", "index": 15, "name": "Mitos e verdades" },
      { "id": "lp-secao-alcance-global", "index": 16, "name": "Alcance global" },
      { "id": "lp-secao-contato-final", "index": 17, "name": "Contato final" },
      { "id": "lp-secao-oferta-final", "index": 18, "name": "Oferta final" }
    ]
  }
}
```

`startSec/endSec` derivam do SRT; `durationSec` = fim da seção 12; `vsl_max_pct = 100 * maxTimeSec / durationSec`. Os 18 `lp-secao-*` são reais e confirmados em `site/index.html`.

### Config de seções — DECOLE_PLANOVOO (mapeamento/nomeação)

`site/planodevoo/index.html` tem **9 seções com convenção diferente** (não `lp-secao-*`) e **não tem VSL**. Bloco `engagement` próprio com `sectionSelector` específico e **sem** `vsl`:

```jsonc
// tenants.decole.products.DECOLE_PLANOVOO.engagement
"engagement": {
  "landing": {
    "sectionSelector": "section[id='preview'],section[id='o-que-e'],section[id='como-funciona'],section[id='o-que-tem'],section[id='depoimentos'],section[id='no-whatsapp'],section[id='mentoria'],section[id='oferta'],section[id='elizete']",
    "viewThreshold": 0.5, "viewTimeMs": 1000, "engagedTimeMs": 8000,
    "sections": [
      { "id": "preview", "index": 1, "name": "Preview do plano" },
      { "id": "o-que-e", "index": 2, "name": "O que é" },
      { "id": "como-funciona", "index": 3, "name": "Como funciona" },
      { "id": "o-que-tem", "index": 4, "name": "O que tem" },
      { "id": "depoimentos", "index": 5, "name": "Depoimentos" },
      { "id": "no-whatsapp", "index": 6, "name": "No WhatsApp" },
      { "id": "mentoria", "index": 7, "name": "Mentoria" },
      { "id": "oferta", "index": 8, "name": "Oferta" },
      { "id": "elizete", "index": 9, "name": "Elizete (mentora)" }
    ]
  }
}
```

Alternativa (decidir em 0-disc): padronizar `data-lp-section="<key>"` nas duas páginas. Default: manter IDs atuais + selector por produto (menor risco).

## Pipeline (server)

- `event-normalizer` (`packages/shared/src/event-normalizer.ts`): aceitar os novos `eventType` e normalizar payload de engajamento.
- funnel-dispatcher: handler `upsert_session_engagement` (espelha `upsert_event_store`) usando o merge **puro** de `packages/shared`; UPSERT por `(tenant_id, session_id)`.
- stitching: quando `GENERATE_LEAD`/`PURCHASE_*` resolve `profile_id`, propagar para `session_engagement` por `anonymous_id` (UPDATE `profile_id`, `became_lead`, `purchased`) — reusa `resolve_identity`.

## GA4 + Meta — eventos e dimensões customizadas (padrão `cta_click`)

Os eventos têm **duas pernas alimentadas pelo mesmo `dataLayer.push`**: (a) **analytics** — GTM Web → GA4 + Meta (aditivo, como `cta_click`); (b) **identidade/coorte** — `sendBeacon` → `api-funnel-ingress` → D1.

### Padrão real do `cta_click` (de `trafego/gtm/cta-click-import.json`)

Container WEB `GTM-58CQ9K7X` (account `6266094107`, container `231314463`). Por evento: (1) variáveis `DL - <param>` (tipo `v`, dataLayerVersion 2); (2) trigger `CUSTOM_EVENT` `_event == <event_name>`; (3) tag GA4 (`gaawe`) com `eventName`, `eventSettingsTable` mapeando `{{DL - param}}`→parâmetro e `measurementIdOverride = G-BQQB6X5XN1`. Replicar para `section_view`, `section_engaged`, `vsl_section_start`, `vsl_section_end` (e opcional `vsl_section_progress`). `engagement_snapshot` **não** vai ao GTM (só D1).

### Credenciais (nomes em `.env.local` — valores nunca expostos/commitados)

| Tarefa | API | Credenciais (nomes) |
|---|---|---|
| Vars/triggers/tags no GTM Web e Server | Tag Manager API v2 | `GOOGLE_SERVICE_ACCOUNT_JSON` + `GTM_ACCOUNT_ID_WEB/SERVER`, `GTM_CONTAINER_ID_WEB/SERVER`, `GTM_WORKSPACE_ID_WEB/SERVER` |
| Dimensões customizadas (event-scoped) | GA4 Admin API | `GOOGLE_SERVICE_ACCOUNT_JSON` + `GA4_PROPERTY_ID` |
| Validar ingestão / relatórios | GA4 Data API | `GA4_PROPERTY_ID`, `GA4_API_SECRET`, `GA4_MEASUREMENT_ID` |
| Eventos custom + CAPI + validação | Meta Graph/Conversions API | `META_SYSTEM_USER_ACCESS_TOKEN`, `META_PIXEL_ID_DECOLE_ESG`, `META_CAPI_ACCESS_TOKEN_DECOLE_ESG`, `META_TEST_EVENT_CODE_DECOLE_ESG` (e `_PLANOVOO`) |

**Gotcha (resolver em 0-disc):** deriva de nomes entre catálogo (`GA4_API_SECRET_DECOLE`, `GA4_PROPERTY_ID_DECOLE`, `META_CAPI_ACCESS_TOKEN_DECOLE`) e `.env.local` (`GA4_API_SECRET`, `GA4_PROPERTY_ID`, `META_CAPI_ACCESS_TOKEN_DECOLE_ESG`). Confirmar quais nomes os workers/dashboard realmente leem antes de configurar.

### GA4 — dimensões customizadas (event-scoped)

Reaproveitar `produto` (já existe, `customEvent:produto`, usado em `dashboard-sync/src/ga4.ts`). Novas (consolidar LP+VSL, limite de 50): `section_id`, `section_name`, `section_index`, `visible_pct`, `time_visible_ms`, `vsl_version`, `vsl_section_key`, `video_time_sec`, `progress_pct`. Registrar via Admin API (`customDimensions.create`).

### Meta — seletivo (evitar diluição)

Enviar só eventos de alta intenção como custom (ex.: `VSLProgress` em ≥75%, `SectionEngaged` na seção de oferta) via Pixel + CAPI (server), úteis para públicos/otimização. Flag `metaForward` por evento no catálogo. Validar com `META_TEST_EVENT_CODE_*` em Events Manager → Test Events.

### Artefato versionado

Exportar os containers atualizados para `trafego/gtm/` (`engagement-web-import.json`, `engagement-server-import.json`). Mudança outward-facing executada na implementação.

## Dashboard — funil + jornada (`mkt-dashboard`)

**Funil completo (`app/dashboard/page.tsx`)**, por tenant→produto→fase, de `session_engagement`: funil unificado (Page View → Seções → VSL por seção → CTA → Lead → Checkout → Compra) estendendo `lib/d1.ts`/`FunnelBar.tsx`; overlay de coorte (anônimo/lead/comprador); retenção VSL por seção + leitura LP; GA4 = reconciliação.

**Jornada** (rota unificada aceitando `profile_id` ou `anonymous_id`): timeline de eventos únicos (`UserTimeline`, `funnel_events`) + marcadores por sessão (rollup); painel agregado (`UserBehaviorSummary`); drill-down evento-a-evento na fase 2 (Analytics Engine). Estende `getUserJourney` p/ aceitar `anonymous_id` + LEFT JOIN `session_engagement`.

**Lista de usuários** (`app/dashboard/user/page.tsx`): nova `listUsers(tenantId, {filter, cursor})` agregando `session_engagement` por identidade — anônimos (`profile_id IS NULL`) e identificados — ordenados por `last_seen_at`. Componente `UserList`. Mantém busca por email.

(Wireframes das telas: ver plano de planejamento original / slices 1F-1G.)

## Capacidade

18 LP × (view+engaged) + 12 VSL × (start+end) ≈ **até ~60 eventos/sessão**. Gravar cru em `funnel_events` estoura 10 GB do D1. O rollup reduz a **1 linha/sessão** (~10k/dia a 10k sessões/dia), com JOIN com compra. Drill-down cru → Analytics Engine (fase 2), fora do D1.

## Privacidade / LGPD (bloqueante antes do site)

Engajamento por `anonymous_id` ligado a `profile_id`/email é dado pessoal. Stitching só sob base legal (lead = opt-in DOI). Respeitar Consent Mode v2; gravar `session_engagement` anônimo sem PII até consentimento. Lista de "anônimos" exibe só `anonymous_id`/engajamento, sem PII.

## Guard rails e fluxo de revisão (`review-agents.md`)

- **Planning Review antes de implementar**: `APROVADO | APROVADO COM AJUSTES | BLOQUEADO`. Registrado via `templates/slice-review-block.md`.
- **TDD (Red→Green→Refactor)** para todo comportamento novo: teste que falha primeiro, implementar mínimo, refatorar.
- **Code Quality Review ao fechar**: `APROVADO | APROVADO COM RESSALVAS | REPROVADO`. **`MUST-FIX` bloqueia**; implementador não autoaprova.
- **Guard rails de código**: TS strict; `any`/`!` só com justificativa; fail-fast; sem fallback silencioso; **sem hardcode** de tenant/produto/domínio/IDs; sem secrets no diff.

## Slices

Ver `slices/engagement/` (um arquivo por slice) e `STATUS-ENGAGEMENT.md` (ledger). Resumo:

| Slice | Entrega | Risco |
|---|---|---|
| 0-disc | Descoberta GA4/GTM/Meta (estado live + deriva catálogo↔env) | baixo |
| 1A | Migration D1 `session_engagement` + tipos + merge puro | baixo |
| 1B | Config seções dos 2 produtos no catálogo + eventos `engagement_rollup` | baixo |
| 1C | `site/src/engagement/` (core+dom+entry) + `build:engagement` | médio |
| 1D | Wire `index.html` (YouTube API) + `planodevoo/index.html` | médio |
| 1E | `event-normalizer` + handler `upsert_session_engagement` + stitching | médio |
| 1F | Dashboard funil unificado + coorte + retenção VSL | baixo |
| 1G | Jornada unificada (anon+profile) + `UserBehaviorSummary` + `UserList` | médio |
| 1FG | Correção de conformidade 1F/1G após auditoria de código | médio |
| 1H | GTM Web: vars/triggers/tags GA4 dos eventos | médio |
| 1I | GA4 Admin: dimensões customizadas + `ga4.ts` reconciliação | baixo |
| 1J | Meta seletivo (Pixel+CAPI, flag `metaForward`) | médio |
| 2 | Workers Analytics Engine: eventos crus + drill-down VSL ao segundo | médio |
| G1 | Governança no `workspace-agent-guidelines` (slice validator + ledger) | baixo |

Ordem de deploy: 0-disc → 1A→1B → 1C→1D → 1H→1I→1J → 1E → 1F→1G → 1FG se auditoria apontar pendências. G1 independente.

## Verificação e rollback

Por slice (ver cada arquivo). Geral: `git diff --check`; Planning Review obrigatório em 1C/1E/1G (cross-module/dados pessoais/LGPD); resumo final registra arquivos alterados, checks rodados/não rodados, e se o catálogo precisou mudar.

## Governança de execução — Slice Validator + status estrito

Cada slice é validado por um **agente Slice Validator** (estende Planning + Code Quality Reviewer de `review-agents.md`); implementador não autoaprova. Máquina de estados estrita:

```
NOT_STARTED → PLAN_REVIEW → APROVADO_BUILD → IN_PROGRESS → CODE_REVIEW → DONE   (⟂ BLOCKED)
```

`MUST-FIX` impede `DONE`; `REPROVADO` volta para `IN_PROGRESS`; transição só com evidência. Esta camada é generalizada para `workspace-agent-guidelines` no slice **G1** (`guidelines/slice-validation.md` + `templates/slice-status-ledger.md` + edições em `slice-review-block.md`/`README.md`). Ledger vivo em `STATUS-ENGAGEMENT.md`.
