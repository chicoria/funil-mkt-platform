# Slice 2.11A.8 — Deploy api-funnel-ingress prod + smoke CORS

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 2 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-19 10:10 WEST por Claude Sonnet 4.6 |
| Completed | 2026-05-19 10:14 WEST por Claude Sonnet 4.6 |
| Commit final | `239f279` |
| PR | — |
| Version ID deploy | `5b8a689f-f7da-4c1b-8260-5a1a3eed2dbf` |
| Janela de smoke | 2026-05-19 → 2026-05-20 |

## Contexto

O refactor `api-funnel-ingress` foi concluído em commit `d8dbef7` (slice 2.11A.8-prep): worker resolve tenant/CORS/app webhooks por catálogo, sem fallbacks hardcoded. Este slice aplica o deploy em produção e valida via smoke tests CORS.

## Pré-requisitos

- [x] 2.11A.8-prep DONE — commit `d8dbef7`, 17 testes verdes, grep 0 matches
- [x] Secrets Store `planovoo_hook_secret_decole` populado (Slice 2.11A.2)
- [x] `CLOUDFLARE_API_TOKEN` disponível em `.env.local`
- [x] `wrangler.toml` com binding `PLANOVOO_HOOK_SECRET_DECOLE` + routes corretas

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `plans/slices/2.11A/8-deploy-funnel-ingress.md` | CREATE | Este slice |
| `plans/STATUS-2.11.md` | EDIT | Marcar 2.11A.8 DONE, Fase 3 +1 |

### Diff conceitual

Deploy do artefato compilado do commit `d8dbef7` para worker `decole-api-funnel-ingress` em produção Cloudflare via `npx wrangler deploy`.

## Testes

### Smoke (post-deploy)

- [x] `OPTIONS /funnel/events` com `Origin: https://decolesuacarreiraesg.com.br` → **204 CORS OK** (`access-control-allow-origin: https://decolesuacarreiraesg.com.br`)
- [x] `OPTIONS /funnel/events` com `Origin: https://origem-desconhecida.com` → **403** `{"ok":false,"error":"origin_not_allowed"}` — CORS bloqueado
- [x] `POST /funnel/events` sem body → **404** `{"ok":false,"error":"not_found"}` — não é 500; CORS headers presentes
- [x] `GET /health` → **403** Cloudflare (rota não mapeada no worker — não 500)

## Validação executável

```bash
# 1. Deploy
cd workers/api-funnel-ingress && CLOUDFLARE_API_TOKEN=<token> npx wrangler deploy

# 2. Smoke CORS OK
curl -si -X OPTIONS https://api.decolesuacarreiraesg.com.br/funnel/events \
  -H "Origin: https://decolesuacarreiraesg.com.br" \
  -H "Access-Control-Request-Method: POST" | head -20

# 3. Smoke CORS bloqueado
curl -si -X OPTIONS https://api.decolesuacarreiraesg.com.br/funnel/events \
  -H "Origin: https://origem-desconhecida.com" \
  -H "Access-Control-Request-Method: POST" | head -20

# 4. POST sem body
curl -si -X POST https://api.decolesuacarreiraesg.com.br/funnel/events \
  -H "Origin: https://decolesuacarreiraesg.com.br" | head -20

# 5. GET /health (se disponível)
curl -si https://api.decolesuacarreiraesg.com.br/health | head -5
```

## Rollback

```bash
# Se smoke falhar:
cd workers/api-funnel-ingress
CLOUDFLARE_API_TOKEN=<token> npx wrangler rollback
```

Validação pós-rollback: smoke CORS com origem válida retorna 204 sem o novo comportamento.

## Revisão G.12 (Code + Architecture + Tests) — preenchido pelo revisor antes de DONE

> Revisão operacional de deploy — sem novo código, apenas verificação pós-deploy.

### 2026-05-19 10:14 WEST by Claude Sonnet 4.6

**Código TypeScript**
- [x] Strict mode respeitado — `npm run typecheck` verde em 2.11A.8-prep
- [x] Erros tratados explicitamente: `unknown_tenant`, `origin_not_allowed`, `not_found`, `queue_not_configured`
- [x] Nomes expressivos; sem abreviações opacas
- [x] 0 referências hardcoded em `src/` — `grep` confirma 0 matches

**Arquitetura**
- [x] Tenant resolvido por hostname ou `payload.tenant_id` conhecido (sem default silencioso)
- [x] CORS resolvido por `tenants.{id}.allowedOrigins` do catálogo
- [x] Secrets resolvidos via `resolveSecret()` (binding `PLANOVOO_HOOK_SECRET_DECOLE`)
- [x] Sem fallback silencioso — origem desconhecida retorna 403 (confirmado em smoke)

**Smoke operacional**
- [x] 4/4 smokes passados: 204 CORS OK, 403 CORS bloqueado, 404 sem body (não 500), 403 Cloudflare sem /health
- [x] Worker deployado com 2 bindings: Queue `decole-q-funnel-events` + Secrets Store `PLANOVOO_HOOK_SECRET_DECOLE`
- [x] Version ID: `5b8a689f-f7da-4c1b-8260-5a1a3eed2dbf`

**Resultado:** APROVADO

---

## Execução (append-only — preenchido AO LONGO da execução)

### 2026-05-19 10:10 WEST by Claude Sonnet 4.6

- O que foi tentado: criar slice file, marcar IN_PROGRESS, recovery point confirmado (`d8dbef7` em `main`, git status limpo), executar `wrangler deploy` com `CLOUDFLARE_API_TOKEN` do `.env.local`.
- O que funcionou: deploy em 5.67 seg + triggers 3.47 seg; Version ID `5b8a689f-f7da-4c1b-8260-5a1a3eed2dbf`; 4/4 smokes passados.
- O que falhou: nada.
- Decisão: `/health` retorna 403 Cloudflare (não 500) pois rota não está declarada no worker — comportamento esperado sem rota `/health`.
- Próximo passo: commit do slice + STATUS-2.11.md atualizado.

## Gotchas / lições aprendidas

- wrangler OAuth pode expirar — usar `CLOUDFLARE_API_TOKEN` explícito (padrão estabelecido em 2.11C.2 e 2.11D.3).
- CORS preflight resolve tenant apenas por hostname (sem payload); POST usa hostname ou `payload.tenant_id`.

## Decisões tomadas (delta vs plano original)

— (preencher se houver desvios)
