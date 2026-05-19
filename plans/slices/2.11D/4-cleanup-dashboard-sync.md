# Slice 2.11D.4 — dashboard-sync cleanup secrets legados

> Satélite: 2.11D
> Estimativa: 1 hora

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-19 por Claude Sonnet 4.6 |
| Completed | 2026-05-19 por Claude Sonnet 4.6 |
| Commit final | (ver abaixo) |
| PR | — |

## Contexto

Worker `dashboard-sync` foi refatorado em 2.11D.2 (SoC, multi-tenant, 5 módulos) e deployado em 2.11D.3 com 5 bindings do Cloudflare Secrets Store (`*_DECOLE`). Os secrets per-worker antigos (sem sufixo `_DECOLE`) — `GA4_SERVICE_ACCOUNT_KEY`, `GA4_PROPERTY_ID`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID_ESG`, `META_AD_ACCOUNT_ID_PLANOVOO` — eram mantidos como fallback durante a janela de smoke (2.11D.3). Este slice remove esses secrets legados.

## Pré-requisitos

- [x] Slice 2.11D.3 DONE — worker em produção com bindings `*_DECOLE`
- [x] Janela de smoke 2.11D.3 concluída (2026-05-19)
- [x] 24/24 testes verdes

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `plans/slices/2.11D/4-cleanup-dashboard-sync.md` | CRIAR | Este slice file |
| `plans/STATUS-2.11.md` | ATUALIZAR | Fase 4 +1, 2.11D.4 DONE |

### Diff conceitual

Nenhum diff de código TypeScript ou `wrangler.toml`. O código já estava limpo desde 2.11D.2:
- `src/catalog.ts`: `readEnvString` usa `env[key]` sem fallback para nomes antigos ✅
- `wrangler.toml`: apenas bindings `*_DECOLE` via Secrets Store ✅
- Grep audit: 0 matches para `DECOLE|PLANOVOO|ESG|productMap` em `src/` ✅

Ação executada: remoção dos 5 worker secrets legados via `wrangler secret delete`.

## Testes

### Unit

- 24/24 testes verdes — confirmado antes da remoção dos secrets

### Grep audit

```bash
grep -rE "DECOLE|PLANOVOO|ESG|productMap" workers/dashboard-sync/src/
# Resultado: 0 matches ✅
```

### Smoke pós-remoção

- [x] `GET /sync/status?secret=SYNC_SECRET` → HTTP 200 + `{ ok: true }` ✅

## Validação executável

```bash
# 1. Testes
cd workers/dashboard-sync && npx vitest run
# 24/24 ✅

# 2. Grep audit
grep -rE "DECOLE|PLANOVOO|ESG|productMap" workers/dashboard-sync/src/
# 0 matches ✅

# 3. Listar secrets antes da remoção
wrangler secret list --name decole-dashboard-sync
# GA4_PROPERTY_ID, GA4_SERVICE_ACCOUNT_KEY, META_ACCESS_TOKEN, META_AD_ACCOUNT_ID_ESG, META_AD_ACCOUNT_ID_PLANOVOO, SYNC_SECRET

# 4. Remover secrets legados
for secret in GA4_PROPERTY_ID GA4_SERVICE_ACCOUNT_KEY META_ACCESS_TOKEN META_AD_ACCOUNT_ID_ESG META_AD_ACCOUNT_ID_PLANOVOO; do
  wrangler secret delete "$secret" --name decole-dashboard-sync < /dev/null
done
# 5x ✨ Success! Deleted secret <name> ✅

# 5. Listar secrets após remoção
wrangler secret list --name decole-dashboard-sync
# [{ name: "SYNC_SECRET", type: "secret_text" }] ✅

# 6. Smoke
curl -s -H "x-sync-secret: $SYNC_SECRET" https://decole-dashboard-sync.chicoria.workers.dev/sync/status
# { ok: true, latest: {...} } ✅
```

## Revisão G.12 (Code + Architecture + Tests)

**Código:** `catalog.ts` usa `readEnvString(env, key)` sem fallback algum — correto, agnóstico de tenant. `types.ts` define `DashboardSyncEnv` com `[key: string]: unknown` para bindings dinâmicos — correto. Nenhum hardcode de nomes legados em qualquer arquivo `src/`.

**Arquitetura:** worker lê exclusivamente do Cloudflare Secrets Store via bindings declarados no `wrangler.toml`. Os 5 secrets per-worker legados foram removidos com sucesso. Apenas `SYNC_SECRET` permanece como worker secret operacional (não é credencial de tenant — correto manter separado).

**Testes:** 24/24 verdes. Grep audit 0 matches. Smoke pós-remoção OK.

**Resultado:** APROVADO — cleanup completo sem mudança de código.

---

## Execução (append-only — preenchido AO LONGO da execução)

### 2026-05-19 por Claude Sonnet 4.6

- Recovery point: `00334b2 docs(2.11D.2)` · `dac93e4` (2.11D.3)
- Verificações pré-ação:
  - `catalog.ts`: `readEnvString` usa apenas `env[key]` — sem fallback para nomes legados ✅
  - `wrangler.toml`: apenas bindings `*_DECOLE` via Secrets Store, sem bindings legados ✅
  - `grep -rE "DECOLE|PLANOVOO|ESG|productMap" workers/dashboard-sync/src/` → 0 matches ✅
  - `npx vitest run` → 24/24 testes verdes ✅
- Secrets antes da remoção: `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_KEY`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID_ESG`, `META_AD_ACCOUNT_ID_PLANOVOO`, `SYNC_SECRET`
- Remoção executada via `wrangler secret delete ... < /dev/null` (modo não-interativo usa fallback "yes"):
  - `GA4_PROPERTY_ID` → ✨ Success! ✅
  - `GA4_SERVICE_ACCOUNT_KEY` → ✨ Success! ✅
  - `META_ACCESS_TOKEN` → ✨ Success! ✅
  - `META_AD_ACCOUNT_ID_ESG` → ✨ Success! ✅
  - `META_AD_ACCOUNT_ID_PLANOVOO` → ✨ Success! ✅
- Secrets após remoção: apenas `SYNC_SECRET` ✅
- Smoke: `GET /sync/status` → `{"ok":true,"latest":{"run_id":"sync-1779185581794","date":"2025-02-25","part":"all","status":"ok",...}}` ✅
- Nenhum deploy necessário (sem mudança de código)

## Gotchas / lições aprendidas

- **wrangler secret delete em modo não-interativo:** usar `< /dev/null` (não `echo Y |`); com stdin redirecionado para `/dev/null`, wrangler detecta ambiente não-interativo e usa fallback "yes" automaticamente.
- **Não há endpoint DELETE de secret na API REST do Cloudflare** (`/workers/scripts/{name}/secrets`) — apenas `PUT` para substituir todo o conjunto de secrets. O wrangler é a única interface pública para deletar secrets individuais.
- **Sem mudança de código:** o worker já estava completamente agnóstico desde 2.11D.2. Este slice é exclusivamente cleanup de estado externo (Cloudflare).

## Decisões tomadas (delta vs plano original)

- Nenhum deploy do worker necessário — código não mudou, apenas secrets externos removidos.
- `SYNC_SECRET` mantido como worker secret (não é credencial de tenant — é secret operacional per-worker, correto).
