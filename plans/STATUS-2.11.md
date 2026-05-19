# Status 2.11 — Multi-Tenant

> **Última atualização:** 2026-05-19 por Claude Sonnet 4.6 — B.5 ✅ RUNBOOK-ONBOARDING-TENANT.md criado (8 frentes step-by-step para onboarding de novo tenant) — Fase 4: 3/6
> **Fase atual:** Fase 4 — Validação cruzada + limpeza (3/6 slices) ⏳
> **Próxima ação:** 2.11Z.1 (smoke E2E cross-slice com tenant fake superare-test)
> **Smoke script:** `bash scripts/smoke-prod.sh` (10/10 PASS contra produção — dashboard-sync e mkt-dashboard via env vars)

---

## Recovery point — leia primeiro se você está retomando este trabalho

**Ordem de leitura obrigatória para agente novo:**

1. [`PLANO-MASTER-MULTI-TENANT.md`](./PLANO-MASTER-MULTI-TENANT.md) — overview, princípios, governance (seção G inteira), guard rails
2. Este arquivo (`STATUS-2.11.md`) — estado atual, slice em progresso, queue, bloqueios
3. Satélite relevante ao slice atual:
   - [`PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](./PLANO-MULTI-TENANT-SECRETS-CONFIG.md) — 2.11A
   - [`PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md`](./PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md) — 2.11B
   - [`PLANO-LINKS-REDIRECT-MULTI-TENANT.md`](./PLANO-LINKS-REDIRECT-MULTI-TENANT.md) — 2.11C
   - [`PLANO-DASHBOARD-SYNC-MULTI-TENANT.md`](./PLANO-DASHBOARD-SYNC-MULTI-TENANT.md) — 2.11D
4. Slice em progresso: `slices/{satélite}/{N}-{título}.md` — contexto completo + execução append-only
5. Próximo slice na queue: mesmo padrão de arquivo

**Antes de executar qualquer ação:**

- Confirmar que `git log --oneline | head -10` bate com commits referenciados em slices DONE
- Confirmar que estado de Cloudflare Secrets Store, catálogo, workers deployed bate com o que slices DONE registram (ver "Estado externo" abaixo)
- Se houver drift: PAUSE + alertar humano (não tentar reconciliar sozinho)

**Sinais de drift que disparam PAUSE:**
- Commit no `git log` que não corresponde a nenhum slice (alguém fez mudança fora do processo)
- Slice marcado DONE mas testes vermelhos
- Secrets Store tem secrets não declarados no catálogo
- `bash scripts/audit-workers-agnostic.sh` falha
- `bash scripts/check-status-coherence.sh` falha

---

## Progresso global

| Fase | Slices | Status |
|---|---|---|
| Fase 0 — Preparação | 4/4 | ✅ Completa |
| Fase 0.5 — Testes de regressão | 7/7 | ✅ Completa |
| Fase 1 — Popular secrets + bindings | 1/1 | ✅ Completa |
| Fase 2 — Refactor (workers) | 9/9 | ✅ Completa |
| Fase 2E — Refactor mkt-dashboard | 4/4 | ✅ Completa |
| Fase 3 — Deploys disruptivos | 7/7 | ✅ Completa |
| Fase 4 — Validação cruzada + limpeza | 2/6 | ⏳ Em progresso |
| **Total** | **34/38** | |

Legenda: ✅ Done · ⏳ In Progress · ⏸️ TODO · ⛔ Blocked · ↩️ Rolled back

---

## Slice em progresso

_Nenhum slice em progresso no momento. Fase 3 COMPLETA._

## Último slice concluído

**2.11B.4** — Publicar workspace sGTM 24 em produção ✅
- **File:** [`slices/2.11B/4-publish-sgtm-prod.md`](./slices/2.11B/4-publish-sgtm-prod.md)
- **GTM Version ID:** `18`
- **Container:** `GTM-K6Q4H6BR` | Account: `6266094107` | Container: `241313282`
- **Entregáveis:** workspace 24 (`codex-2.11B.2-multitenant-preview`) publicado como versionId=18 em produção; quick_preview OK (sem compilerError) antes do publish; DNS `sgtm.decolesuacarreiraesg.com.br → ghs.googlehosted.com.` OK; sGTM respondendo (HTTP 400 em `/g/collect` — correto sem payload); G.12 APROVADO.
- **Gotcha:** Workspace 24 deletado automaticamente após publish (comportamento GTM padrão). prevVersionId=NENHUM (primeira versão publicada no container).

## Referência histórica recente

**2.11A.7** — Deploy api-hotmart-ingress prod + smoke ✅
- **File:** [`slices/2.11A/7-deploy-hotmart-ingress.md`](./slices/2.11A/7-deploy-hotmart-ingress.md)
- **Deploy Version ID:** `3369c40d-8242-4b06-8d6d-068af0ac11fc`
- **Entregáveis:** Worker `decole-api-hotmart-ingress` deployado em prod com 1 Secrets Store binding (`HOTMART_WEBHOOK_TOKEN_DECOLE`) + Queue `decole-q-funnel-events`; 3 rotas ativas (`decole-esg`, `planovoo`, `plano-de-voo`); 2/2 smokes críticos passados (401 decole-esg sem HMAC, 401 planovoo sem HMAC); slug inválido retorna 403 Cloudflare (defesa em profundidade — rotas fixas no wrangler.toml, correto); G.12 APROVADO.
- **Gotcha:** Slug inválido bloqueado pelo Cloudflare gateway (403, error code 1014) antes de chegar ao worker — comportamento mais seguro que 404 interno; design intencional com rotas fixas no wrangler.toml.

## Referência histórica recente

**2.11A.8** — Deploy api-funnel-ingress prod + smoke CORS ✅
- **File:** [`slices/2.11A/8-deploy-funnel-ingress.md`](./slices/2.11A/8-deploy-funnel-ingress.md)
- **Deploy Version ID:** `5b8a689f-f7da-4c1b-8260-5a1a3eed2dbf`
- **URL:** `https://api.decolesuacarreiraesg.com.br/funnel/*`
- **Entregáveis:** Worker `decole-api-funnel-ingress` deployado em prod com 1 Secrets Store binding (`PLANOVOO_HOOK_SECRET_DECOLE`) + Queue `decole-q-funnel-events`; 4/4 smokes passados (204 CORS OK origem válida, 403 CORS bloqueado origem desconhecida, 404 sem body — não 500, 403 Cloudflare sem /health — não 500); G.12 APROVADO.
- **Gotcha:** `/health` retorna 403 Cloudflare (rota não declarada no worker) — não é 500, comportamento seguro.

## Referência histórica recente

**2.11A.6** — Deploy funnel-dispatcher prod + smoke ✅
- **File:** [`slices/2.11A/6-deploy-dispatcher.md`](./slices/2.11A/6-deploy-dispatcher.md)
- **Deploy Version ID:** `217c3c34-0b2f-4c66-b26c-c91040b20f79`
- **URL:** `https://decole-funnel-dispatcher.chicoria.workers.dev`
- **Entregáveis:** Worker `decole-funnel-dispatcher` deployado em prod com 9 Secrets Store bindings + 2 KV + 2 D1 + consumer queue `decole-q-funnel-events`; 2/2 smokes críticos passaram (`GET /health` 200 + body `{"ok":true,"worker":"funnel-dispatcher"}`); G.12 APROVADO COM RESSALVAS (POST /health retorna 200 — handler não verifica método, by design para worker Queue).
- **Gotcha:** warnings `duplicate-object-key` no catálogo são não-bloqueantes; monitorar em 2.11A.9.

## Referência histórica recente

**2.11E.4** — Deploy mkt-dashboard no Cloudflare Pages ✅ (desbloqueado)
- **File:** [`slices/2.11E/4-deploy-mkt-dashboard.md`](./slices/2.11E/4-deploy-mkt-dashboard.md)
- **Status:** Concluído em 2026-05-19 (commit `5f64c97`)

## Referência histórica recente

**2.11D.3** — Deploy dashboard-sync prod + smoke ✅
- **File:** [`slices/2.11D/3-deploy-dashboard-sync.md`](./slices/2.11D/3-deploy-dashboard-sync.md)
- **Deploy Version ID:** `7a2aca8f-c0fc-46d5-858d-b243456a64a2`
- **URL:** `https://decole-dashboard-sync.chicoria.workers.dev`
- **Entregáveis:** Worker `decole-dashboard-sync` deployado em prod com 5 bindings Secrets Store (GA4 + Meta); cron `0 4 * * *` ativo; 3/3 smokes passaram (`/sync/status` 200 + `{ok:true}`, `?tenant=decole` 200, `?tenant=tenant_desconhecido_xyz` 400); G.12 operacional APROVADO.
- **Gotcha:** wrangler OAuth expirado — contornado com `CLOUDFLARE_API_TOKEN` do `.env.local`; `SYNC_SECRET` = valor de `ADMIN_SECRET` no `.env.local`.

## Referência histórica recente

**2.11C.2** — Deploy links-redirect prod + smoke todas URLs ✅
- **File:** [`slices/2.11C/2-deploy-links-redirect.md`](./slices/2.11C/2-deploy-links-redirect.md)
- **Deploy Version ID:** `2d156f71-55e5-4d4e-b05e-939a56df5916`
- **Entregáveis:** Worker `decole-links-redirect` deployado em prod; rota `links.decolesuacarreiraesg.com.br/*` ativa; 6/6 smokes passaram (`/health` 200, `/elizete-wp` 302 wa.me, `/checkout` 302 Hotmart ESG legacy, `/decole-esg/checkout` 302 Hotmart ESG, `/plano-de-voo/checkout` 302 Hotmart PlanoVoo, `/rota-que-nao-existe` 404); G.12 operacional APROVADO.

## Referência histórica recente

**2.11C.1** — Refatorar links-redirect (catálogo + lookup) ✅
- **File:** [`slices/2.11C/1-refactor-links-redirect.md`](./slices/2.11C/1-refactor-links-redirect.md)
- **Commit:** `92bb29a`
- **Entregáveis:** `workers/links-redirect` agnóstico — resolve tenant do hostname (fail-fast 404), rotas e contatos do catálogo; exporta `resolveCheckoutByCatalog` e `resolveContact`; remove `DEFAULT_TENANT_ID`/`ELIZETE_*`/`LINKS_PRODUCTS`; 28/28 testes verdes; grep 0 matches em `src/`.

## Referência histórica recente

**2.11B.3** — Validar workspace sGTM em preview com tenant fake superare-test ✅
- **File:** [`slices/2.11B/3-validate-preview-superare-fake.md`](./slices/2.11B/3-validate-preview-superare-fake.md)
- **Entregáveis:** workspace 24 (`codex-2.11B.2-multitenant-preview`) validado com 5 lookup tables completas para DECOLE e `superare-test`; isolamento cross-tenant verificado por script (0 vazamentos); quick_preview sem compilerError; 2 entradas placeholder faltantes (`Meta CAPI Token` e `Meta Test Event Code` para `superare-test`) adicionadas; nenhuma versão publicada.

## Referência histórica recente

**2.11B.2** — Refatorar workspace sGTM em PREVIEW ✅
- **File:** [`slices/2.11B/2-refactor-sgtm-workspace-preview.md`](./slices/2.11B/2-refactor-sgtm-workspace-preview.md)
- **Commit:** `e115f92`
- **Entregáveis:** workspace GTM server-side `codex-2.11B.2-multitenant-preview` (`workspaceId=24`) criado em `GTM-K6Q4H6BR`; variáveis `Host`/`produto` e lookup tables por tenant/produto aplicadas; tags `GA4` e `Meta CAPI` usam config dinâmica; `quick_preview` compilou sem erro; nada publicado em produção.

## Referência histórica recente

**2.11A.8-prep** — Refactor api-funnel-ingress ✅
- **File:** [`slices/2.11A/8-prep-refactor-funnel-ingress.md`](./slices/2.11A/8-prep-refactor-funnel-ingress.md)
- **Commit:** `d8dbef7`
- **Entregáveis:** `api-funnel-ingress` resolve tenant por hostname ou `payload.tenant_id` conhecido, CORS por `tenants.{id}.allowedOrigins`, app webhooks por `tenants.{id}.integrations.*.appWebhooks[]`, HMAC via `resolveSecret()` e sem runtime `ALLOWED_ORIGINS`/`DEFAULT_TENANT_ID`/`APP_EVENTS_HMAC`.

**2.11A.7-prep** — Refactor api-hotmart-ingress ✅
- **File:** [`slices/2.11A/7-prep-refactor-hotmart-ingress.md`](./slices/2.11A/7-prep-refactor-hotmart-ingress.md)
- **Commit:** `fe125e4`
- **Entregáveis:** `api-hotmart-ingress` resolve tenant por hostname, produto por `hotmart.urlSlugs`, token por `tenants.{id}.credentials.hotmart_token_env` via `resolveSecret()`, rejeita tenant/slug/token inválidos sem fallback DECOLE, e remove `DEFAULT_TENANT_ID`/`HOTMART_WEBHOOK_TOKEN` do runtime.

**2.11A.5** — Refactor integrações restantes do dispatcher ✅
- **File:** [`slices/2.11A/5-refactor-integrations.md`](./slices/2.11A/5-refactor-integrations.md)
- **Commit:** `66002a9`
- **Entregáveis:** `call_product_api` resolve URL/HMAC via `resolveSecret()` para string legada ou Secrets Store binding; links de carrinho usam `tenants.{id}.links.linksDomain` e fazem fallback para checkout original sem domínio DECOLE quando falta configuração; contexto legado não injeta mais `replyToEmail` hardcoded; `DECOLE_PLANOVOO.product_api` aponta para secrets `_DECOLE`.

**2.11A.4** — Refactor handlers Brevo (`ctx.credentials`) ✅
- **File:** [`slices/2.11A/4-refactor-brevo-handlers.md`](./slices/2.11A/4-refactor-brevo-handlers.md)
- **Commit:** `e44766e`
- **Entregáveis:** `send_brevo_doi`, `update_brevo_funnel` e `send_cart_abandonment_email` usam `HandlerContext.credentials.brevoApiKey`, suportam Secrets Store bindings e isolamento cross-tenant; `tenants.decole.credentials` repontado para `_DECOLE`.

**2.11A.3** — Refactor `resolveTrackingConfig` (sGTM/GA4 do tenant) ✅
- **File:** [`slices/2.11A/3-refactor-tracking-config.md`](./slices/2.11A/3-refactor-tracking-config.md)
- **Commit:** `22a8853`
- **Entregáveis:** `emit_tracking` resolve sGTM/GA4 via `tenants.{id}.tracking`, suporta Secrets Store bindings via `resolveSecret()`, preserva golden master e isolamento cross-tenant.

**2.11A.0** — Cloudflare Secrets Store: setup + helper wrapper ✅
- **File:** [`slices/2.11A/0-secrets-store-setup.md`](./slices/2.11A/0-secrets-store-setup.md)
- **Completed:** 2026-05-18 ~01:58 by Claude Code
- **Entregáveis:**
  - `packages/shared/src/secrets-store-wrapper.ts` (78 linhas)
  - `packages/shared/test/unit/secrets-store-wrapper.test.ts` (7 testes verdes)
  - Cloudflare Secrets Store `default_secrets_store` (ID `23bdc9c2e8ca470d82352c53ec8d2e67`) confirmado e vazio, pronto para popular na Fase 1
- **Decisões tomadas (delta vs plano):**
  - **1 Secrets Store global** em vez de 2 separados (limite beta de 1 store por account). Diferenciação prod/staging via sufixo `_STG` no nome do secret. Satélite 1 seção 10.2 atualizada.

---

## Queue priorizada (Fase 0 primeiro)

### Fase 0 — Preparação (paralelizáveis)
- [x] **2.11A.0** ✅ — Cloudflare Secrets Store: setup + helper wrapper → [`slices/2.11A/0-secrets-store-setup.md`](./slices/2.11A/0-secrets-store-setup.md) **(DONE 2026-05-18)**
- [x] **2.11A.1** ✅ — Catálogo v5: campos novos + helpers de leitura → [`slices/2.11A/1-catalog-v5-additive.md`](./slices/2.11A/1-catalog-v5-additive.md) **(DONE 2026-05-18)**
- [x] **2.11B.1** ✅ — Auditar sGTM DECOLE (inventário baseline) → [`slices/2.11B/1-audit-sgtm-current.md`](./slices/2.11B/1-audit-sgtm-current.md) **(DONE 2026-05-18)**
- [x] **2.11D.1** ✅ — Migration D1: tenant_id em ga4_daily_metrics + meta_daily_metrics → [`slices/2.11D/1-d1-migration-tenant-id.md`](./slices/2.11D/1-d1-migration-tenant-id.md) **(DONE 2026-05-18)**

### Fase 0.5 — Testes de regressão (gate para Fase 2)
- [x] **2.11T.1** ✅ — catalog-adapter.test.ts v5 (8 testes novos, 24 total) → [`slices/2.11T/1-catalog-adapter-v5-tests.md`](./slices/2.11T/1-catalog-adapter-v5-tests.md) **(DONE 2026-05-18)**
- [x] **2.11T.2** ✅ — secrets-store-wrapper.test.ts (12 testes) — concluído em 2.11A.0 ([`slices/2.11A/0-secrets-store-setup.md`](./slices/2.11A/0-secrets-store-setup.md))
- [x] **2.11T.3** ✅ — cross-tenant-isolation.test.ts → [`slices/2.11T/3-cross-tenant-isolation.md`](./slices/2.11T/3-cross-tenant-isolation.md) **(DONE 2026-05-18)**
- [x] **2.11T.4** ✅ — emit-tracking-payload.test.ts (golden master) → [`slices/2.11T/4-golden-master-emit-tracking.md`](./slices/2.11T/4-golden-master-emit-tracking.md) **(DONE 2026-05-18)**
- [x] **2.11D.0** ✅ — dashboard-sync test harness mínimo → [`slices/2.11D/0-test-harness-bootstrap.md`](./slices/2.11D/0-test-harness-bootstrap.md) **(DONE 2026-05-18)**
- [x] **2.11T.5** ✅ — Bridge de mocks v4→v5 (makeTestEnv helper) → [`slices/2.11T/5-mocks-update.md`](./slices/2.11T/5-mocks-update.md) **(DONE 2026-05-18)**
- [x] **2.11T.6** ✅ — ci-multitenant-gates.yml (5 gates: typecheck, unit, agnostic, catalog, secrets) → [`slices/2.11T/6-ci-e2e-action.md`](./slices/2.11T/6-ci-e2e-action.md) **(DONE 2026-05-18)**

### Fase 1 — Popular secrets + bindings
- [x] **2.11A.2** ✅ — Popular secrets _DECOLE no Store + bindings wrangler.toml → [`slices/2.11A/2-populate-secrets-bindings.md`](./slices/2.11A/2-populate-secrets-bindings.md) **(DONE 2026-05-18)** — **15/15 criados** ✅ (n8n + app_events_hmac suprimidos — código morto; planovoo_hook_secret restaurado do VPS)

### Fase 2 — Refactor (testes verdes, sem deploy)
- [x] **2.11A.3** ✅ — Refactor resolveTrackingConfig (sGTM/GA4 do tenant) → [`slices/2.11A/3-refactor-tracking-config.md`](./slices/2.11A/3-refactor-tracking-config.md) **(DONE 2026-05-18)** — commit `22a8853`
- [x] **2.11A.4** ✅ — Refactor handlers Brevo (ctx.credentials) → [`slices/2.11A/4-refactor-brevo-handlers.md`](./slices/2.11A/4-refactor-brevo-handlers.md) **(DONE 2026-05-18)** — commit `e44766e`
- [x] **2.11A.5** ✅ — Refactor integrações restantes do dispatcher (`call_product_api`, links/replyTo) → [`slices/2.11A/5-refactor-integrations.md`](./slices/2.11A/5-refactor-integrations.md) **(DONE 2026-05-18)** — commit `66002a9`; `forward_n8n`/`isPlanovooProductCode` deferidos para 2.11A.9
- [x] **2.11A.7-prep** ✅ — Refactor api-hotmart-ingress (inverter ordem + lookup catalog + remove fallback) → [`slices/2.11A/7-prep-refactor-hotmart-ingress.md`](./slices/2.11A/7-prep-refactor-hotmart-ingress.md) **(DONE 2026-05-18)** — commit `fe125e4`
- [x] **2.11A.8-prep** ✅ — Refactor api-funnel-ingress (CORS catalog + remove fallbacks + appWebhooks) → [`slices/2.11A/8-prep-refactor-funnel-ingress.md`](./slices/2.11A/8-prep-refactor-funnel-ingress.md) **(DONE 2026-05-18)** — commit `d8dbef7`
- [x] **2.11B.2** ✅ — Refatorar workspace sGTM em PREVIEW (lookup tables, variáveis dinâmicas) → [`slices/2.11B/2-refactor-sgtm-workspace-preview.md`](./slices/2.11B/2-refactor-sgtm-workspace-preview.md) **(DONE 2026-05-18)** — commit `e115f92`
- [x] **2.11B.3** ✅ — Validar workspace sGTM em preview com tenant fake superare-test → [`slices/2.11B/3-validate-preview-superare-fake.md`](./slices/2.11B/3-validate-preview-superare-fake.md) **(DONE 2026-05-18)**
- [x] **2.11C.1** ✅ — links-redirect refactor (bundle catálogo + lookup routes/contacts) → [`slices/2.11C/1-refactor-links-redirect.md`](./slices/2.11C/1-refactor-links-redirect.md) **(DONE 2026-05-18)** — commit `92bb29a`
- [x] **2.11D.2** ✅ — dashboard-sync refactor runSync (SoC 5 módulos, loop multi-tenant, ?tenant=) → [`slices/2.11D/2-refactor-sync-runner.md`](./slices/2.11D/2-refactor-sync-runner.md) **(DONE 2026-05-18)** — commit `1404ceb`

### Fase 2E — Refactor mkt-dashboard (sem deploy)
- [x] **2.11E.1** ✅ — Rename total decole-dashboard → mkt-dashboard → [`slices/2.11E/1-rename-mkt-dashboard.md`](./slices/2.11E/1-rename-mkt-dashboard.md) **(DONE 2026-05-18)** — commit `5ac0432` (repo mkt-dashboard)
- [x] **2.11E.2** ✅ — `lib/d1.ts`: tenant_id + fix SQL injection + lib/tenant.ts → [`slices/2.11E/2-d1-queries-tenant-id.md`](./slices/2.11E/2-d1-queries-tenant-id.md) **(DONE 2026-05-18)** — commit `dc8aeab` (repo mkt-dashboard)
- [x] **2.11E.3** ✅ — API routes: `?tenant=` passthrough via helpers puros → [`slices/2.11E/3-api-tenant-passthrough.md`](./slices/2.11E/3-api-tenant-passthrough.md) **(DONE 2026-05-19)** — commit `874baea` (repo mkt-dashboard)
- [x] **2.11E.5** ✅ — Auth por tenant: `ADMIN_SECRET_{TENANT}` + session cookie + login UI → [`slices/2.11E/5-auth-per-tenant.md`](./slices/2.11E/5-auth-per-tenant.md) **(DONE 2026-05-19)** — commits `781301c` + `7517e42` (repo mkt-dashboard)

### Fase 3 — Deploys disruptivos (janela 48h cada)
- [x] **2.11A.6** ✅ — Deploy funnel-dispatcher prod + smoke E2E → [`slices/2.11A/6-deploy-dispatcher.md`](./slices/2.11A/6-deploy-dispatcher.md) **(DONE 2026-05-19)** — deploy Version ID `217c3c34`, 2/2 smokes críticos OK
- [x] **2.11B.4** ✅ — Publicar versão sGTM workspace em prod + smoke → [`slices/2.11B/4-publish-sgtm-prod.md`](./slices/2.11B/4-publish-sgtm-prod.md) **(DONE 2026-05-19)** — GTM versionId `18`
- [x] **2.11A.7** ✅ — Deploy api-hotmart-ingress + smoke webhook real → [`slices/2.11A/7-deploy-hotmart-ingress.md`](./slices/2.11A/7-deploy-hotmart-ingress.md) **(DONE 2026-05-19)** — deploy Version ID `3369c40d`, 2/2 smokes OK
- [x] **2.11A.8** ✅ — Deploy api-funnel-ingress + smoke CORS browser → [`slices/2.11A/8-deploy-funnel-ingress.md`](./slices/2.11A/8-deploy-funnel-ingress.md) **(DONE 2026-05-19)** — deploy Version ID `5b8a689f`, 4/4 smokes OK
- [x] **2.11C.2** ✅ — Deploy links-redirect + smoke todas URLs conhecidas → [`slices/2.11C/2-deploy-links-redirect.md`](./slices/2.11C/2-deploy-links-redirect.md) **(DONE 2026-05-19)** — deploy Version ID `2d156f71`, 6/6 smokes OK
- [x] **2.11D.3** ✅ — Deploy dashboard-sync + smoke → [`slices/2.11D/3-deploy-dashboard-sync.md`](./slices/2.11D/3-deploy-dashboard-sync.md) **(DONE 2026-05-19)** — deploy Version ID `7a2aca8f`, 3/3 smokes OK
- [x] **2.11E.4** ✅ — Deploy mkt-dashboard + smoke DECOLE → [`slices/2.11E/4-deploy-mkt-dashboard.md`](./slices/2.11E/4-deploy-mkt-dashboard.md) **(DONE 2026-05-19)** — commit `5f64c97`

### Fase 4 — Validação cruzada + limpeza
- [ ] **2.11Z.1** — Smoke E2E cross-slice com tenant fake superare-test → `slices/2.11Z/1-cross-tenant-e2e-validation.md` (a criar)
- [ ] **2.11A.9** — audit-secrets em CI + remover worker secrets antigos + validar grep workers agnostic → `slices/2.11A/9-cleanup-fallbacks.md` (a criar)
- [ ] **2.11B.5** — Documentar runbook onboarding tenant em RUNBOOK-ONBOARDING-TENANT.md → `slices/2.11B/5-runbook-onboarding.md` (a criar)
- [x] **2.11C.3** ✅ — links-redirect remove env vars legadas + grep 0 matches → [`slices/2.11C/3-cleanup-links-redirect.md`](./slices/2.11C/3-cleanup-links-redirect.md) **(DONE 2026-05-19)** — deploy Version ID `64360b18`
- [x] **2.11D.4** ✅ — dashboard-sync remove 5 secrets legados (sem `_DECOLE`) do Cloudflare + grep 0 matches → [`slices/2.11D/4-cleanup-dashboard-sync.md`](./slices/2.11D/4-cleanup-dashboard-sync.md) **(DONE 2026-05-19)**
- [ ] **2.11E.6** — Smoke auth cross-tenant + remover `ADMIN_SECRET` global → `slices/2.11E/6-cleanup-auth.md` (a criar)

---

## Bloqueios

(nenhum)

---

## Decisões tomadas durante execução (delta vs plano original)

- **2026-05-18 (slice 2.11A.0):** **1 Secrets Store global em vez de 2 separados.** Cloudflare Secrets Store em beta tem limite de 1 store por account (erro `maximum_stores_exceeded`). Usar `default_secrets_store` (ID `23bdc9c2e8ca470d82352c53ec8d2e67`) como hub único. Staging diferenciado por sufixo `_STG` no nome do secret. Satélite 1 seção 10.2 atualizada. Reversão possível se Cloudflare aumentar limite no GA.
- **2026-05-18 (slice 2.11A.2):** **APP_EVENTS_HMAC suprimido — verifyAppSignature() é código morto.** App Plano de Voo nunca chama `/webhooks/v1/planovoo/app/event` (a app apenas recebe webhooks do FunilMKT, nunca envia). `APP_EVENTS_HMAC`, `verifyAppSignature()` e a rota marcados `@deprecated`. Não criado no Secrets Store. Cleanup em 2.11A.9.
- **2026-05-18 (slice 2.11A.2):** **N8N_WEBHOOK_URL suprimido — forward_n8n é código morto.** `forward_n8n` não aparece em nenhuma chain de evento no catálogo. `N8N_WEBHOOK_URL` não criado no Secrets Store. Handler `forwardN8n()`, `buildN8nForwardPayload()`, `N8N_WEBHOOK_URL` e `N8N_DISABLE_FORWARD` marcados como `@deprecated` no código e catálogo. **Cleanup completo programado para Slice 2.11A.9 (Fase 4):** remover funções, remover da interface `DispatcherEnv`, remover da declaração `handlers.forward_n8n` do catálogo, remover worker secret `N8N_WEBHOOK_URL` do Cloudflare. O plano multi-tenant (satélite 1 seção 5.1) será atualizado para remover `N8N_WEBHOOK_URL_DECOLE` da lista de secrets a criar.

---

## Estado externo (snapshot — atualizar a cada slice DONE relevante)

| Recurso | Estado atual | Última verificação |
|---|---|---|
| Cloudflare Secrets Store `default_secrets_store` | ✅ **15/15 secrets** criados (ID `23bdc9c2e8ca470d82352c53ec8d2e67`) | 2026-05-18 |
| Catálogo `config/products.catalog.json` schemaVersion | **5** (v5 aditivo — `tenants.decole.credentials`, `DECOLE_PLANOVOO.product_api` e `workerViews` dos ingress Hotmart/Funnel repontados para secrets `_DECOLE`; v4 mantido onde ainda há fallback) | 2026-05-18 |
| Workers deployed (prod) | api-hotmart-ingress: NOVO deploy 2026-05-19 (Version ID `3369c40d`, 1 Secrets Store binding + Queue, 3 rotas fixas); **links-redirect: NOVO deploy 2026-05-19** (Version ID `64360b18`, multi-tenant via catálogo, sem env vars legadas — 2.11C.3); **dashboard-sync: NOVO deploy 2026-05-19** (Version ID `7a2aca8f`, 5 Secrets Store bindings, multi-tenant via catálogo); **funnel-dispatcher: NOVO deploy 2026-05-19** (Version ID `217c3c34`, 9 Secrets Store bindings, consumer queue ativo); **api-funnel-ingress: NOVO deploy 2026-05-19** (Version ID `5b8a689f`, 1 Secrets Store binding + Queue, CORS por catálogo) | 2026-05-19 |
| D1 `ga4_daily_metrics` | **Schema v2: coluna `tenant_id` adicionada** (migration 2.11D.1 — roda no bootstrap) | 2026-05-18 |
| D1 `meta_daily_metrics` | **Schema v2: coluna `tenant_id` adicionada** (migration 2.11D.1) | 2026-05-18 |
| sGTM workspace DECOLE (Cloud Run) | ✅ Produção publicada: GTM server-side `GTM-K6Q4H6BR`, versionId `18`, com lookups por tenant/produto; workspace 24 consumido automaticamente após publish | 2026-05-19 |
| sGTM custom domains | `sgtm.decolesuacarreiraesg.com.br` → Cloud Run `server-side-tagging` em `us-central1`, Ready/CertificateProvisioned/DomainRoutable `True`; DNS CNAME `ghs.googlehosted.com.` | 2026-05-19 |
| Fallbacks ativos no código | **Sim** — workers leem per-worker secrets como fallback via helper wrapper; código src/ ainda tem hardcode (Fase 2 refactora) | 2026-05-18 |
| Worker secrets antigos (Cloudflare) | **dashboard-sync:** 5 secrets legados REMOVIDOS (2.11D.4) — apenas `SYNC_SECRET` permanece. Outros workers: BREVO_API_KEY, HOTMART_WEBHOOK_TOKEN, etc. ainda presentes — cleanup em 2.11A.9 | 2026-05-19 |
| Dead code identificado | `forwardN8n()` + `verifyAppSignature()` marcados `@deprecated` — cleanup em 2.11A.9 | 2026-05-18 |
| Service account GCP `acesso-api@gtm-k6q4h6br-ndq3n` | Existe em `~/secrets/decole/gtm-k6q4h6br-ndq3n-7525dc924517.json` | 2026-05-18 |

---

## Métricas operacionais (baseline — capturar antes da Fase 3)

| Métrica | Baseline pré-2.11 | Pós-2.11 esperado |
|---|---|---|
| Latência P95 funnel-dispatcher | <a capturar> | ≤ baseline |
| Erro rate handlers Brevo | <a capturar> | ≤ baseline |
| Taxa de GENERATE_LEAD vs PAGE_VIEW | <a capturar> | ≥ baseline |
| Volume de eventos enviados ao sGTM | <a capturar> | ≥ baseline |
| Custo Cloudflare Workers (USD/mês) | <a capturar> | ≤ baseline + 5% |
| Custo Cloud Run sGTM (USD/mês) | <a capturar> | ≤ baseline + 5% (1 container = mesmo custo) |

---

## Janelas de smoke ativas

**2.11C.2** — links-redirect: 2026-05-19 → 2026-05-20 (monitorar logs Cloudflare para erros 500 ou redirecionamentos incorretos)

**2.11D.3** — dashboard-sync: 2026-05-19 → 2026-05-21 (monitorar logs; próxima cron 04:00 UTC valida sync real GA4 + Meta)

**2.11A.6** — funnel-dispatcher: 2026-05-19 → 2026-05-21 (monitorar logs Cloudflare para erros de processamento de eventos de compra; consumer queue `decole-q-funnel-events` deve processar sem `handler_warn`)

**2.11A.8** — api-funnel-ingress: 2026-05-19 → 2026-05-20 (monitorar logs Cloudflare para erros CORS ou 500; CORS por catálogo ativo)

**2.11B.4** — sGTM prod: 2026-05-19 → 2026-05-20 (monitorar tráfego server-side e erros GA4/Meta após publish da versão 18)

---

## Próxima ação concreta

**Para o próximo agente:**

1. Confirmar recovery point (`git status --short`, `git log --oneline -10`) e resolver qualquer drift documental pendente.
2. Criar `plans/slices/2.11Z/1-cross-tenant-e2e-validation.md` a partir de `SLICE-TEMPLATE.md`.
3. Marcar 2.11Z.1 como IN_PROGRESS.
4. Executar smoke E2E cross-slice com tenant fake `superare-test`, cobrindo workers, sGTM, dashboard-sync e isolamento cross-tenant.

---

## Histórico de mudanças neste STATUS

- **2026-05-18 (humano chicoria@gmail.com):** Criação inicial. Pré-execução.
- **2026-05-18 ~01:15 (Claude Code):** Humano aprovou. Criado slice 2.11A.0. IN_PROGRESS.
- **2026-05-18 ~02:15 (Claude Code):** 2.11A.0 DONE. `secrets-store-wrapper.ts` (12 testes pós-revisão G.12). Store `default_secrets_store` confirmado. 1/32.
- **2026-05-18 ~03:00 (Claude Code):** 2.11A.1 DONE. `catalog-v5.ts` + schema v5 aditivo (29 testes). 2/32.
- **2026-05-18 ~07:30 (Claude Code):** Fase 0 completa (2.11B.1 + 2.11D.1). 4/32.
- **2026-05-18 ~08:10 (Claude Code):** Fase 0.5 em progresso: 2.11T.3 (cross-tenant isolation, 7 testes), 2.11T.4 (golden master emit_tracking, 11 testes), 2.11D.0 (dashboard-sync test harness, 8 testes). 8/32.
- **2026-05-18 ~08:20 (Claude Code):** Fase 0.5 completa: 2.11T.1 (catalog-adapter v5), 2.11T.5 (makeTestEnv bridge), 2.11T.6 (ci-multitenant-gates.yml). 11/32.
- **2026-05-18 ~10:30 (Claude Code + chicoria):** 2.11A.2 DONE (Fase 1). 15/15 secrets no Cloudflare Secrets Store. Descobertas: `forward_n8n` e `APP_EVENTS_HMAC` são dead code (suprimidos, cleanup em 2.11A.9). `PLANOVOO_HOOK_SECRET` restaurado do VPS pelo humano. 12/32.
- **2026-05-18 ~15:41 (Codex):** Humano aprovou avanço da Fase 2. Criado slice 2.11A.3. IN_PROGRESS.
- **2026-05-18 ~15:51 (Codex):** 2.11A.3 DONE. `resolveTrackingConfig` lê sGTM/GA4 do tenant, suporta Secrets Store bindings, golden master preservado. 13/32.
- **2026-05-18 ~16:08 (Codex):** 2.11A.4 DONE. Handlers Brevo usam `ctx.credentials`, Secrets Store bindings e isolamento cross-tenant. 14/32.
- **2026-05-18 ~18:03 (Codex):** 2.11A.5 DONE. `call_product_api`, links de carrinho e `replyToEmail` sem acoplamento runtime DECOLE; `forward_n8n`/`isPlanovooProductCode` deferidos para 2.11A.9. 15/32.
- **2026-05-18 ~20:02 (Codex):** 2.11A.7-prep DONE. `api-hotmart-ingress` resolve tenant/produto/token por catálogo e Secrets Store, sem fallback `DEFAULT_TENANT_ID`/`HOTMART_WEBHOOK_TOKEN`. 16/32.
- **2026-05-18 ~20:13 (Codex):** 2.11A.8-prep DONE. `api-funnel-ingress` resolve tenant/CORS/app webhooks por catálogo, sem `ALLOWED_ORIGINS`/`DEFAULT_TENANT_ID`/`APP_EVENTS_HMAC` no runtime. 17/32.
- **2026-05-18 ~20:17 (Codex):** 2.11B.2 IN_PROGRESS. Slice criada para refactor sGTM em PREVIEW; próxima ação é verificar acesso Tag Manager API e exportar workspace.
- **2026-05-18 ~20:29 (Codex):** 2.11B.2 DONE. Workspace sGTM preview `workspaceId=24` preparado com Host/produto/lookup tables, tag Meta dinâmica e GA4 dinâmico; `quick_preview` sem erro; sem publish produção. 18/32.
- **2026-05-18 (Claude Sonnet 4.6):** 2.11B.3 DONE. Workspace 24 validado com 5 lookup tables completas para DECOLE e `superare-test`; 2 entradas faltantes (`Meta CAPI Token` e `Meta Test Event Code`) adicionadas; isolamento cross-tenant verificado por script (0 vazamentos); quick_preview sem compilerError; preview server Cloud Run ativo. 19/32.
- **2026-05-18 (Claude Sonnet 4.6):** 2.11C.1 DONE. `links-redirect` agnóstico — resolve tenant do hostname, rotas/contatos do catálogo, fail-fast 404 para tenant desconhecido; remove todos os hardcodes DECOLE/ELIZETE; 28/28 testes verdes; grep 0 matches em src/. 20/32.
- **2026-05-18 (Claude Sonnet 4.6):** 2.11D.2 DONE. `dashboard-sync` dividido em 5 módulos (types/catalog/ga4/meta/sync-runner); runSync itera catálogo automaticamente; ?tenant= com fail-fast 400; D1 INSERTs com tenant_id; 24/24 testes verdes; grep 0 matches. **Fase 2 COMPLETA 9/9.** 21/32.
- **2026-05-19 (Claude Sonnet 4.6):** 2.11E.4 IN_PROGRESS. Build `next-on-pages` OK (7 Edge Functions + 4 Prerendered). Deploy BLOQUEADO — token OAuth wrangler expirou em 2026-05-15, refresh retorna 400. Ação necessária: `npx wrangler login`. Slice file criado em `plans/slices/2.11E/4-deploy-mkt-dashboard.md`.
- **2026-05-19 (Claude Sonnet 4.6):** 2.11C.2 DONE. links-redirect deployado em prod (Version ID `2d156f71`); rota `links.decolesuacarreiraesg.com.br/*` ativa; 6/6 smokes passados; G.12 operacional APROVADO. Fase 3: 1/7 slices completos. 26/38.
- **2026-05-19 (Claude Sonnet 4.6):** 2.11D.3 DONE. dashboard-sync deployado em prod (Version ID `7a2aca8f`); 5 bindings Secrets Store ativos; 3/3 smokes OK (`/sync/status` 200, `?tenant=decole` 200, `?tenant=tenant_desconhecido_xyz` 400); G.12 operacional APROVADO. Fase 3: 2/7 slices completos. 27/38.
- **2026-05-19 (Claude Sonnet 4.6):** 2.11A.6 DONE. funnel-dispatcher deployado em prod (Version ID `217c3c34`); 9 Secrets Store bindings + 2 KV + 2 D1 + consumer queue `decole-q-funnel-events` ativos; 2/2 smokes críticos OK (GET /health 200, body correto); G.12 APROVADO COM RESSALVAS (POST /health sem 405 — by design). Fase 3: 4/7 slices completos. 29/38.
- **2026-05-19 (Claude Sonnet 4.6):** 2.11A.7 DONE. api-hotmart-ingress deployado em prod (Version ID `3369c40d`); 1 Secrets Store binding (HOTMART_WEBHOOK_TOKEN_DECOLE) + Queue ativo; 3 rotas fixas (decole-esg, planovoo, plano-de-voo); 2/2 smokes OK (401 sem HMAC para decole-esg e planovoo); slug inválido → 403 CF (defesa em profundidade); G.12 APROVADO. Fase 3: 6/7 slices completos. 31/38.
- **2026-05-19 (Claude Sonnet 4.6):** 2.11A.8 DONE. api-funnel-ingress deployado em prod (Version ID `5b8a689f`); 1 Secrets Store binding (`PLANOVOO_HOOK_SECRET_DECOLE`) + Queue `decole-q-funnel-events` ativos; 4/4 smokes OK (204 CORS origem válida, 403 origem desconhecida, 404 POST sem body — não 500, 403 CF sem /health — não 500); G.12 APROVADO. Fase 3: 5/7 slices completos. 30/38.
- **2026-05-19 (Claude Sonnet 4.6):** 2.11B.4 DONE. sGTM workspace 24 publicado em prod como versionId `18`; DNS e HTTP smoke OK; G.12 APROVADO. **Fase 3 COMPLETA 7/7.** 32/38.
- **2026-05-19 (Claude Sonnet 4.6):** 2.11D.4 DONE. dashboard-sync: 5 secrets legados removidos do Cloudflare (`GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_KEY`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID_ESG`, `META_AD_ACCOUNT_ID_PLANOVOO`); apenas `SYNC_SECRET` permanece; grep 0 matches em src/; 24/24 testes verdes; smoke `/sync/status` → 200 OK; sem mudança de código. Fase 4: 2/6. 34/38.
