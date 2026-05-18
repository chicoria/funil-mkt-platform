# Slice 2.11A.5 — Refactor integrações restantes do dispatcher

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | IN_PROGRESS |
| Started | 2026-05-18 17:52 WEST por Codex |
| Completed | — |
| Commit final | — |
| PR | — |
| Janela de smoke | N/A — Fase 2 sem deploy |

## Contexto

Depois do 2.11A.4, o `funnel-dispatcher` ainda tem integrações runtime ativas com acoplamentos legados:

- `call_product_api` lê `product_api.url_env` e `product_api.hmac_secret_env` como string direta em `ctx.env`, sem suportar Secrets Store bindings.
- URLs de recuperação de carrinho usam fallback hardcoded `https://links.decolesuacarreiraesg.com.br`.
- O contexto legado injeta fallback hardcoded `replyToEmail: "contato@decolesuacarreiraesg.com.br"`.
- O catálogo ainda aponta `DECOLE_PLANOVOO.product_api` para `PLANOVOO_API_BASE_URL` e `PLANOVOO_HOOK_SECRET` em vez dos nomes por tenant `_DECOLE`.

Decisão de escopo: `forward_n8n` e `isPlanovooProductCode` permanecem deferidos para cleanup em 2.11A.9, pois `forward_n8n` não aparece em nenhuma chain ativa.

## Pré-requisitos

- [x] 2.11A.0 DONE — Secrets Store wrapper
- [x] 2.11A.1 DONE — catálogo v5 aditivo
- [x] 2.11A.2 DONE — secrets `_DECOLE` populados e bindings criados
- [x] 2.11A.3 DONE — tracking por tenant
- [x] 2.11A.4 DONE — Brevo por `ctx.credentials`
- [x] Decisões de plan mode travadas para `forward_n8n` e `replyToEmail`

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `workers/funnel-dispatcher/src/handlers/call-product-api.ts` | EDIT | Resolver URL/HMAC via `resolveSecret()` para string legada ou binding Secrets Store |
| `workers/funnel-dispatcher/src/handlers/index.ts` | EDIT | Remover fallback hardcoded de `replyToEmail`; resolver links por `tenants.{id}.links.linksDomain` |
| `workers/funnel-dispatcher/test/unit/call-product-api.test.ts` | EDIT | Cobrir env vars `_DECOLE` e bindings Secrets Store |
| `workers/funnel-dispatcher/test/unit/generic-handlers-integration.test.ts` | EDIT | Cobrir integração com catálogo multi-tenant e sem `replyToEmail` hardcoded |
| `workers/funnel-dispatcher/test/unit/index.test.ts` | EDIT | Cobrir links de recuperação por tenant e ausência de fallback DECOLE |
| `config/products.catalog.json` | EDIT | Repointar `product_api` Plano de Voo para `_DECOLE` |
| `plans/STATUS-2.11.md` | EDIT | Registrar slice em progresso/concluído |

### Fora de escopo

- Não remover/refatorar `forward_n8n`, `N8N_WEBHOOK_URL`, `N8N_DISABLE_FORWARD` ou `isPlanovooProductCode`; cleanup fica no 2.11A.9.
- Não alterar `workerViews`/metadados legados neste slice, exceto se necessário para manter JSON válido.
- Sem deploy.

## Testes

### Unit

- [x] `call_product_api` usa `PLANOVOO_API_BASE_URL_DECOLE` e ignora valor legado divergente
- [x] `call_product_api` aceita Secrets Store binding para URL e HMAC
- [x] carrinho abandonado usa `tenants.decole.links.linksDomain` para `checkout_url`
- [x] catálogo multi-tenant sem `linksDomain` não usa domínio DECOLE hardcoded
- [x] `send_template_email`/contexto não injeta `replyToEmail` hardcoded quando catálogo não define

### E2E

N/A — Fase 2 não faz deploy nem smoke externo.

## Validação executável

```bash
cd workers/funnel-dispatcher && npm run typecheck
cd workers/funnel-dispatcher && npx vitest run test/unit/call-product-api.test.ts test/unit/generic-handlers-integration.test.ts test/unit/index.test.ts
cd workers/funnel-dispatcher && npx vitest run
node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"
git diff --check
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

### 2026-05-18 17:52 WEST by Codex

- O que foi tentado: recovery point confirmado em `main`, worktree limpa, commits recentes coerentes com `STATUS-2.11.md`.
- O que funcionou: escopo fechado para integrações runtime ativas (`call_product_api`, links de carrinho e `replyToEmail`).
- O que falhou: nada até agora.
- Próximo passo planejado: marcar status, adicionar testes Red e implementar o refactor.

### 2026-05-18 17:56 WEST by Codex

- O que foi tentado: testes Red para env vars `_DECOLE`, Secrets Store bindings, `linksDomain` por tenant, ausência de `linksDomain` e ausência de fallback hardcoded de `replyToEmail`.
- O que funcionou: testes falharam nos pontos esperados antes da implementação.
- O que falhou: `call_product_api` não resolvia binding Secrets Store; carrinho usava fallback DECOLE hardcoded; contexto legado injetava `replyToEmail` DECOLE.
- Próximo passo planejado: implementar helper de secret no `call_product_api`, resolver links por tenant e remover fallback de `replyToEmail`.

### 2026-05-18 17:59 WEST by Codex

- O que foi tentado: implementação do refactor e validações locais.
- O que funcionou:
  - `call_product_api` passou a resolver `url_env` e `hmac_secret_env` via `resolveSecret()` mantendo interface declarativa.
  - Links de carrinho multi-tenant usam `tenants.{id}.links.linksDomain`; se ausente, logam warning e retornam `fallbackCheckoutUrl`.
  - Catálogo legado sem `tenants` só usa `LINKS_BASE_URL`/`CHECKOUT_LINKS_BASE_URL`; sem constante hardcoded.
  - Fallback hardcoded de `replyToEmail` no contexto legado foi removido.
  - `DECOLE_PLANOVOO.product_api` foi repontado para `PLANOVOO_API_BASE_URL_DECOLE` e `PLANOVOO_HOOK_SECRET_DECOLE`.
- O que falhou: nada nas validações finais.
- Validação:
  - `cd workers/funnel-dispatcher && npm run typecheck` ✅
  - `cd workers/funnel-dispatcher && npx vitest run test/unit/call-product-api.test.ts test/unit/generic-handlers-integration.test.ts test/unit/index.test.ts` ✅ — 58 testes
  - `cd workers/funnel-dispatcher && npx vitest run` ✅ — 177 testes
  - `node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"` ✅
  - `git diff --check` ✅
- Próximo passo planejado: revisão G.12 e fechamento do slice.

## Gotchas / lições aprendidas

- `linksDomain` no catálogo está sem protocolo (`links.decolesuacarreiraesg.com.br`); o dispatcher normaliza para `https://...` antes de montar `URL`.
- Sem `linksDomain` em catálogo multi-tenant, o comportamento correto é mandar o usuário para o checkout Hotmart original e evitar gravar token de recuperação com domínio incorreto.
- `scripts/audit-workers-agnostic.sh` ainda não existe no repo; validação G.12 usou grep cirúrgico para os hardcodes deste slice.

## Decisões tomadas (delta vs plano original)

- `forward_n8n`, `N8N_WEBHOOK_URL`, `N8N_DISABLE_FORWARD`, `workerViews` e `isPlanovooProductCode` não foram alterados neste slice; permanecem deferidos para 2.11A.9.
- Ausência de `replyToEmail` continua permitindo envio de email; o campo `replyTo` é omitido.
