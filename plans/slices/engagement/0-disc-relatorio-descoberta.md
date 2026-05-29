# Relatório de Descoberta — GA4 / GTM Web / GTM Server / Meta

> Produzido em: 2026-05-29 | Slice: 0-disc | Estado: IN_PROGRESS → pronto para review
> Método: chamadas read-only via APIs com Service Account (`GOOGLE_APPLICATION_CREDENTIALS`) e `META_SYSTEM_USER_ACCESS_TOKEN`. Nenhum valor de secret exposto neste documento.

---

## 1. GA4 Custom Dimensions (property `507112601` / `G-BQQB6X5XN1`)

**Total registadas: 7 / 50 event-scoped**

| parameterName | scope | displayName |
|---|---|---|
| `cta_precheckout` | EVENT | cta_precheckout |
| `cta_label` | EVENT | cta_label |
| `cta_location` | EVENT | cta_location |
| `cta_type` | EVENT | cta_type |
| `cta_href` | EVENT | cta_href |
| `cta_id` | EVENT | cta_id |
| `produto` | EVENT | produto |

**Conclusões:**
- Todas as 7 são do padrão `cta_click` (já em produção). ✓
- `produto` confirma a dimensão usada em `dashboard-sync/src/ga4.ts` (`customEvent:produto`). ✓
- **43 slots livres** para os novos eventos de engajamento.
- A criar no slice **1I**: `section_id`, `section_name`, `section_index`, `visible_pct`, `time_visible_ms`, `vsl_version`, `vsl_section_key`, `video_time_sec`, `progress_pct` — 9 novas dimensões (total ficará em 16/50). ✓ sem risco de esgotar.

---

## 2. GTM Web (account `6266094107`, container `231314463`, workspace `21`)

### Tags existentes

| ID | Nome | Tipo |
|---|---|---|
| 51 | `GA4 - CTA Click` | `gaawe` (GA4 Event) |
| 15 | `Tag do Google Analytics` | `googtag` (GA4 Config) |
| 39 | `FB_CONVERSIONS_API-ESG-Web-Tag-GA4_Config` | `googtag` |
| 40 | `FB_CONVERSIONS_API-ESG-Web-Tag-GA4_Event` | `gaawe` |
| 41–43 | `FB_CONVERSIONS_API-ESG-Web-Tag-Pixel_Event/Setup/ParamBuilder` | `html` |
| 56–58 | `FB_CONVERSIONS_API-PLANOVOO-Web-Tag-*` | `html` |
| 12, 17, 18, 20 | tags Bio Insta (WhatsApp, PageView, TrafficSource, ButtonClick) | `gaawe` |

### Triggers existentes

| ID | Nome | Tipo |
|---|---|---|
| 44 | `CTA Click` | `customEvent` (`cta_click`) |
| 29 | `FB_CONVERSIONS_API-ESG-Web-Trigger-DOM_Ready` | `domReady` |
| 30 | `FB_CONVERSIONS_API-ESG-Web-Trigger-Custom_Event` | `customEvent` |
| 54 | `FB_CONVERSIONS_API-PLANOVOO-Web-Trigger-DOM_Ready` | `domReady` |
| 55 | `FB_CONVERSIONS_API-PLANOVOO-Web-Trigger-Custom_Event` | `customEvent` |
| 3, 4, 9, 19 | Bio Insta triggers | vários |

### Variables existentes

Variáveis `DL - *` já existentes (padrão do `cta_click`):
- `DL - cta_id` [45], `DL - cta_href` [46], `DL - cta_type` [47], `DL - cta_precheckout` [48], `DL - cta_location` [49], `DL - cta_label` [50], `DL - produto` [53]
- `GA4 Client ID` [21], `fbp` [27], `fbc` [28], `Meta PIXEL ID` [23] (constant)
- `User Agent` [16], + vars FB_CONVERSIONS_API (event_id, currency, items, etc.)

