# Slice 2.11A.2 — Popular secrets _DECOLE no Secrets Store + bindings

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 2-3 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 ~08:25 por Claude Code |
| Completed | 2026-05-18 ~10:30 por Claude Code |
| Commit final | `45f83d5` · `299eead` · `5a4aab3` · `c0ba466` |
| Commits (detalhe) | `45f83d5` (secrets+bindings) · `299eead` (suprimir forward_n8n) · `5a4aab3` (suprimir APP_EVENTS_HMAC) · `c0ba466` (sync planovoo_hook_secret) |
| Cloudflare Secrets Store | `default_secrets_store` (ID `23bdc9c2e8ca470d82352c53ec8d2e67`) — **15/15 secrets** |

## Contexto

Worker secrets antigos (`wrangler secret put`) são **per-worker** — criar N× para N workers. O Secrets Store é **account-level** — cria 1×, bindings em todos os workers. Fase 1 popula o Store com os mesmos valores dos worker secrets atuais. Workers continuam lendo do per-worker (fallback no helper wrapper) até Fase 4.

## Mudança

| Arquivo | Ação |
|---|---|
| Cloudflare Secrets Store via API | Popular ~17 secrets com valores atuais |
| `workers/*/wrangler.toml` (5 workers) | Adicionar `[[secrets_store_secrets]]` bindings |

## Execução (append-only)

### 2026-05-18 ~08:25 by Claude Code — Secrets Store + bindings

**Descoberta crítica de API:** Cloudflare Secrets Store requer formato array:
`[{"name": "...", "value": "...", "scopes": ["workers"]}]`
— não o objeto simples `{"name":"...","value":"..."}`.

14 secrets criados via `.env.local` (mapeamento v4→v5).
wrangler.toml dos 5 workers actualizado com `[[secrets_store_secrets]]` bindings.
Workers mantêm per-worker secrets como fallback (helper wrapper 2.11A.0).
168/168 testes verdes após mudanças. Commit: `45f83d5`.

### 2026-05-18 ~09:00 by Claude Code — Supressão de código morto

**forward_n8n é dead code:**
`forward_n8n` não aparece em NENHUMA chain de evento do catálogo. `N8N_WEBHOOK_URL` não criado no Secrets Store (valor ausente no `.env.local`). Handler `forwardN8n()`, `buildN8nForwardPayload()`, env vars marcados `@deprecated`. Commit `299eead`.

**APP_EVENTS_HMAC / verifyAppSignature é dead code:**
`decole-plano-de-voo-app` nunca chama `/webhooks/v1/planovoo/app/event` — a app só RECEBE webhooks do FunilMKT, nunca envia. `verifyAppSignature()`, `APP_EVENTS_HMAC` e a rota marcados `@deprecated`. Não criado no Secrets Store. Commit `5a4aab3`.

### 2026-05-18 ~10:30 by Claude Code + humano (chicoria) — planovoo_hook_secret

`PLANOVOO_HOOK_SECRET` recuperado do VPS DigitalOcean pelo humano e adicionado ao `.env.local`. Secrets Store actualizado com valor real (DELETE + re-POST). Worker secret `PLANOVOO_HOOK_SECRET` do dispatcher restaurado. Commit `c0ba466`.

**Estado final — Secrets Store 15/15 ✅**

| Secret | Origem | Estado |
|---|---|---|
| `brevo_api_key_decole` | `BREVO_API_KEY` | ✅ |
| `hotmart_webhook_token_decole` | `HOTMART_WEBHOOK_TOKEN` | ✅ |
| `sgtm_endpoint_url_decole` | `SGTM_ENDPOINT_URL_DECOLE_ESG` | ✅ |
| `ga4_measurement_id_decole` | `GA4_MEASUREMENT_ID` | ✅ |
| `ga4_api_secret_decole` | `GA4_API_SECRET` | ✅ |
| `meta_capi_access_token_decole` | `META_SYSTEM_USER_ACCESS_TOKEN` | ✅ |
| `meta_pixel_id_decole_esg` | `META_PIXEL_ID_DECOLE_ESG` | ✅ |
| `meta_pixel_id_decole_planovoo` | `META_PIXEL_ID_PLANOVOO` | ✅ |
| `planovoo_api_base_url_decole` | URL hardcoded da wrangler.toml var | ✅ |
| `planovoo_hook_secret_decole` | VPS `.env` → `.env.local` (humano) | ✅ |
| `ga4_service_account_key_decole` | Ficheiro JSON do service account | ✅ |
| `ga4_property_id_decole` | `GA4_PROPERTY_ID` | ✅ |
| `meta_access_token_decole` | `META_SYSTEM_USER_ACCESS_TOKEN` | ✅ |
| `meta_ad_account_id_decole_esg` | `META_AD_ACCOUNT_ID` | ✅ |
| `meta_ad_account_id_decole_planovoo` | `META_AD_ACCOUNT_ID` | ✅ |
| `n8n_webhook_url_decole` | ❌ **Suprimido** — forward_n8n dead code | — |
| `app_events_hmac_decole` | ❌ **Suprimido** — verifyAppSignature dead code | — |

**Cleanup pendente para 2.11A.9:**
- Remover `forwardN8n()`, `buildN8nForwardPayload()`, `N8N_WEBHOOK_URL`, `N8N_DISABLE_FORWARD` do dispatcher
- Remover `verifyAppSignature()`, `APP_EVENTS_HMAC`, rota `/webhooks/v1/planovoo/app/event` do funnel-ingress
- Remover worker secrets `N8N_WEBHOOK_URL` e `APP_EVENTS_HMAC` do Cloudflare
- Remover declaração `handlers.forward_n8n` do catálogo

## Revisão G.12

Auto-revisão (Slice de infra — secrets + wrangler.toml, sem lógica de código):
- ✅ Secrets populados sem expor valores em logs
- ✅ wrangler.toml bindings correctos (store_id + secret_name por worker)
- ✅ links-redirect sem bindings (correcto — tratado em 2.11C)
- ✅ Dead code descoberto e documentado (forward_n8n + APP_EVENTS_HMAC)
- **Resultado:** APROVADO
