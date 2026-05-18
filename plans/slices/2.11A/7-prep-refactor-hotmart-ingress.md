# Slice 2.11A.7-prep — Refactor api-hotmart-ingress

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | IN_PROGRESS |
| Started | 2026-05-18 18:22 WEST por Codex |
| Completed | — |
| Commit final | — |
| PR | — |
| Janela de smoke | N/A — Fase 2 sem deploy |

## Contexto

Depois do 2.11A.5, o `api-hotmart-ingress` ainda autentica webhooks com token global antes de resolver tenant, usa fallback silencioso para DECOLE e mapeia slugs Hotmart por switch hardcoded. Este slice torna o ingress catalog-driven: hostname resolve tenant, slug resolve produto dentro desse tenant, e token vem de `tenants.{id}.credentials.hotmart_token_env`.

Decisões travadas: hostname obrigatório, sem `DEFAULT_TENANT_ID`, sem fallback legado `HOTMART_WEBHOOK_TOKEN`.

## Pré-requisitos

- [x] 2.11A.0 DONE — Secrets Store wrapper
- [x] 2.11A.1 DONE — catálogo v5 aditivo com `hotmart.urlSlugs`
- [x] 2.11A.2 DONE — `HOTMART_WEBHOOK_TOKEN_DECOLE` criado e binding em wrangler
- [x] 2.11A.5 DONE — dispatcher sem integrações runtime DECOLE restantes neste escopo

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `workers/api-hotmart-ingress/src/index.ts` | EDIT | Resolver tenant/produto/token via catálogo e Secrets Store |
| `workers/api-hotmart-ingress/test/unit/index.test.ts` | EDIT | Cobrir auth por tenant, slug por tenant e fail-fast |
| `workers/api-hotmart-ingress/wrangler.toml` | EDIT | Remover `DEFAULT_TENANT_ID`; manter binding `_DECOLE` |
| `config/products.catalog.json` | EDIT | Atualizar `workerViews.api-hotmart-ingress.secrets` para `_DECOLE` |
| `plans/STATUS-2.11.md` | EDIT | Registrar slice em progresso/concluído |
| `plans/PLANO-MASTER-MULTI-TENANT.md` | EDIT | Atualizar cabeçalho ao fechar |

### Fora de escopo

- Não fazer deploy; deploy/smoke real fica para 2.11A.7.
- Não remover `global.hotmart.auth.secretEnvVar`; cleanup fica para 2.11A.9.
- Não refatorar `api-funnel-ingress`; próximo slice 2.11A.8-prep.

## Testes

### Unit

- [x] Hostname desconhecido retorna `400 unknown_tenant`, mesmo com `DEFAULT_TENANT_ID` presente
- [x] Slug conhecido em outro tenant retorna `404 unknown_product_slug`
- [x] Token legado `HOTMART_WEBHOOK_TOKEN` não autentica tenant
- [x] Token por tenant correto autentica e enfileira com `tenant_id`/`product_code`
- [x] Token por tenant via Secrets Store binding autentica
- [x] Token de outro tenant não autentica tenant resolvido
- [x] Secret por tenant ausente/misconfigured retorna `500 secret_misconfigured`
- [x] Payload normalizado e lifecycle Hotmart existentes permanecem equivalentes

### E2E

N/A — Fase 2 não faz deploy nem smoke externo.

## Validação executável

```bash
cd workers/api-hotmart-ingress && npm run typecheck
cd workers/api-hotmart-ingress && npx vitest run
node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"
git diff --check
rg -n 'DECOLE|PLANOVOO|decole-esg|planovoo|plano-de-voo|HOTMART_WEBHOOK_TOKEN|DEFAULT_TENANT_ID' workers/api-hotmart-ingress/src
```

## Smoke checklist

N/A — sem deploy neste slice.

## Rollback

```bash
git revert <commit_hash>
```

Validação pós-rollback: testes do `api-hotmart-ingress` voltam ao estado anterior; nenhuma mudança externa foi aplicada.

## Revisão G.12 (Code + Architecture + Tests) — preenchido pelo revisor antes de DONE

Pendente.

---

## Execução (append-only — preenchido AO LONGO da execução)

### 2026-05-18 18:22 WEST by Codex

- O que foi tentado: recovery point confirmado em `main`, worktree limpa e próximo slice confirmado no `STATUS-2.11.md`.
- O que funcionou: escopo fechado para resolver tenant/produto/token no `api-hotmart-ingress` por catálogo, sem fallback para DECOLE.
- O que falhou: nada até agora.
- Próximo passo planejado: marcar status, adicionar testes Red e implementar o refactor.

### 2026-05-18 18:28 WEST by Codex

- O que foi tentado: testes Red para hostname obrigatório, slug escopado por tenant, token legado ignorado, token por tenant via string/binding e secret ausente.
- O que funcionou: `npx vitest run` falhou em 7 testes, todos nos pontos esperados do comportamento legado.
- O que falhou: o código ainda autorizava sem token por tenant, aceitava fallback de tenant e ignorava binding `_DECOLE`.
- Próximo passo planejado: implementar resolução por catálogo e Secrets Store.

### 2026-05-18 20:02 WEST by Codex

- O que foi tentado: implementação do refactor e validações locais.
- O que funcionou:
  - Tenant agora é resolvido estritamente por hostname via catálogo.
  - Produto é resolvido via `findProductByHotmartSlug(catalog, tenantId, slug)`.
  - Token Hotmart é resolvido com `resolveSecret()` a partir de `tenants.{id}.credentials.hotmart_token_env`.
  - `DEFAULT_TENANT_ID`, `HOTMART_WEBHOOK_TOKEN` e switch hardcoded de slug foram removidos do runtime do worker.
  - `workerViews.api-hotmart-ingress.secrets` foi atualizado para `HOTMART_WEBHOOK_TOKEN_DECOLE`.
- O que falhou: nada nas validações finais.
- Validação:
  - `cd workers/api-hotmart-ingress && npm run typecheck` ✅
  - `cd workers/api-hotmart-ingress && npx vitest run` ✅ — 13 testes
  - `node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"` ✅
  - `git diff --check` ✅
  - `rg -n 'DECOLE|PLANOVOO|decole-esg|planovoo|plano-de-voo|HOTMART_WEBHOOK_TOKEN|DEFAULT_TENANT_ID' workers/api-hotmart-ingress/src` ✅ — 0 matches
- Próximo passo planejado: commit de implementação e revisão G.12 antes de fechar o slice.

## Gotchas / lições aprendidas

- O `api-hotmart-ingress` precisa resolver tenant/produto antes de autenticar, porque o nome do secret vem do tenant resolvido.
- `CATALOG_JSON` nos testes permite fixture multi-tenant sem alterar o catálogo real; produção continua usando o catálogo bundled.
- `resolveSecret()` cacheia bindings por nome; os testes chamam `clearSecretCache()` no `afterEach` para evitar acoplamento entre casos.

## Decisões tomadas (delta vs plano original)

- Fallback de `CATALOG_JSON` inválido para catálogo bundled foi mantido para tolerância local; isso não reintroduz fallback de tenant, pois tenant desconhecido ainda retorna `400`.
