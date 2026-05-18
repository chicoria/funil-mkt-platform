# Plano 1 — Separação de Responsabilidades (FunilMKT ↔ Plano de Voo)

> **Status:** ✅ Concluído — 2026-05-14
> **Pré-requisito:** Nenhum
> **Resultado:** Plano de Voo expõe APIs próprias. FunilMKT chama por HTTP+HMAC. Nenhum acesso direto ao DB do produto.

---

## Histórico de Execução

### Slice 1.1 — APIs no Plano de Voo ✅

**Data:** 2026-05-14
**Commit:** `c488bbf` (repo `decole-plano-de-voo-app`, branch `main`)
**Testes:** 53 passando (7 auth + 12 repository + 10 service + 8 purchase route + 5 refund route + 5 protest route + 3+3 outros)

**Arquivos criados:**
- `lib/hooks/auth.ts` — `validateHmac(body, signature, secret)` com `timingSafeEqual`
- `lib/hooks/token-repository.ts` — `createTokenForPurchase()` (idempotente via UNIQUE em `hotmart_transacao`, retry UUID colisão até 3x), `cancelByTransacao()`, `suspendByTransacao()` (ambos com `RETURNING token` para cache invalidation)
- `lib/hooks/token-service.ts` — `handlePurchase()`, `handleRefund()`, `handleProtest()` com `revalidateTag('plano-${token}')` em status changes
- `app/api/hooks/purchase/route.ts` — POST → 201 `{ token }`, idempotente
- `app/api/hooks/refund/route.ts` — POST → 200 `{ updated: N }`
- `app/api/hooks/protest/route.ts` — POST → 200 `{ updated: N }`
- Todos os arquivos de teste correspondentes em `__tests__/` e `route.test.ts`

**Decisões da revisão aplicadas:**
- M4: `cancelByTransacao`/`suspendByTransacao` retornam tokens afetados e chamam `revalidateTag` no service
- M5: `PurchasePayload` é `type PurchasePayload = CreateTokenParams` (sem duplicação)
- M6: JSON parse error retorna 400 (separado do catch genérico 500)
- Padrão `vi.hoisted()` para mocks que referenciam variáveis

---

### Slice 1.2 — Dispatcher chama APIs ✅

**Data:** 2026-05-14
**Repo:** `decolesuacarreiraesg` (FunilMKT Workers)
**Testes:** 14 testes unitários passando (API calls + HMAC + error propagation)

**Arquivos criados:**
- `workers/funnel-dispatcher/src/handlers/call-plano-voo-api.ts` — 3 handlers (`callPlanoVooPurchase`, `callPlanoVooRefund`, `callPlanoVooProtest`) com `fetch()` + HMAC-SHA256 (Web Crypto API)
- `workers/funnel-dispatcher/test/unit/call-plano-voo-api.test.ts`

**Nota:** Neste ponto os handlers chamavam apenas as APIs, sem enviar email. O envio de email foi incorporado no Slice 1.3.

---

### Slice 1.3 — Remover acoplamento + mover emails ✅

**Data:** 2026-05-14
**Repo:** `decolesuacarreiraesg` (FunilMKT Workers)
**Testes:** 41 passando (21 integração + 20 unitários)

**Decisão arquitetural:** O email transacional (Brevo) foi movido para dentro dos novos handlers `call_plano_voo_*`, eliminando a dependência dos antigos `send_plano_voo_*` handlers que usavam Hyperdrive.

**Arquivos criados/modificados:**

| Arquivo | Ação | Detalhe |
|---------|------|---------|
| `src/handlers/call-plano-voo-api.ts` | Reescrito | Agora inclui: `BrevoTransactionalEmailSender` (de `packages/shared/transactional-email`), `resolveEmailConfig()` lê template IDs do catálogo com fallback para bundled catalog, `extractHotmartPayload()` com `primeiroNome`, `valorFormatado` (BRL), `dataFormatada` (DD/MM/YYYY São Paulo) |
| `test/unit/call-plano-voo-api.test.ts` | Reescrito | 20 testes: API calls + email sending + error propagation (API e Brevo) + edge cases (flat payload, trailing slash, missing name, missing transacao) |
| `src/handlers/index.ts` | Modificado | Importa e registra `call_plano_voo_purchase`, `call_plano_voo_refund`, `call_plano_voo_protest` em `createHandlers()` |
| `src/dispatcher.ts` | Modificado | Adicionado `PLANOVOO_API_BASE_URL` e `PLANOVOO_HOOK_SECRET` ao `DispatcherEnv`. Removido `forward_n8n` do `DEFAULT_CHAIN_MAP` |
| `config/products.catalog.json` | Modificado | Chains do DECOLE_PLANOVOO: `forward_n8n` → `call_plano_voo_purchase`/`call_plano_voo_refund`/`call_plano_voo_protest`. Removido `forward_n8n` do DECOLE_ESG_MENTORIA (não usa n8n, acesso ao curso é entregue pela Hotmart). Adicionadas definições de handlers e secrets |
| `test/unit/index.test.ts` | Modificado | 2 testes de integração atualizados para nova arquitetura (env vars + fetch mock) |

