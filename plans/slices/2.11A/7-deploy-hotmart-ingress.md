# Slice 2.11A.7 — Deploy api-hotmart-ingress em produção

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 2 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-19 11:12 WEST por Claude Sonnet 4.6 |
| Completed | 2026-05-19 11:22 WEST por Claude Sonnet 4.6 |
| Commit final | `294fc61` |
| Version ID | `3369c40d-8242-4b06-8d6d-068af0ac11fc` |
| PR | — |
| Janela de smoke | 2026-05-19 → 2026-05-21 |

## Contexto

O refactor `api-hotmart-ingress` foi concluído no slice 2.11A.7-prep (commit `fe125e4`).
O worker agora resolve tenant por hostname, produto por `hotmart.urlSlugs` e token por `resolveSecret()` via Secrets Store binding `HOTMART_WEBHOOK_TOKEN_DECOLE`.
Este slice faz o deploy em produção e smoke tests para confirmar que o worker responde corretamente.

**Recovery point:** git log confirma `fe125e4` como último commit relevante para este worker.
Workers deployados em prod antes deste slice: `links-redirect` (Version ID `2d156f71`), `dashboard-sync` (Version ID `7a2aca8f`).

## Pré-requisitos

- [x] 2.11A.7-prep DONE — refactor completo, commit `fe125e4`
- [x] `HOTMART_WEBHOOK_TOKEN_DECOLE` no Secrets Store + binding em `wrangler.toml`
- [x] Catálogo v5 com `hotmart.urlSlugs` para tenants decole/planovoo
- [x] 13/13 testes verdes em `workers/api-hotmart-ingress/`
- [x] `CLOUDFLARE_API_TOKEN` em `.env.local`

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `plans/slices/2.11A/7-deploy-hotmart-ingress.md` | CREATE | Este slice file |
| `plans/STATUS-2.11.md` | EDIT | Registrar deploy + Version ID |

### Rotas em produção (wrangler.toml)

```
api.decolesuacarreiraesg.com.br/webhooks/v1/decole-esg/hotmart/*
api.decolesuacarreiraesg.com.br/webhooks/v1/planovoo/hotmart/*
api.decolesuacarreiraesg.com.br/webhooks/v1/plano-de-voo/hotmart/*
```

(Sem rota `/health` no wrangler.toml — smoke via curl a `/webhooks/v1/decole-esg/hotmart/purchase` sem HMAC → 401)

## Smoke checklist

- [x] `POST /webhooks/v1/decole-esg/hotmart/purchase` sem HMAC → 401 `{"ok":false,"error":"unauthorized"}` ✅
- [x] `POST /webhooks/v1/planovoo/hotmart/purchase` sem HMAC → 401 ✅
- [x] `POST /webhooks/v1/slug-invalido/hotmart/purchase` → 403 CF (Cloudflare bloqueia no gateway — rota não mapeada no wrangler.toml; comportamento correto e mais seguro que 404 interno) ✅
- [x] Sem erros 5xx durante smoke ✅

**Nota sobre smoke 3:** O `wrangler.toml` define 3 rotas fixas com slugs literais (`decole-esg`, `planovoo`, `plano-de-voo`). Qualquer slug não mapeado retorna 403 Cloudflare (error code 1014) antes de chegar ao worker. Isso é defesa em profundidade — o slug inválido nem chega ao código. Para testar a lógica `unknown_product_slug` do worker (404 interno), seria preciso um tenant que tenha rota wildcard, o que não é o design escolhido.

## Rollback

```bash
# 1. Reverter para versão anterior
cd workers/api-hotmart-ingress
CLOUDFLARE_API_TOKEN=<token> npx wrangler rollback
```

Validação pós-rollback: smoke → 401 ainda responde (worker ativo), verificar Version ID no dashboard.

## Revisão G.12 (Code + Architecture + Tests) — preenchido pelo revisor antes de DONE

> Revisão G.12 de código já aprovada no slice 2.11A.7-prep (Codex, 2026-05-18 20:02).
> Este slice cobre apenas a revisão operacional do deploy.

### 2026-05-19 11:22 WEST by Claude Sonnet 4.6 — revisão operacional

**Deploy**
- [x] Version ID `3369c40d-8242-4b06-8d6d-068af0ac11fc` registrado no slice
- [x] 3 rotas ativas em produção (`decole-esg`, `planovoo`, `plano-de-voo`)
- [x] Secrets Store binding `HOTMART_WEBHOOK_TOKEN_DECOLE` confirmado no output do wrangler deploy
- [x] Queue binding `FUNNEL_EVENTS` (decole-q-funnel-events) confirmado

**Smoke**
- [x] 401 `{"ok":false,"error":"unauthorized"}` para decole-esg sem HMAC
- [x] 401 para planovoo sem HMAC
- [x] 403 Cloudflare para slug não mapeado (defesa em profundidade, correto)

**Resultado:** APROVADO

---

## Execução (append-only — preenchido AO LONGO da execução)

### 2026-05-19 11:12 WEST by Claude Sonnet 4.6

- O que foi tentado: verificar estado pré-deploy (git log, typecheck, testes).
- O que funcionou: git log confirma `fe125e4` como commit de refactor. `npm run typecheck` verde. 13/13 testes passaram.
- O que falhou: nada.
- Próximo passo planejado: criar slice file → marcar IN_PROGRESS → executar `wrangler deploy`.

### 2026-05-19 11:18 WEST by Claude Sonnet 4.6

- O que foi tentado: `CLOUDFLARE_API_TOKEN=... npx wrangler deploy` em `workers/api-hotmart-ingress/`.
- O que funcionou: Deploy bem-sucedido. Version ID `3369c40d-8242-4b06-8d6d-068af0ac11fc`. 3 rotas ativas. 2 bindings confirmados (Secrets Store + Queue).
- O que falhou: nada no deploy.
- Próximo passo planejado: smoke tests.

### 2026-05-19 11:22 WEST by Claude Sonnet 4.6

- O que foi tentado: 3 smokes via curl contra produção.
- O que funcionou:
  - Smoke 1: `POST .../decole-esg/hotmart/purchase` → HTTP 401 `{"ok":false,"error":"unauthorized"}` ✅
  - Smoke 2: `POST .../planovoo/hotmart/purchase` → HTTP 401 ✅
  - Smoke 3: `POST .../slug-invalido/hotmart/purchase` → HTTP 403 Cloudflare (error code 1014) — comportamento correto (slug não está nas rotas mapeadas do wrangler.toml)
- O que falhou: nada — 403 para slug-invalido é defesa em profundidade esperada.
- G.12 revisão operacional: APROVADO.
- Próximo passo planejado: registrar no STATUS-2.11.md + commit.

## Gotchas / lições aprendidas

- Não há rota `/health` no `wrangler.toml` — smoke deve usar uma das rotas de webhook registradas.
- `workers_dev = false` — sem `.workers.dev` URL disponível; deploy só via rotas custom.
- Token para autenticação wrangler: usar `CLOUDFLARE_API_TOKEN` do `.env.local` (OAuth expirou).

## Decisões tomadas (delta vs plano original)

- Smoke via `POST .../purchase` sem HMAC (→ 401) em vez de `GET /health` (rota inexistente). Comportamento de fail-fast do worker garante que o processo de auth está ativo.
