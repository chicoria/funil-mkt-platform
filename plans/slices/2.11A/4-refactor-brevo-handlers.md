# Slice 2.11A.4 — Refactor handlers Brevo via ctx.credentials

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | IN_PROGRESS |
| Started | 2026-05-18 16:00 WEST por Codex |
| Completed | — |
| Commit final | — |
| PR | — |
| Janela de smoke | N/A — Fase 2 sem deploy |

## Contexto

Os handlers Brevo do `funnel-dispatcher` ainda leem `env.BREVO_API_KEY` diretamente em três pontos:

- `send_cart_abandonment_email` / `sendBrevoEmail`
- `send_brevo_doi` / `createBrevoDoiContact`
- `update_brevo_funnel` / `updateBrevoFunnel`

O schema v5 já declara `tenants.{id}.credentials.brevo_api_key_env`. Este slice faz esses handlers consumirem `HandlerContext.credentials.brevoApiKey`, preservando fallback v4 durante a janela de coexistência e suportando bindings do Cloudflare Secrets Store.

## Pré-requisitos

- [x] 2.11A.0 DONE — Secrets Store wrapper
- [x] 2.11A.1 DONE — catálogo v5 aditivo
- [x] 2.11T.3 DONE — cross-tenant-isolation baseline
- [x] 2.11T.5 DONE — bridge de mocks v4→v5
- [x] 2.11A.2 DONE — secrets `_DECOLE` populados e bindings criados
- [x] 2.11A.3 DONE — tracking por tenant
- [x] Validação humana para continuar — 2026-05-18, solicitada por chicoria

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `workers/funnel-dispatcher/src/handlers/index.ts` | EDIT | Resolver credenciais de tenant via contexto e usar em handlers Brevo |
| `workers/funnel-dispatcher/test/unit/index.test.ts` | EDIT | Cobrir DOI/cart/funnel com `brevo_api_key_env` tenant-level |
| `workers/funnel-dispatcher/test/unit/cross-tenant-isolation.test.ts` | EDIT | Cobrir isolamento de API key Brevo entre tenants |
| `plans/STATUS-2.11.md` | EDIT | Registrar slice em progresso/concluído |

### Diff conceitual

```typescript
// Antes
const apiKey = asString(env.BREVO_API_KEY);

// Depois
const ctx = await getOrCreateContext(event, env);
const apiKey = ctx.credentials.brevoApiKey;
```

## Testes

### Unit

- [x] `send_brevo_doi` usa `tenants.{id}.credentials.brevo_api_key_env`
- [x] `send_cart_abandonment_email` usa `tenants.{id}.credentials.brevo_api_key_env`
- [x] `update_brevo_funnel` usa `tenants.{id}.credentials.brevo_api_key_env`
- [x] cross-tenant: evento DECOLE usa API key DECOLE e nunca SUPERARE; evento SUPERARE usa API key SUPERARE e nunca DECOLE
- [x] Secrets Store binding `env.BREVO_API_KEY_DECOLE.get()` funciona para credenciais Brevo

### E2E

N/A — Fase 2 não faz deploy nem smoke externo.

### Mocks/fixtures necessários

- Mocks inline de catálogo v5 com `tenants.decole.credentials.brevo_api_key_env` e `tenants.superare.credentials.brevo_api_key_env`.

## Validação executável

```bash
cd workers/funnel-dispatcher && npx vitest run test/unit/index.test.ts test/unit/cross-tenant-isolation.test.ts test/unit/generic-handlers-integration.test.ts
# 2026-05-18: 45 passed, 0 failed

cd workers/funnel-dispatcher && npx vitest run test/unit/catalog-adapter.test.ts test/unit/index.test.ts test/unit/cross-tenant-isolation.test.ts test/unit/generic-handlers-integration.test.ts
# 2026-05-18: 69 passed, 0 failed

cd workers/funnel-dispatcher && npm run typecheck
# 2026-05-18: 0 erros TypeScript

cd workers/funnel-dispatcher && npx vitest run
# 2026-05-18: 172 passed, 0 failed

node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"
# 2026-05-18: JSON válido
```

## Smoke checklist

N/A — sem deploy neste slice.

## Rollback

```bash
git revert <commit_hash>
```

Validação pós-rollback: testes do dispatcher voltam ao estado anterior; nenhuma mudança externa foi aplicada.

## Revisão G.12 (Code + Architecture + Tests) — preenchido pelo revisor antes de DONE

Pendente.

---

## Execução (append-only — preenchido AO LONGO da execução)

### 2026-05-18 16:00 WEST by Codex

- O que foi tentado: recovery point confirmado em `main`, worktree limpa, commits recentes coerentes com `STATUS-2.11.md`.
- O que funcionou: identificados três handlers Brevo com leitura direta de `env.BREVO_API_KEY` e um resolver de contexto ainda síncrono.
- O que falhou: nada até agora.
- Próximo passo planejado: marcar `STATUS-2.11.md`, escrever testes red de credenciais Brevo por tenant e implementar refactor via `ctx.credentials`.

### 2026-05-18 16:02 WEST by Codex — Red

- O que foi tentado: adicionados testes para `send_brevo_doi`, `update_brevo_funnel`, `send_cart_abandonment_email`, Secrets Store binding e isolamento DECOLE/SUPERARE.
- O que falhou como esperado: handlers Brevo fizeram skip quando `BREVO_API_KEY` global estava vazio; teste cross-tenant mostrou uso da key legada global em vez das keys por tenant.
- Resultado: Red confirmado em `index.test.ts` e `cross-tenant-isolation.test.ts`.

### 2026-05-18 16:07 WEST by Codex — Green

- O que funcionou: `getOrCreateContext()` passou a resolver credenciais async via `resolveSecret()`; handlers Brevo usam `ctx.credentials.brevoApiKey`; fallback legado fica limitado à coexistência; tenant desconhecido em catálogo multi-tenant não recebe fallback global.
- Catálogo: `tenants.decole.credentials` repontado para `BREVO_API_KEY_DECOLE` e `HOTMART_WEBHOOK_TOKEN_DECOLE`; `updatedAt` já estava em 2026-05-18.
- Validação executada:
  - `cd workers/funnel-dispatcher && npm run typecheck` — 0 erros
  - `cd workers/funnel-dispatcher && npx vitest run test/unit/index.test.ts test/unit/cross-tenant-isolation.test.ts test/unit/generic-handlers-integration.test.ts` — 45 passed
  - `cd workers/funnel-dispatcher && npx vitest run test/unit/catalog-adapter.test.ts test/unit/index.test.ts test/unit/cross-tenant-isolation.test.ts test/unit/generic-handlers-integration.test.ts` — 69 passed
  - `cd workers/funnel-dispatcher && npx vitest run` — 172 passed
  - `git diff --check` — sem whitespace errors
  - `node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"` — JSON válido
  - `bash scripts/audit-workers-agnostic.sh` — não executado; script ainda não existe.
- Próximo passo planejado: commit de implementação e revisão G.12 antes de fechar o slice.

## Gotchas / lições aprendidas

Pendente.

## Decisões tomadas (delta vs plano original)

Pendente.
