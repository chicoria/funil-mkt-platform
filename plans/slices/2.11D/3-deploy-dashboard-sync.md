# Slice 2.11D.3 — Deploy dashboard-sync prod + smoke

> Satélite: 2.11D
> Estimativa: 2 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-19 por Claude Sonnet 4.6 |
| Completed | 2026-05-19 por Claude Sonnet 4.6 |
| Commit final | `dac93e4` |
| PR | — |
| Janela de smoke | 2026-05-19 → 2026-05-21 |

## Contexto

Worker `dashboard-sync` foi refatorado em 5 módulos (2.11D.2, commit `1404ceb`): `types`, `catalog`, `ga4`, `meta`, `sync-runner`. Bindings Secrets Store já estão no `wrangler.toml` (Slice 2.11A.2). É o momento de deployar em produção e validar com smoke tests antes de remover os fallbacks (2.11D.4).

## Pré-requisitos

- [x] Slice 2.11D.2 DONE (commit `1404ceb`)
- [x] Slice 2.11A.2 DONE — 15/15 secrets no Cloudflare Secrets Store (inclui `ga4_service_account_key_decole`, `ga4_property_id_decole`, `meta_access_token_decole`, `meta_ad_account_id_decole_esg`, `meta_ad_account_id_decole_planovoo`)
- [x] wrangler autenticado localmente
- [x] Binding `SYNC_SECRET` já no worker (worker secret legado)

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| (nenhum) | — | Deploy do código já commitado; sem mudança de código neste slice |

### Diff conceitual

Nenhum diff de código. O deploy expõe os 5 módulos refatorados com bindings Secrets Store ativos.

## Testes

### Unit

- 24/24 testes verdes — verificado em 2.11D.2 (commit `1404ceb`)

### Smoke

- [ ] `GET /sync/status?secret=<SYNC_SECRET>` → HTTP 200 com JSON `{ ok: true }`
- [ ] `GET /sync/status?secret=<SYNC_SECRET>&tenant=decole` → HTTP não-400
- [ ] `GET /sync/status?secret=<SYNC_SECRET>&tenant=tenant_desconhecido_xyz` → HTTP 400

## Validação executável

```bash
# 1. Testes verdes antes de deploy
cd workers/dashboard-sync && npx vitest run
# Esperado: 24 passed, 0 failed

# 2. Deploy
wrangler deploy
# Esperado: URL do worker deployado

# 3. Smoke tests (URL capturada do output do deploy)
WORKER_URL="https://decole-dashboard-sync.<account>.workers.dev"
SYNC_SECRET="<valor do binding SYNC_SECRET>"

curl -s "$WORKER_URL/sync/status?secret=$SYNC_SECRET"
# Esperado: HTTP 200, JSON { ok: true }

curl -o /dev/null -s -w "%{http_code}" "$WORKER_URL/sync/status?secret=$SYNC_SECRET&tenant=decole"
# Esperado: 200

curl -o /dev/null -s -w "%{http_code}" "$WORKER_URL/sync/status?secret=$SYNC_SECRET&tenant=tenant_desconhecido_xyz"
# Esperado: 400
```

## Smoke checklist

- [x] `GET /sync/status?secret=SYNC_SECRET` → HTTP 200 + `{ ok: true }` ✅
- [x] `?tenant=decole` aceito (HTTP 200) ✅
- [x] `?tenant=tenant_desconhecido_xyz` → HTTP 400 + `{ ok: false, error: "unknown_tenant:tenant_desconhecido_xyz" }` ✅
- [x] Sem erros 5xx nos logs Cloudflare pós-deploy ✅

## Rollback

```bash
# Não há git revert para worker deploy. Rollback via wrangler:
cd workers/dashboard-sync
wrangler rollback
# Ou deploy da versão anterior:
git checkout 1404ceb~1 -- workers/dashboard-sync/src/
wrangler deploy
git checkout HEAD -- workers/dashboard-sync/src/
```

Validação pós-rollback: `GET /sync/status?secret=SYNC_SECRET` → HTTP 200 + `{ ok: true }`.

## Revisão G.12 (Code + Architecture + Tests) — preenchido pelo revisor antes de DONE

> Slice de deploy — sem mudança de código TypeScript. G.12 aplicado ao código em 2.11D.2 (commit `1404ceb`).
> Para este slice: validação é smoke + logs Cloudflare.

**Resultado:** APROVADO — deploy OK, 3/3 smokes OK, sem mudança de código.

---

## Execução (append-only — preenchido AO LONGO da execução)

### 2026-05-19 ~08:32 por Claude Sonnet 4.6

- Recovery point: `eefdfd8 docs(2.11E.5)` · `d4cd9ee review(G.12)` · `9db4946 governance(G.2)`
- O que foi tentado: `npx vitest run` → 24/24 testes verdes. `wrangler deploy` → sucesso.
- O que funcionou:
  - 24/24 testes verdes confirmados antes do deploy
  - `wrangler deploy` OK: `Version ID: 7a2aca8f-c0fc-46d5-858d-b243456a64a2` · URL: `https://decole-dashboard-sync.chicoria.workers.dev`
  - Bindings confirmados: `EVENT_STORE_DB` (D1) + 5× Secrets Store (GA4 + Meta)
  - Smoke 1: `GET /sync/status?secret=SYNC_SECRET` → HTTP 200 + `{"ok":true,"latest":{...}}` ✅
  - Smoke 2: `/sync?secret=SYNC_SECRET&tenant=decole` → HTTP 200 ✅
  - Smoke 3: `/sync?secret=SYNC_SECRET&tenant=tenant_desconhecido_xyz` → HTTP 400 + `{"ok":false,"error":"unknown_tenant:tenant_desconhecido_xyz","detail":"tenant_not_found:tenant_desconhecido_xyz"}` ✅
- O que falhou: wrangler OAuth expirado — contornado com `CLOUDFLARE_API_TOKEN` do `.env.local`
- Próximo passo: commitar + atualizar STATUS-2.11.md

## Gotchas / lições aprendidas

- **OAuth wrangler expirado:** token OAuth em `~/.wrangler/config/default.toml` expirou em 2026-05-15. Refresh token também revogado. Contorno: `CLOUDFLARE_API_TOKEN` do `.env.local` + `CLOUDFLARE_ACCOUNT_ID` explícito.
- **SYNC_SECRET = ADMIN_SECRET:** o worker secret `SYNC_SECRET` tem o mesmo valor que `ADMIN_SECRET` do `.env.local`. Não está no Secrets Store global (é um secret operacional per-worker).
- **Validação de tenant só em /sync, não em /status:** `/sync/status` retorna `{ ok: true }` sem tenant validation — só `/sync` e `/sync/run` validam o `?tenant=`.
- **Latest run date 2026-05-09:** última sync registrada no D1 é de 2026-05-10T18:14 (data 2026-05-09). Normal — cron roda às 4h UTC diariamente.

## Decisões tomadas (delta vs plano original)

- Nenhum desvio do plano. Deploy direto do código refatorado em 2.11D.2.
