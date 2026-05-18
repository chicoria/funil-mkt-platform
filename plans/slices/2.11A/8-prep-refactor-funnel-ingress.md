# Slice 2.11A.8-prep — Refactor api-funnel-ingress

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 20:06 WEST por Codex |
| Completed | 2026-05-18 20:13 WEST por Codex |
| Commit final | `d8dbef7` |
| PR | — |
| Janela de smoke | N/A — Fase 2 sem deploy |

## Contexto

Depois do 2.11A.7-prep, o `api-funnel-ingress` ainda usa CORS global por env, fallback silencioso para DECOLE e rota hardcoded de app webhook do Plano de Voo. Este slice move CORS, tenant resolution e app webhooks para o catálogo v5, preservando compatibilidade de payloads existentes.

Decisão de escopo: a rota app webhook continua como compatibilidade declarativa por catálogo, mas segue marcada para cleanup em 2.11A.9 porque `APP_EVENTS_HMAC`/app outbound é código morto.

## Pré-requisitos

- [x] 2.11A.0 DONE — Secrets Store wrapper
- [x] 2.11A.1 DONE — catálogo v5 com `allowedOrigins` e `integrations.*.appWebhooks`
- [x] 2.11A.2 DONE — `APP_EVENTS_HMAC` suprimido como código morto; `PLANOVOO_HOOK_SECRET_DECOLE` existe no Secrets Store
- [x] 2.11A.7-prep DONE — hotmart ingress sem fallback DECOLE

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `workers/api-funnel-ingress/src/index.ts` | EDIT | Resolver tenant, CORS e app webhooks por catálogo |
| `workers/api-funnel-ingress/test/unit/index.test.ts` | EDIT | Cobrir CORS por tenant, fail-fast e appWebhook catalog-aware |
| `workers/api-funnel-ingress/wrangler.toml` | EDIT | Remover `ALLOWED_ORIGINS`/`DEFAULT_TENANT_ID`; trocar binding morto por `PLANOVOO_HOOK_SECRET_DECOLE` |
| `config/products.catalog.json` | EDIT | Atualizar `workerViews.api-funnel-ingress.secrets` |
| `plans/STATUS-2.11.md` | EDIT | Registrar slice em progresso/concluído |
| `plans/PLANO-MASTER-MULTI-TENANT.md` | EDIT | Atualizar cabeçalho ao fechar |

### Fora de escopo

- Não fazer deploy; deploy/smoke real fica para 2.11A.8.
- Não remover a rota app webhook nem `verifyAppSignature()` por completo; cleanup fica para 2.11A.9.
- Não refatorar `links-redirect`; fica no 2.11C.1.

## Testes

### Unit

- [x] `/funnel/*` usa `tenants.{id}.allowedOrigins` e aceita origem do tenant correto
- [x] origem de tenant A não passa em hostname/tenant B
- [x] sem tenant resolvível retorna `400 unknown_tenant` e não enfileira
- [x] payload `tenant_id` conhecido ainda funciona para hostname desconhecido
- [x] payload `tenant_id` desconhecido não cai em `DEFAULT_TENANT_ID`
- [x] preflight usa CORS por catálogo
- [x] app webhook é localizado por `integrations.*.appWebhooks[]`
- [x] app webhook `requiresHmac` usa `hookSecretEnv` via `resolveSecret()`
- [x] rota app webhook hardcoded antiga não funciona se removida do catálogo

### E2E

N/A — Fase 2 não faz deploy nem smoke externo.

## Validação executável

```bash
cd workers/api-funnel-ingress && npm run typecheck
cd workers/api-funnel-ingress && npx vitest run
node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"
git diff --check
rg -n 'DECOLE|PLANOVOO|ESG|SUPERARE|decolesuacarreiraesg|planovoo|plano-de-voo|APP_EVENTS_HMAC|ALLOWED_ORIGINS|DEFAULT_TENANT_ID' workers/api-funnel-ingress/src
```

## Smoke checklist

N/A — sem deploy neste slice.

## Rollback

```bash
git revert <commit_hash>
```

Validação pós-rollback: testes do `api-funnel-ingress` voltam ao estado anterior; nenhuma mudança externa foi aplicada.

## Revisão G.12 (Code + Architecture + Tests) — preenchido pelo revisor antes de DONE

### 2026-05-18 20:13 WEST by Codex — auto-revisão

**Código TypeScript**
- [x] Strict mode respeitado; `npm run typecheck` verde
- [x] Erros tratados explicitamente: `unknown_tenant`, `origin_not_allowed`, `unauthorized`, `secret_misconfigured`, `queue_not_configured`
- [x] `resolveSecret()` usado para app webhooks com `requiresHmac`
- [x] Runtime do worker sem referências hardcoded a tenant/produto/slug/origem/env legado

