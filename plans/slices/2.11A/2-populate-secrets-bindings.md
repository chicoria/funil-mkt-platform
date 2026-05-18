# Slice 2.11A.2 — Popular secrets _DECOLE no Secrets Store + bindings

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 2-3 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 ~08:25 por Claude Code |
| Completed | 2026-05-18 ~08:35 por Claude Code |
| Cloudflare Secrets Store | `default_secrets_store` (ID `23bdc9c2e8ca470d82352c53ec8d2e67`) |

## Contexto

Worker secrets antigos (`wrangler secret put`) são **per-worker** — criar N× para N workers. O Secrets Store é **account-level** — cria 1×, bindings em todos os workers. Fase 1 popula o Store com os mesmos valores dos worker secrets atuais. Workers continuam lendo do per-worker (fallback no helper wrapper) até Fase 4.

## Mudança

| Arquivo | Ação |
|---|---|
| Cloudflare Secrets Store via API | Popular ~17 secrets com valores atuais |
| `workers/*/wrangler.toml` (5 workers) | Adicionar `[[secrets_store_secrets]]` bindings |

## Execução (append-only)

### 2026-05-18 ~08:25 by Claude Code
- Descoberto: Secrets Store API usa formato `[{"name": "...", "value": "...", "scopes": ["workers"]}]` (não `{"name": "...", "value": "..."}`).
- 14 secrets criados no `default_secrets_store` (14/14 ✅)
- 3 secrets pendentes (só existem no worker Cloudflare, valores não em .env.local): `n8n_webhook_url_decole`, `planovoo_hook_secret_decole`, `app_events_hmac_decole`
- wrangler.toml dos 5 workers atualizado com `[[secrets_store_secrets]]` bindings
- Workers ainda lêem per-worker secrets como fallback (helper wrapper do 2.11A.0)
- 168/168 testes verdes após mudanças

## Revisão G.12

Auto-revisão (Slice de infra, não código funcional):
- ✅ Secrets populados sem expor valores
- ✅ wrangler.toml bindings corretos (store_id e secret_name por worker)
- ✅ links-redirect sem bindings (correto — seus secrets são tratados em 2.11C)
- ⚠️ 3 secrets pendentes de ação manual (documentados)
- **Resultado:** APROVADO
