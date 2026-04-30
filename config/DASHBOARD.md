# Dashboard de Funil DECOLE

> Plano de implementação aprovado em 2026-04-29.
> Para diagramas de arquitetura do pipeline de eventos ver [`ARCHITECTURE.md`](ARCHITECTURE.md).
> Diagrama de dados de entrada do funil: [`diagramas/05-dados-entrada-funil.puml`](diagramas/05-dados-entrada-funil.puml).

---

## Contexto

O DECOLE já tem um pipeline de eventos completo em Cloudflare D1 (`funnel_events`) capturando GENERATE_LEAD → BEGIN_CHECKOUT → PURCHASE_OUT_OF_CART → PURCHASE_APPROVED com identidade unificada (`profile_id`) e atribuição completa (utm, fbp, fbc). Os eventos de topo de funil (PAGE_VIEW, CTA_CLICK, BUTTON_CLICK) vão apenas para GA4 via GTM e serão trazidos via GA4 Data API com pull diário em cache D1. Dados de investimento e métricas de campanha vêm da Meta Marketing API.

O dashboard corre **inteiramente na Cloudflare** — Next.js no Cloudflare Pages com acesso direto ao D1 via bindings, sem VPS/Docker adicional.

---

## Arquitetura final

```
[D1: funnel_events]       ← events do pipeline existente
[D1: identity_links]      ← perfis unificados
[D1: ga4_daily_metrics]   ← cache do pull GA4 (novo)
[D1: meta_daily_metrics]  ← cache do pull Meta Ads (novo)
        │ bindings directos
        ▼
[Next.js — Cloudflare Pages]    dashboard.decolesuacarreiraesg.com.br
  + Cron Function diária (4h UTC) → GA4 Data API + Meta Marketing API → D1
```

**Sem Worker intermediário. Sem VPS. Sem Docker.**

---

## Stack do dashboard

