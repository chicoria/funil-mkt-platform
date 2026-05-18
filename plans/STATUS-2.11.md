# Status 2.11 — Multi-Tenant

> **Última atualização:** 2026-05-18 ~18:22 WEST por Codex — Slice 2.11A.7-prep IN_PROGRESS
> **Fase atual:** Fase 2 — Refactor (3/9 slices completos)
> **Próxima ação:** executar `2.11A.7-prep` — Refactor api-hotmart-ingress

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
| Fase 2 — Refactor | 3/9 | ⏳ Em andamento |
| Fase 3 — Deploys disruptivos | 0/6 | ⏸️ Não iniciada |
| Fase 4 — Validação cruzada + limpeza | 0/5 | ⏸️ Não iniciada |
| **Total** | **15/32** | |

Legenda: ✅ Done · ⏳ In Progress · ⏸️ TODO · ⛔ Blocked · ↩️ Rolled back

---

## Slice em progresso

**2.11A.7-prep** — Refactor api-hotmart-ingress ⏳
- **File:** [`slices/2.11A/7-prep-refactor-hotmart-ingress.md`](./slices/2.11A/7-prep-refactor-hotmart-ingress.md)
- **Started:** 2026-05-18 18:22 WEST por Codex
- **Escopo:** resolver tenant por hostname, produto por `hotmart.urlSlugs` e token por `tenants.{id}.credentials.hotmart_token_env`, sem fallbacks DECOLE.

## Último slice concluído

**2.11A.5** — Refactor integrações restantes do dispatcher ✅
- **File:** [`slices/2.11A/5-refactor-integrations.md`](./slices/2.11A/5-refactor-integrations.md)
- **Commit:** `66002a9`
- **Entregáveis:** `call_product_api` resolve URL/HMAC via `resolveSecret()` para string legada ou Secrets Store binding; links de carrinho usam `tenants.{id}.links.linksDomain` e fazem fallback para checkout original sem domínio DECOLE quando falta configuração; contexto legado não injeta mais `replyToEmail` hardcoded; `DECOLE_PLANOVOO.product_api` aponta para secrets `_DECOLE`.

## Referência histórica recente

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
- [ ] **2.11A.7-prep** ⏳ — Refactor api-hotmart-ingress (inverter ordem + lookup catalog + remove fallback) → [`slices/2.11A/7-prep-refactor-hotmart-ingress.md`](./slices/2.11A/7-prep-refactor-hotmart-ingress.md) **(IN_PROGRESS 2026-05-18)**
- [ ] **2.11A.8-prep** — Refactor api-funnel-ingress (CORS catalog + remove fallbacks + appWebhooks) → `slices/2.11A/8-prep-refactor-funnel-ingress.md` (a criar)
- [ ] **2.11B.2** — Refatorar workspace sGTM em PREVIEW (lookup tables, variáveis dinâmicas) → `slices/2.11B/2-refactor-sgtm-workspace-preview.md` (a criar)
- [ ] **2.11B.3** — Validar workspace sGTM em preview com tenant fake superare-test → `slices/2.11B/3-validate-preview-superare-fake.md` (a criar)
- [ ] **2.11C.1** — links-redirect refactor (bundle catálogo + lookup routes/contacts) → `slices/2.11C/1-refactor-links-redirect.md` (a criar)
- [ ] **2.11D.2** — dashboard-sync refactor runSync (loops aninhados, ?tenant=) → `slices/2.11D/2-refactor-sync-runner.md` (a criar)