**Decisões da revisão aplicadas:**
- C2/M3: `getCatalogForEmail()` agora faz fallback para bundled catalog (`bundledCatalogJson`) em vez de retornar `{}`
- M2: Log `handler_warn` quando refund/protest pula API call por falta de `transacao`
- L2: Adicionado teste de propagação de erro do Brevo (fatal para queue retry)

**O que foi removido:**
- `forward_n8n` de todas as chains do catálogo (nenhum produto mais usa)
- `forward_n8n` do `DEFAULT_CHAIN_MAP` em `dispatcher.ts`

**O que NÃO foi removido (ainda):**
- `forward_n8n` handler code em `index.ts` — permanece registrado mas não referenciado por nenhuma chain
- `packages/planovoo/` — referência para Plano 2
- `N8N_WEBHOOK_URL` e `N8N_DISABLE_FORWARD` em `DispatcherEnv` — cleanup em Plano 2

**Nota sobre Hyperdrive:** O `wrangler.toml` já não continha binding Hyperdrive (`PLANOVOO_DB`) — havia sido removido anteriormente. Nenhuma alteração necessária.

---

## Contexto

### Problema

O `funnel-dispatcher` (Cloudflare Workers) importava `packages/planovoo` e acessava o PostgreSQL do Plano de Voo via Hyperdrive para:
- Criar tokens (`createToken` com UUID, retry em colisão, idempotência por transação)
- Atualizar status (`updateTokenStatusByTransacao` para CANCELADO/SUSPENSO)
- Enviar emails transacionais (purchase link, refund, protest)

Isso violava bounded contexts: o funil sabia detalhes do produto (schema de tokens, conexão DB, lógica de negócio).

### Arquitetura resultante

```
funnel-dispatcher                          Plano de Voo (Next.js)
  │                                           │
  ├─ PURCHASE_APPROVED                        │
  │   → [...generic handlers]                 │
  │   → call_plano_voo_purchase ──HTTP+HMAC──→ POST /api/hooks/purchase
  │     └── cria token (idempotente)           │   → TokenService.handlePurchase()
  │     └── envia email Brevo (purchase link)  │   → retorna { token }
  │                                           │
  ├─ PURCHASE_REFUNDED / CANCELED / ...       │
  │   → call_plano_voo_refund ───HTTP+HMAC──→ POST /api/hooks/refund
  │     └── envia email Brevo (refund)         │   → marca CANCELADO, revalidateTag
  │                                           │
  ├─ PURCHASE_PROTEST                         │
  │   → call_plano_voo_protest ──HTTP+HMAC──→ POST /api/hooks/protest
  │     └── envia email Brevo (protest)        │   → marca SUSPENSO, revalidateTag
```

---

## Decisões Arquiteturais

### 1. Camadas no Plano de Voo (Next.js)

```
Route Handler (app/api/hooks/*)
  └── validates HMAC auth (timingSafeEqual)
  └── calls TokenService
        └── business logic (idempotência, validação, cache invalidation)
        └── calls TokenRepository
              └── pg Pool queries (lib/db.ts existente)
```

### 2. Auth: HMAC Signature

O dispatcher assina cada request com HMAC-SHA256 (Web Crypto API). O Plano de Voo valida com `timingSafeEqual`.

```
Header: x-signature: sha256=<hmac_hex>
Secret: PLANOVOO_HOOK_SECRET (env var em ambos os lados)
Payload: request body (JSON string)
```

### 3. Idempotência

`TokenRepository.createTokenForPurchase()` é idempotente via UNIQUE constraint parcial em `plano_voo_tokens(hotmart_transacao) WHERE hotmart_transacao IS NOT NULL`. Transação duplicada retorna token existente.

### 4. Email transacional

Usa `BrevoTransactionalEmailSender` de `packages/shared/transactional-email`. Template IDs lidos do catálogo (`products.catalog.json`), com fallback para bundled catalog.

| Template | ID | Uso |
|----------|----|-----|
| purchaseLink | 12 | Email com link do formulário |
| refunded | 13 | Email de reembolso |
| protest | 14 | Email de contestação |

---

## Processo por Slice

Cada slice seguiu o ciclo:
1. **TDD Red → Green → Refactor** com Vitest
2. **Revisão por agente especialista em TypeScript e TDD** — verificou tipagem, cobertura, edge cases, aderência a padrões, artefatos impactados (scripts, testes e2e, CI/CD, docs). Só avançou ao próximo slice após revisão aprovada.

---

## Env vars

| Var | Onde | Valor |
|-----|------|-------|
| `PLANOVOO_HOOK_SECRET` | Workers (dispatcher) | Shared secret para HMAC |
| `PLANOVOO_HOOK_SECRET` | Next.js (Plano de Voo) | Mesmo shared secret |
| `PLANOVOO_API_BASE_URL` | Workers (dispatcher) | `https://plano.decolesuacarreiraesg.com.br` |
| `BREVO_API_KEY` | Workers (dispatcher) | API key do Brevo (já existia) |

## Próximo passo

→ **Plano 2 — Dispatcher Genérico + Multi-Tenant** (`docs/PLANO-2-DISPATCHER-GENERICO.md`)