**Arquitetura**
- [x] Tenant resolvido por hostname ou `payload.tenant_id` conhecido, sem default silencioso
- [x] CORS resolvido por `tenants.{id}.allowedOrigins`
- [x] App webhooks resolvidos por `tenants.{id}.integrations.*.appWebhooks[]`
- [x] `wrangler.toml` não usa mais `ALLOWED_ORIGINS`/`DEFAULT_TENANT_ID`

**Testes**
- [x] Red verificável: 6 falhas antes da implementação
- [x] Happy path, preflight, CORS cross-tenant, payload fallback, fail-fast e app webhook catalog-aware cobertos
- [x] Isolamento entre tenants coberto com fixture `CATALOG_JSON`
- [x] Sem `it.only`/`describe.skip`

**Resultado:** APROVADO

---

## Execução (append-only — preenchido AO LONGO da execução)

### 2026-05-18 20:06 WEST by Codex

- O que foi tentado: recovery point confirmado em `main`, worktree limpa e próximo slice confirmado no `STATUS-2.11.md`.
- O que funcionou: escopo fechado para CORS por tenant, tenant sem fallback e app webhooks por catálogo.
- O que falhou: nada até agora.
- Próximo passo planejado: marcar status, adicionar testes Red e implementar o refactor.

### 2026-05-18 20:09 WEST by Codex

- O que foi tentado: testes Red para CORS por tenant, ausência de fallback `DEFAULT_TENANT_ID`, app webhooks por catálogo e assinatura via `hookSecretEnv`.
- O que funcionou: `npx vitest run` falhou em 6 testes, todos nos pontos esperados do comportamento legado.
- O que falhou: o código ainda aceitava CORS global, caía em DECOLE e usava rota/assinatura hardcoded.
- Próximo passo planejado: implementar resolução por catálogo e Secrets Store.

### 2026-05-18 20:12 WEST by Codex

- O que foi tentado: implementação do refactor e validações locais.
- O que funcionou:
  - Tenant agora resolve por hostname ou `payload.tenant_id` conhecido; se nenhum método resolve, retorna `400 unknown_tenant`.
  - CORS usa `tenants.{id}.allowedOrigins`; origem inválida retorna `403` sem `access-control-allow-origin`.
  - App webhooks são localizados por `tenants.{id}.integrations.*.appWebhooks[]`.
  - App webhooks com `requiresHmac` validam `x-app-signature` usando `integration.hookSecretEnv` via `resolveSecret()`.
  - `ALLOWED_ORIGINS`, `DEFAULT_TENANT_ID` e `APP_EVENTS_HMAC` saíram do runtime do worker.
  - `workerViews.api-funnel-ingress.secrets` e `wrangler.toml` foram atualizados para `PLANOVOO_HOOK_SECRET_DECOLE`.
- O que falhou: nada nas validações finais.
- Validação:
  - `cd workers/api-funnel-ingress && npm run typecheck` ✅
  - `cd workers/api-funnel-ingress && npx vitest run` ✅ — 17 testes
  - `node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"` ✅
  - `git diff --check` ✅
  - `rg -n 'DECOLE|PLANOVOO|ESG|SUPERARE|decolesuacarreiraesg|planovoo|plano-de-voo|APP_EVENTS_HMAC|ALLOWED_ORIGINS|DEFAULT_TENANT_ID' workers/api-funnel-ingress/src` ✅ — 0 matches
- Próximo passo planejado: commit de implementação e revisão G.12 antes de fechar o slice.

### 2026-05-18 20:13 WEST by Codex

- O que foi tentado: commit de implementação e revisão G.12.
- O que funcionou: commit `d8dbef7` criado com código, testes, catálogo, wrangler e slice em progresso; revisão G.12 aprovada.
- O que falhou: nada.
- Próximo passo planejado: fechar `STATUS-2.11.md` e `PLANO-MASTER-MULTI-TENANT.md`.

## Gotchas / lições aprendidas

- CORS de preflight não tem payload; por isso resolve tenant apenas por hostname. Para POST `/funnel/*`, `payload.tenant_id` conhecido continua funcionando quando hostname é de preview/desconhecido.
- A rota app webhook continua existindo por compatibilidade declarativa, mas ainda é código morto operacional e fica para remoção em 2.11A.9.
- `resolveSecret()` cacheia bindings por nome; os testes chamam `clearSecretCache()` no `afterEach` para evitar acoplamento entre casos.
- `wrangler.toml` ainda contém rotas de domínio atuais; este slice removeu hardcodes do runtime `src`, não fez onboarding DNS de novos tenants.

## Decisões tomadas (delta vs plano original)

- `APP_EVENTS_HMAC` não foi substituído por outro secret homônimo; app webhook com HMAC passa a usar `integrations.{name}.hookSecretEnv`, hoje `PLANOVOO_HOOK_SECRET_DECOLE`.
- Checagem de queue foi movida para depois de validações de tenant/origem/assinatura, para não mascarar erros de segurança com `queue_not_configured`.