### Fase 3 — Deploys disruptivos (janela 48h cada)
- [ ] **2.11A.6** — Deploy funnel-dispatcher prod + smoke E2E → `slices/2.11A/6-deploy-dispatcher.md` (a criar)
- [ ] **2.11B.4** — Publicar versão sGTM workspace em prod + smoke → `slices/2.11B/4-publish-sgtm-prod.md` (a criar)
- [ ] **2.11A.7** — Deploy api-hotmart-ingress + smoke webhook real → `slices/2.11A/7-deploy-hotmart-ingress.md` (a criar)
- [ ] **2.11A.8** — Deploy api-funnel-ingress + smoke CORS browser → `slices/2.11A/8-deploy-funnel-ingress.md` (a criar)
- [ ] **2.11C.2** — Deploy links-redirect + smoke todas URLs conhecidas → `slices/2.11C/2-deploy-links-redirect.md` (a criar)
- [ ] **2.11D.3** — Deploy dashboard-sync + backfill sanity check → `slices/2.11D/3-deploy-dashboard-sync.md` (a criar)

### Fase 4 — Validação cruzada + limpeza
- [ ] **2.11Z.1** — Smoke E2E cross-slice com tenant fake superare-test → `slices/2.11Z/1-cross-tenant-e2e-validation.md` (a criar)
- [ ] **2.11A.9** — audit-secrets em CI + remover worker secrets antigos + validar grep workers agnostic → `slices/2.11A/9-cleanup-fallbacks.md` (a criar)
- [ ] **2.11B.5** — Documentar runbook onboarding tenant em RUNBOOK-ONBOARDING-TENANT.md → `slices/2.11B/5-runbook-onboarding.md` (a criar)
- [ ] **2.11C.3** — links-redirect remove env vars antigas + validar grep → `slices/2.11C/3-cleanup-links-redirect.md` (a criar)
- [ ] **2.11D.4** — dashboard-sync remove fallbacks + secrets antigos → `slices/2.11D/4-cleanup-dashboard-sync.md` (a criar)

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
| Catálogo `config/products.catalog.json` schemaVersion | **5** (v5 aditivo — `tenants.decole.credentials` e `DECOLE_PLANOVOO.product_api` repontados para secrets `_DECOLE`; v4 mantido onde ainda há fallback) | 2026-05-18 |
| Workers deployed (prod) | api-funnel-ingress, api-hotmart-ingress, funnel-dispatcher, links-redirect, dashboard-sync — **wrangler.toml com bindings Secrets Store, mas SEM redeploy ainda** (Fase 3) | 2026-05-18 |
| D1 `ga4_daily_metrics` | **Schema v2: coluna `tenant_id` adicionada** (migration 2.11D.1 — roda no bootstrap) | 2026-05-18 |
| D1 `meta_daily_metrics` | **Schema v2: coluna `tenant_id` adicionada** (migration 2.11D.1) | 2026-05-18 |
| sGTM workspace DECOLE (Cloud Run) | Single-tenant config (baseline documentado em `slices/2.11B/1-audit-sgtm-current.md`) | 2026-05-18 |
| sGTM custom domains | `sgtm.decolesuacarreiraesg.com.br` apenas — container ID: `GTM-K6Q4H6BR` | 2026-05-18 |
| Fallbacks ativos no código | **Sim** — workers leem per-worker secrets como fallback via helper wrapper; código src/ ainda tem hardcode (Fase 2 refactora) | 2026-05-18 |
| Worker secrets antigos (Cloudflare) | Presentes (BREVO_API_KEY, HOTMART_WEBHOOK_TOKEN, etc.) — mantidos como fallback até Fase 4 | 2026-05-18 |
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

(nenhuma — nenhum deploy disruptivo ainda)

---

## Próxima ação concreta

**Para o próximo agente:**

1. Confirmar recovery point (`git status --short`, `git log --oneline -10`) e ler este STATUS + satélite 2.11A.
2. Criar `plans/slices/2.11A/7-prep-refactor-hotmart-ingress.md` a partir de `SLICE-TEMPLATE.md`.
3. Marcar 2.11A.7-prep como IN_PROGRESS.
4. Refatorar `api-hotmart-ingress` para lookup por catálogo, removendo fallback silencioso e preservando testes/regressões existentes.

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