**Conclusões:**
- Padrão a replicar para `section_view`, `section_engaged`, `vsl_section_start`, `vsl_section_end` (opcional: `vsl_section_progress`): **trigger customEvent** + **vars `DL - <param>`** + **tag `gaawe`** + `measurementIdOverride = G-BQQB6X5XN1`.
- Variáveis já têm `DL - produto` [53] — reutilizar. Criar novas vars para: `section_id`, `section_name`, `section_index`, `visible_pct`, `time_visible_ms`, `vsl_version`, `vsl_section_key`, `video_time_sec`, `progress_pct`.
- `engagement_snapshot` **não** recebe tag GTM (vai direto para D1 via beacon, já definido no plano).
- Container tem room: 51 tags, 9 triggers, ~35 vars atualmente.

---

## 3. GTM Server (account `6266094107`, container `241313282`, workspace `16`)

**Container server está vazio** (nenhuma tag, trigger ou variável encontrada via API).

**Conclusões:**
- O sGTM existe como container criado mas ainda não configurado com tags de produção.
- A configuração de tags Meta CAPI server-side está atualmente no GTM **Web** (tags HTML `FB_CONVERSIONS_API-*-Web-Tag-Pixel_Event`). Isto é arquitetura web-to-sGTM: o pixel web envia para o sGTM, que encaminha para Meta.
- Para o slice **1J** (Meta seletivo): os eventos de alta intenção de engajamento serão adicionados ao mesmo padrão `FB_CONVERSIONS_API-*-Web-Trigger-Custom_Event` existente, ou ao GTM Server se este for instrumentado. **Decisão para 1J**: confirmar com o usuário se quer adicionar ao Web (mais simples, mantém o padrão) ou iniciar config do Server.

---

## 4. Meta Pixels

| Pixel | ID | Nome | Último disparo |
|---|---|---|---|
| DECOLE_ESG | `1329973348435032` | DECOLE sua carreira ESG | 2026-05-28 21:10 UTC |
| PLANOVOO | `2220600768748665` | Plano de Voo | 2026-05-28 21:54 UTC |

**Eventos ativos (últimas 24h, via `/stats?aggregation=event`):**
- DECOLE_ESG: `cta_click`, `PageView` (browser/pixel)
- PLANOVOO: `cta_click`, `PageView`, `InitiateCheckout`, `Lead`, `form_start`

**Custom Conversions:** nenhuma registada no ad account.

**API disponível para eventos custom:** a Graph API v21.0 não expõe endpoints como `/custom_events` ou `/events` de forma directa via System User token neste nível de permissão. Eventos padrão chegam via pixel/GTM (confirmado pelo `/stats`). Para registar eventos customizados de engajamento (ex. `VSLProgress75`, `SectionEngaged_Oferta`), o mecanismo é:
1. Browser: `fbq('trackCustom', 'VSLProgress75', {...})` via GTM Web (tag HTML ou custom template).
2. Server: CAPI via `META_CAPI_ACCESS_TOKEN_DECOLE_ESG`/`META_CAPI_ACCESS_TOKEN_PLANOVOO` (já em produção para outros eventos).

---

## 5. Deriva de Nomes de Credenciais — Catálogo vs `.env.local`

