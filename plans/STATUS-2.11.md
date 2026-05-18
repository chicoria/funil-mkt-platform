# Status 2.11 — Multi-Tenant

> **Última atualização:** 2026-05-18 ~01:58 por Claude Code (agent) — Slice 2.11A.0 DONE
> **Fase atual:** Fase 0 — Preparação (1/4 slices completos)
> **Próxima ação:** validação humana do 2.11A.0; depois iniciar próximo slice da Fase 0 (recomendado: 2.11A.1 — catálogo v5 aditivo)

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
| Fase 1 — Popular secrets + bindings | 0/1 | ⏸️ Não iniciada |
| Fase 2 — Refactor | 0/9 | ⏸️ Não iniciada |
| Fase 3 — Deploys disruptivos | 0/6 | ⏸️ Não iniciada |
| Fase 4 — Validação cruzada + limpeza | 0/5 | ⏸️ Não iniciada |
| **Total** | **11/32** | |

Legenda: ✅ Done · ⏳ In Progress · ⏸️ TODO · ⛔ Blocked · ↩️ Rolled back

---

## Slice em progresso

(nenhum — Fase 0 e Fase 0.5 completas em 2026-05-18; aguardando validação humana para iniciar Fase 1)

## Último slice concluído

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
- [ ] **2.11A.2** — Popular secrets _DECOLE no Store + bindings em wrangler.toml dos 5 workers → `slices/2.11A/2-populate-secrets-bindings.md` (a criar)

### Fase 2 — Refactor (testes verdes, sem deploy)
- [ ] **2.11A.3** — Refactor resolveTrackingConfig (sGTM/GA4/MetaCAPI do tenant) → `slices/2.11A/3-refactor-tracking-config.md` (a criar)
- [ ] **2.11A.4** — Refactor handlers Brevo (ctx.credentials) → `slices/2.11A/4-refactor-brevo-handlers.md` (a criar)
- [ ] **2.11A.5** — Refactor forward_n8n + call_product_api + LINKS_BASE_URL + isPlanovooProductCode + replyToEmail → `slices/2.11A/5-refactor-integrations.md` (a criar)
- [ ] **2.11A.7-prep** — Refactor api-hotmart-ingress (inverter ordem + lookup catalog + remove fallback) → `slices/2.11A/7-prep-refactor-hotmart-ingress.md` (a criar)
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

---

## Estado externo (snapshot — atualizar a cada slice DONE relevante)

| Recurso | Estado atual | Última verificação |
|---|---|---|
| Cloudflare Secrets Store `default_secrets_store` (único permitido pelo limite beta) | ✅ Existe, vazio (ID `23bdc9c2e8ca470d82352c53ec8d2e67`) — confirmado em 2026-05-18 via GET /secrets | 2026-05-18 |
| Catálogo `config/products.catalog.json` schemaVersion | 4 (pré-multi-tenant evolution) | 2026-05-18 |
| Workers deployed (prod) | api-funnel-ingress, api-hotmart-ingress, funnel-dispatcher, links-redirect, dashboard-sync (todos pré-2.11) | 2026-05-18 |
| D1 `ga4_daily_metrics` | Sem coluna `tenant_id` | 2026-05-18 |
| D1 `meta_daily_metrics` | Sem coluna `tenant_id` | 2026-05-18 |
| sGTM workspace DECOLE (Cloud Run) | Single-tenant config | 2026-05-18 |
| sGTM custom domains | `sgtm.decolesuacarreiraesg.com.br` apenas | 2026-05-18 |
| Fallbacks ativos no código | Sim (workers leem `env.X` direto, com hardcode de DECOLE) | 2026-05-18 |
| Worker secrets antigos (Cloudflare) | Presentes em todos os workers (BREVO_API_KEY, HOTMART_WEBHOOK_TOKEN, etc.) | 2026-05-18 |
| Service account GCP `acesso-api@gtm-k6q4h6br-ndq3n` | Existe (`~/secrets/decole/gtm-k6q4h6br-ndq3n-7525dc924517.json`) — provavelmente tem roles Cloud Run + GTM (validar via `gcloud projects get-iam-policy`) | 2026-05-18 |

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

**Para o primeiro agente a executar este plano:**

1. **Confirmar com humano** que execução pode iniciar (validação humana — PLANO-MASTER G.10)
2. **Criar slice files da Fase 0** (4 arquivos) seguindo template [`SLICE-TEMPLATE.md`](./SLICE-TEMPLATE.md):
   - `slices/2.11A/0-secrets-store-setup.md` (exemplo modelado no satélite 1 seção H.2 do plano-de-design)
   - `slices/2.11A/1-catalog-v5-additive.md`
   - `slices/2.11B/1-audit-sgtm-current.md`
   - `slices/2.11D/1-d1-migration-tenant-id.md`
3. **Atualizar este STATUS** para refletir slices criados (mover de TODO genérico com "(a criar)" para TODO sem essa marca)
4. **Confirmar com humano** qual slice começar primeiro (recomendado: 2.11A.0)
5. **Pegar slice** (mudar status para IN_PROGRESS, registrar Started + agent ID)
6. **Executar conforme slice file**
7. **Ao final:** atualizar slice (DONE + commit + execução) + STATUS (progresso + próximo) + estado externo se aplicável

---

## Histórico de mudanças neste STATUS

- **2026-05-18 (humano chicoria@gmail.com):** Criação inicial. Estado: pré-execução. Aguarda confirmação humana para iniciar Fase 0.
- **2026-05-18 ~01:15 (Claude Code):** Humano aprovou início da execução. Criado slice file `slices/2.11A/0-secrets-store-setup.md`. Status 2.11A.0 = IN_PROGRESS.
- **2026-05-18 ~01:58 (Claude Code):** Slice 2.11A.0 fechado como DONE. Entregáveis: `packages/shared/src/secrets-store-wrapper.ts` (78 linhas, 7 testes verdes), Cloudflare Secrets Store confirmado (`default_secrets_store`). Decisão tomada: 1 store global em vez de 2 (limite beta). Progresso global: 1/32.