- **Next.js 15** com `@cloudflare/next-on-pages` + adaptador edge
- **`export const runtime = 'edge'`** em todas as rotas (obrigatório para Pages)
- **D1 via `getRequestContext().env`** (acesso directo, sem HTTP extra)
- **Tailwind CSS puro** — dark theme idêntico ao plano-de-voo-app (#111111, #7ed957, #ff914d)
- **Cron trigger** em Pages Function (`functions/scheduled.ts`)
- **Sem PostgreSQL**, sem Node.js exclusivo (edge runtime apenas)

---

## Dados de entrada dos eventos por etapa do funil

Cada etapa do funil tem uma origem diferente e carrega campos distintos. Esta secção documenta o que chega, o que está em falta e como os dados se encaixam no dashboard por produto.

---

### Etapa 0 — PAGE_VIEW / CTA_CLICK / BUTTON_CLICK (AWARENESS / CONSIDERATION)

**Origem:** GTM Web (browser) → GA4 + Meta Pixel  
**Produto diferenciado por:** dimensão `customEvent:produto` no GA4  
**NÃO chegam ao D1** — capturados em cache via GA4 Data API (cron diário 4h UTC)

| Campo disponível | Fonte |
|-----------------|-------|
| event_name (page_view, cta_click) | GA4 Data API |
| event_count (agregado por dia) | GA4 Data API |
| product_code | `customEvent:produto` → DECOLE_ESG_MENTORIA \| DECOLE_PLANOVOO |

---

### Etapa 1 — GENERATE_LEAD (CONSIDERATION)

**Origem:** Formulário precheckout → `api-funnel-ingress` → queue → dispatcher  
**Ficheiros frontend:** `site/index.html`, `site/planodevoo/index.html`  
**Endpoint:** `POST api.decolesuacarreiraesg.com.br/funnel/precheckout`

| Campo | Status | Fonte no frontend |
|-------|--------|------------------|
| `email` | ✅ | Input do formulário |
| `anonymous_id` | ✅ | `localStorage['decole_anonymous_id']` (UUID persistente) |
| `session_id` | ✅ | `sessionStorage['decole_session_id']` (UUID por sessão) |
| `lead_id` | ✅ | `sessionStorage['decole_lead_id']` |
| `product_code` | ✅ | Hidden field (`DECOLE_ESG_MENTORIA` \| `DECOLE_PLANOVOO`) |
| `fbp` | ✅ | Cookie `_fbp` (Meta Pixel first-party) |
| `fbc` | ✅ | Cookie `_fbc` ou gerado de `fbclid` na URL |
| `utm_source` | ❌ **GAP** | Não lido da URL — **fix: BACKLOG-015** |
| `utm_medium` | ❌ **GAP** | Não lido da URL — **fix: BACKLOG-015** |
| `utm_campaign` | ❌ **GAP** | Não lido da URL — **fix: BACKLOG-015** |
| `gclid` | ❌ **GAP** | Não capturado — **fix: BACKLOG-015** |

**Fix BACKLOG-015 (10 linhas de JS):**
```js
// Ao carregar a página: guardar UTMs em sessionStorage
(function saveUtms() {
  var p = new URLSearchParams(window.location.search);
  ['utm_source','utm_medium','utm_campaign','gclid'].forEach(function(k) {
    if (p.get(k)) sessionStorage.setItem('decole_' + k, p.get(k));
  });
})();

// No submit: adicionar ao FormData
function getUtmParams() {
  var p = new URLSearchParams(window.location.search);
  return {
    utm_source:   p.get('utm_source')   || sessionStorage.getItem('decole_utm_source')   || '',
    utm_medium:   p.get('utm_medium')   || sessionStorage.getItem('decole_utm_medium')   || '',
    utm_campaign: p.get('utm_campaign') || sessionStorage.getItem('decole_utm_campaign') || '',
    gclid:        p.get('gclid')        || sessionStorage.getItem('decole_gclid')        || '',
  };
}
```

---

### Etapa 2 — BEGIN_CHECKOUT (CONVERSION)

**Origem:** Clique no link de checkout → `links-redirect` Worker → queue → dispatcher  
**Worker:** `links.decolesuacarreiraesg.com.br/<produto>/checkout`  
**Produto diferenciado por:** path do link (`/decole-esg/checkout` vs `/plano-de-voo/checkout`)

| Campo | Status | Fonte no Worker |
|-------|--------|----------------|
| `utm_source` | ✅ | `url.searchParams.get('utm_source')` |
| `utm_medium` | ✅ | `url.searchParams.get('utm_medium')` |
| `utm_campaign` | ✅ | `url.searchParams.get('utm_campaign')` |
| `gclid` | ✅ | `url.searchParams.get('gclid')` |
| `fbp` | ✅ | Cookie `_fbp` lido pelo Worker |
| `fbc` | ✅ | Cookie `_fbc` lido pelo Worker |
| `anonymous_id` | ✅ | Cookie ou query param |
| `client_ip` | ✅ | `CF-Connecting-IP` header |
| `product_code` | ✅ | Inferido do path do link |

> **Nota:** Para que os UTMs cheguem ao BEGIN_CHECKOUT, o botão de checkout no site deve incluí-los na URL. Exemplo: `links.decole.../decole-esg/checkout?utm_source=instagram&utm_campaign=abc`

---

### Etapa 3 — PURCHASE_OUT_OF_SHOPPING_CART (CONVERSION)

**Origem:** Hotmart Webhook → `api-hotmart-ingress` → queue → dispatcher  

| Campo | Status | Fonte |
|-------|--------|-------|
| `email` → `profile_id` | ✅ | Webhook Hotmart → SHA-256 → lookup `identity_links` |
| `transaction_id` | ✅ | Webhook Hotmart |
| `product_code` | ✅ | `product_id` → `5083704` (ESG) \| `7592718` (PlanoVoo) |
| `fbp`, `fbc`, `utm_*` | ✅ via `enrich_attribution` | Recuperados do BEGIN_CHECKOUT do mesmo `profile_id` |

---

### Etapa 4 — PURCHASE_APPROVED (PURCHASE)

**Origem:** Hotmart Webhook → `api-hotmart-ingress` → queue → dispatcher  

| Campo | Status | Fonte |
|-------|--------|-------|
| `email` → `profile_id` | ✅ | Webhook Hotmart → SHA-256 → lookup `identity_links` |
| `transaction_id`, `valor` | ✅ | Webhook Hotmart |
| `offer_code` | ✅ | Webhook Hotmart |
| `product_code` | ✅ | `product_id` → `5083704` (ESG) \| `7592718` (PlanoVoo) |
| `fbp`, `fbc`, `client_ip` | ✅ via `enrich_attribution` | Recuperados do evento site anterior do mesmo `profile_id` |
| `utm_source`, `utm_campaign` | ✅ via `enrich_attribution` | Recuperados do BEGIN_CHECKOUT do mesmo `profile_id` |

---

### Mapa completo de campos por etapa

| Campo | PAGE_VIEW | GENERATE_LEAD | BEGIN_CHECKOUT | PURCHASE |
|-------|:---------:|:-------------:|:--------------:|:--------:|
| `product_code` | ✅ GA4 dim | ✅ | ✅ | ✅ |
| `anonymous_id` | — | ✅ | ✅ | via profile |
| `profile_id` | — | ✅ resolve | ✅ resolve | ✅ resolve |
| `email_hash` | — | ✅ | — | ✅ |
| `fbp` | — | ✅ | ✅ | via enrich |
| `fbc` | — | ✅ | ✅ | via enrich |
| `utm_source` | — | ❌ fix | ✅ | via enrich |
| `utm_medium` | — | ❌ fix | ✅ | via enrich |
| `utm_campaign` | — | ❌ fix | ✅ | via enrich |
| `gclid` | — | ❌ fix | ✅ | via enrich |
| `valor` | — | — | — | ✅ |
| `transaction_id` | — | — | — | ✅ |

---

### Como os dados se encaixam no funil por produto

```
PRODUTO: DECOLE_ESG_MENTORIA | DECOLE_PLANOVOO
                                              fonte        campo diferenciador
──────────────────────────────────────────────────────────────────────────────
AWARENESS
  PAGE_VIEW          ← ga4_daily_metrics    customEvent:produto

CONSIDERATION
  CTA_CLICK          ← ga4_daily_metrics    customEvent:produto
  GENERATE_LEAD      ← funnel_events        product_code = 'DECOLE_ESG_MENTORIA'

CONVERSION
  BEGIN_CHECKOUT     ← funnel_events        product_code
  CART_ABANDONMENT   ← funnel_events        product_code

PURCHASE
  PURCHASE_APPROVED  ← funnel_events        product_code (via product_id Hotmart)

MÉTRICAS META ADS
  spend/CPM/CPC/CTR  ← meta_daily_metrics   product_code
  (por ad account)       ESG → META_AD_ACCOUNT_ID_ESG
                         PlanoVoo → META_AD_ACCOUNT_ID_PLANOVOO
```

---

## Métricas por fonte

### Meta Marketing API → `meta_daily_metrics`

| Métrica | Campo API | Produto |
|---------|-----------|---------|
| Valor gasto | `spend` | ESG + PlanoVoo |
| Impressões | `impressions` | ESG + PlanoVoo |
| Cliques no link | `actions[link_click]` | ESG + PlanoVoo |
| Visualizações landing page | `actions[landing_page_view]` | ESG + PlanoVoo |
| Leads Meta | `actions[lead]` | ESG + PlanoVoo |
| CPM | `cpm` | ESG + PlanoVoo |
| CPC | `cpc` | ESG + PlanoVoo |
| CTR | `ctr` | ESG + PlanoVoo |
| Custo por Lead | `cost_per_action_type[lead]` | ESG + PlanoVoo |

Calculados no dashboard: **Connect Rate** (LP views / cliques), **Conversão LP** (leads / LP views), **ROAS**, **Lucro**

### GA4 Data API → `ga4_daily_metrics`

- `page_view`, `cta_click`, `button_click`
- Dimensão: `customEvent:produto` (diferencia ESG de PlanoVoo)

### D1 `funnel_events` (já existente)

- `GENERATE_LEAD`, `BEGIN_CHECKOUT`, `PURCHASE_OUT_OF_SHOPPING_CART`, `PURCHASE_APPROVED`
- Com `profile_id`, `utm_source`, `utm_campaign`, `fbp`, `fbc`

---

## Vista do dashboard por produto

```
┌─────────────────────────────────────────────────────┐
│  DECOLE ESG MENTORIA          Período: [30d ▼]      │
├────────────────────────┬────────────────────────────┤
│  META ADS              │  FUNIL COMPLETO             │
│  Gasto: R$ 2.091,61   │  Impressões    10.000  ←Meta│
│  CPM:   R$ X,XX       │      ↓ CTR 1,53%            │
│  CPC:   R$ 1,72       │  Cliques        1.216  ←Meta│
│  CTR:   0,17%         │      ↓ Connect 81%          │
│  CPL:   R$ X,XX       │  Visitas LP       969  ←Meta│
│  ROAS:  X,X           │      ↓ Conv 11%             │
│  Lucro: R$ 5.527,02   │  Leads (D1)       500  ←D1 │
│                        │      ↓ 40%                  │
│  Vendas: 2 (M1)        │  Checkout (D1)    200  ←D1 │
│  Ticket: R$ 3.797,00  │      ↓ 50%                  │
│  Fatur.: R$ 7.618,63  │  Compras (D1)      80  ←D1 │
└────────────────────────┴────────────────────────────┘
```

---

## Estrutura do app `decole-dashboard`

```
decole-dashboard/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                        ← redirect → /dashboard
│   ├── login/page.tsx
│   ├── dashboard/
│   │   ├── page.tsx                    ← funil completo (ambos produtos)
│   │   ├── attribution/page.tsx        ← breakdown UTM por campanha
│   │   ├── user/page.tsx              ← search por email
│   │   └── user/[profile_id]/page.tsx ← timeline do perfil
│   └── api/auth/route.ts
├── components/
│   ├── FunnelBar.tsx
│   ├── AttributionTable.tsx
│   └── UserTimeline.tsx
├── lib/
│   ├── d1.ts                  ← queries D1 via getRequestContext()
│   └── auth.ts
├── functions/
│   └── scheduled.ts           ← Cron: GA4 + Meta sync (4h UTC diário)
├── middleware.ts
├── wrangler.toml
├── package.json
└── next.config.ts
```

---

## D1: novas tabelas a criar

### `ga4_daily_metrics` → `backend/cloudflare/config/d1/ga4_daily_metrics.sql`

```sql
CREATE TABLE IF NOT EXISTS ga4_daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  product_code TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ga4_daily_unique
ON ga4_daily_metrics(date, product_code, event_name);
```

### `meta_daily_metrics` → `backend/cloudflare/config/d1/meta_daily_metrics.sql`

```sql
CREATE TABLE IF NOT EXISTS meta_daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  product_code TEXT NOT NULL,
  spend REAL,
  impressions INTEGER,
  link_clicks INTEGER,
  landing_page_views INTEGER,
  leads INTEGER,
  cpm REAL,
  cpc REAL,
  ctr REAL,
  cost_per_lead REAL,
  fetched_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_daily_unique
ON meta_daily_metrics(date, product_code);
```

Aplicar em: `decole-d1-event-store` (via `apply-d1-schema.sh`)

---

## `wrangler.toml` do dashboard

```toml
name = "decole-dashboard"
compatibility_date = "2026-04-29"
pages_build_output_dir = ".vercel/output/static"

[[d1_databases]]
binding = "EVENT_STORE_DB"
database_name = "decole-d1-event-store"
database_id = "<wrangler d1 list>"

[[d1_databases]]
binding = "IDENTITY_DB"
database_name = "decole-d1-identity"
database_id = "<wrangler d1 list>"

[triggers]
crons = ["0 4 * * *"]
```

---

## Cron: `functions/scheduled.ts`

### GA4 Data API
1. Parsear `GA4_SERVICE_ACCOUNT_KEY` (client_email + private_key PEM)
2. Gerar JWT RS256 com `crypto.subtle` (Web Crypto API)
3. Trocar por `access_token` → `https://oauth2.googleapis.com/token`
4. POST `https://analyticsdata.googleapis.com/v1beta/properties/{GA4_PROPERTY_ID}:runReport`
   - dimensions: `eventName`, `customEvent:produto`
   - metrics: `eventCount`
   - filter: `eventName IN [page_view, cta_click, button_click]`
5. UPSERT em `ga4_daily_metrics`

### Meta Marketing API
1. Para cada produto (ESG + PlanoVoo):
   - `GET https://graph.facebook.com/v21.0/{AD_ACCOUNT_ID}/insights`
   - `fields=spend,impressions,cpm,cpc,ctr,actions,cost_per_action_type&time_increment=1`
   - `Authorization: Bearer {META_ACCESS_TOKEN}`
2. Extrair `link_click`, `landing_page_view`, `lead` de `actions[]`
3. UPSERT em `meta_daily_metrics`

---

## Secrets necessários

| Secret | Worker/Pages | Descrição |
|--------|-------------|-----------|
| `ADMIN_SECRET` | Pages | Password do dashboard |
| `GA4_SERVICE_ACCOUNT_KEY` | Pages | JSON do service account Google |
| `GA4_PROPERTY_ID` | Pages | ID numérico da propriedade GA4 |
| `META_ACCESS_TOKEN` | Pages | Token System User (Meta Business Manager) |
| `META_AD_ACCOUNT_ID_ESG` | Pages | `act_XXXXXXXXX` — conta ESG |
| `META_AD_ACCOUNT_ID_PLANOVOO` | Pages | `act_XXXXXXXXX` — conta PlanoVoo |

---

## Passos manuais obrigatórios (pré-implementação)

1. **GA4:** Google Cloud Console → criar service account → "Viewer" na propriedade GA4 → download JSON → obter ID numérico (GA4 Admin > Property Settings)
2. **Meta:** Meta Business Manager → System Users → criar System User → permissão `ads_read` nas contas de anúncios → gerar token permanente
3. **Meta Ad Account IDs:** Business Manager → contas de anúncios → copiar `act_XXXXXXXXX` de ESG e PlanoVoo
4. **D1 IDs:** `npx wrangler d1 list`
5. **DNS:** `dashboard.decolesuacarreiraesg.com.br` (Cloudflare Pages configura automaticamente)
6. **ADMIN_SECRET:** `openssl rand -hex 32`

---

## Verificação

```bash
# Aplicar schemas D1
bash backend/cloudflare/scripts/apply-d1-schema.sh

# Build + deploy Pages
cd decole-dashboard
npx @cloudflare/next-on-pages
npx wrangler pages deploy

# Testar cron manualmente
npx wrangler pages functions trigger decole-dashboard

# Abrir dashboard
open https://dashboard.decolesuacarreiraesg.com.br
```

### Sync on-demand (botão no dashboard)

O worker `decole-dashboard-sync` já suporta execução manual segura além do cron.

Endpoints:

- `POST /sync/run`
  - Auth: `Authorization: Bearer <SYNC_SECRET>` (ou header `x-sync-secret`)
  - Body JSON opcional:
    - `date`: `YYYY-MM-DD` (default: ontem UTC)
    - `part`: `all | ga4 | meta` (default: `all`)
  - Retorno:
    - `200 { ok: true, run_id, date, part }`
    - `409 { ok: false, error: "sync_already_running" }`
- `GET /sync/status`
  - Auth: igual acima
  - Retorno: último run (`running|ok|error`) com timestamps e erro, se houver.

Compatibilidade:

- `GET /sync?secret=...&date=YYYY-MM-DD` continua funcional para uso legado.

---

## Ficheiros afectados

| Acção | Caminho |
|-------|---------|
| CRIAR | `decole-dashboard/` (novo repo) |
| CRIAR | `backend/cloudflare/config/d1/ga4_daily_metrics.sql` |
| CRIAR | `backend/cloudflare/config/d1/meta_daily_metrics.sql` |
| MODIFICAR | `backend/cloudflare/scripts/apply-d1-schema.sh` |