| Campo do catálogo | Nome no catálogo | Nome real em `.env.local` | Workers leem via catálogo? | Status |
|---|---|---|---|---|
| `ga4.apiSecretEnvVar` (ESG) | `GA4_API_SECRET_DECOLE` | `GA4_API_SECRET` | Sim (via catálogo→resolveSecret) | ⚠️ **DERIVA** |
| `ga4.measurementIdEnvVar` (ESG) | `GA4_MEASUREMENT_ID_DECOLE` | `GA4_MEASUREMENT_ID` | Sim | ⚠️ **DERIVA** |
| `dashboard.ga4.propertyIdEnv` | `GA4_PROPERTY_ID_DECOLE` | `GA4_PROPERTY_ID` | Sim (dashboard-sync) | ⚠️ **DERIVA** |
| `dashboard.ga4.serviceAccountKeyEnv` | `GA4_SERVICE_ACCOUNT_KEY_DECOLE` | `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_SERVICE_ACCOUNT_JSON` | Sim (dashboard-sync) | ⚠️ **DERIVA** |
| `metaCapi.accessTokenEnv` | `META_CAPI_ACCESS_TOKEN_DECOLE` | `META_CAPI_ACCESS_TOKEN_DECOLE_ESG` | Sim (emit_tracking) | ⚠️ **DERIVA** |
| `dashboard.metaAds.accessTokenEnv` | `META_ACCESS_TOKEN_DECOLE` | `META_SYSTEM_USER_ACCESS_TOKEN` | Sim (dashboard-sync) | ⚠️ **DERIVA** |
| `pixelIdEnvVar` | `META_PIXEL_ID_DECOLE_ESG` | `META_PIXEL_ID_DECOLE_ESG` | Sim | ✓ OK |
| `pixelIdEnvVar` (PLANOVOO) | `META_PIXEL_ID_PLANOVOO` | `META_PIXEL_ID_PLANOVOO` | Sim | ✓ OK |
| `sgtm.endpointEnvVar` (decole) | `SGTM_ENDPOINT_URL_DECOLE` | `SGTM_ENDPOINT_URL_DECOLE_ESG` | Sim | ⚠️ **DERIVA** |

**Resolução da deriva:**
- A runtime (Cloudflare Workers) usa as vars que estão em `wrangler.toml`/secrets, NÃO o `.env.local` local. Os nomes no `.env.local` são usados apenas no ambiente de desenvolvimento local e nos scripts de CI/CD.
- **Os nomes no catálogo são os que os workers realmente leem** — são passados como `envVar` e resolvidos via `resolveSecret(env, envVarName)`.
- **Para o .env.local local funcionar, deve ter os mesmos nomes que o catálogo** (ou aliases). O `.env.local` actual tem nomes simplificados (sem sufixo `_DECOLE`) que não batem com o catálogo.
- **Acção requerida no slice 1I/1H**: confirmar que o `.env.local` de desenvolvimento tem os nomes correctos conforme o catálogo, OU que os Cloudflare secrets estão com os nomes certos. **Não há necessidade de mudar o catálogo** — ele está correcto. O `.env.local` local é que tem nomes diferentes (não afecta produção, só o desenvolvimento local).

**Verificação imediata** — os nomes que o dashboard-sync usa:

```
GA4_PROPERTY_ID_DECOLE → workers/dashboard-sync/src/catalog.ts lê propertyIdEnv do catálogo
GA4_SERVICE_ACCOUNT_KEY_DECOLE → lê serviceAccountKeyEnv do catálogo
```

Se o secret no Cloudflare está como `GA4_PROPERTY_ID_DECOLE` (não `GA4_PROPERTY_ID`), produção funciona. O `.env.local` precisa ter `GA4_PROPERTY_ID_DECOLE=<valor>` para testes locais. **Recomendação**: adicionar aliases no `.env.local` local para desenvolvimento, ou actualizar `.env.local.example` quando existir.

---

## 6. Resumo para os slices seguintes

| Slice | O que fazer com base nesta descoberta |
|---|---|
| **1I** | Registar 9 dimensões GA4 (`section_id`, `section_name`, `section_index`, `visible_pct`, `time_visible_ms`, `vsl_version`, `vsl_section_key`, `video_time_sec`, `progress_pct`). 43 slots livres. |
| **1H** | Para cada evento (`section_view`, `section_engaged`, `vsl_section_start`, `vsl_section_end`): criar trigger `customEvent`, variáveis `DL - *` (reutilizar `DL - produto`), tag `gaawe` com `eventSettingsTable` — replicando o padrão do tag ID 51 (`GA4 - CTA Click`). |
| **1J** | Eventos custom Meta de alta intenção via **Web tags HTML** (padrão existente `FB_CONVERSIONS_API-*`); GTM Server está vazio mas pode ser configurado se desejado. Decidir com o utilizador. Eventos activos hoje: só `cta_click` e `PageView` (ESG) + `InitiateCheckout`, `Lead` (PLANOVOO). |
| **1H/1I/1J** | `.env.local` local precisa de aliases com nomes `*_DECOLE` para testes locais baterem com o catálogo. Não mudar o catálogo — ele está correcto. |
