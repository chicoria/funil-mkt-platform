# Slice 2.11A.0 — Cloudflare Secrets Store: setup + helper wrapper

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 4-6 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 ~01:15 por Claude Code (agent) |
| Completed | 2026-05-18 ~01:58 por Claude Code (agent) |
| Commit final | `e835fe1` |
| PR | (commit direto na main, sem PR — bootstrap) |
| Janela de smoke | N/A (não-disruptivo) |
| Cloudflare Secrets Store ID | `23bdc9c2e8ca470d82352c53ec8d2e67` (nome: `default_secrets_store` — único permitido pela conta hoje) |

## Contexto

Fundação da migração de secrets para Cloudflare Secrets Store (vs `wrangler secret put` per-worker). Sem isso, slices subsequentes não têm onde popular os secrets `*_DECOLE`. Helper wrapper preserva compatibilidade com worker secrets antigos durante janela de coexistência (Fase 1→4). Ver satélite 1, seção 8.2 ("Onde os secrets vivem").

## Pré-requisitos

- [x] PLANO-MASTER aprovado pelo humano (Fase 0 pode iniciar)
- [ ] Acesso Cloudflare API com permissions: `Workers Scripts:Edit`, `Secrets Store:Edit` (a confirmar)
- [ ] `CF_API_TOKEN` e `CF_ACCOUNT_ID` disponíveis (a confirmar antes de criar o Store)
- [x] `packages/shared` existe e é importável pelos workers (confirmado)

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `packages/shared/src/secrets-store-wrapper.ts` | CREATE | Helper que lê via `await env.X.get()` (Secrets Store) com fallback para `env.X` string (worker secret legado) |
| `packages/shared/test/unit/secrets-store-wrapper.test.ts` | CREATE | 6 testes cobrindo: string OK, binding OK, cache local, undefined throws, empty value throws, clearCache funciona |

**Sem mudança em wrangler.toml nesta fase.** Bindings só na Fase 1 (slice 2.11A.2).

**Sem mudança no catálogo nesta fase.** Schema v5 começa em 2.11A.1.

**Sem mudança em workers nesta fase.** Refactor para usar o wrapper começa em Fase 2.

### Diff conceitual

```typescript
// packages/shared/src/secrets-store-wrapper.ts (NOVO)

export interface SecretsStoreBinding {
  get(): Promise<string>;
}

export type SecretValue = string | SecretsStoreBinding | undefined;

const cache = new Map<string, string>();

/**
 * Resolve secret value supporting both:
 * - Cloudflare Secrets Store binding: `await env.X.get()`
 * - Legacy worker secret: `env.X` as string (fallback durante Fase 1→4)
 *
 * Throws if neither source provides a value (fail-fast vs silent fallback).
 */
export async function resolveSecret(
  binding: SecretValue,
  name: string,
): Promise<string> {
  // String legada (worker secret): valor direto
  if (typeof binding === "string" && binding.length > 0) {
    return binding;
  }

  // Secrets Store binding: cache + fetch
  if (binding && typeof binding === "object" && "get" in binding) {
    if (cache.has(name)) return cache.get(name)!;
    const value = await binding.get();
    if (!value) {
      throw new Error(`SecretsStore: ${name} returned empty value`);
    }
    cache.set(name, value);
    return value;
  }

  // Fail-fast: nenhum dos dois
  throw new Error(`SecretsStore: ${name} not found (no binding, no string)`);
}

export function clearSecretCache(): void {
  cache.clear();
}
```

## Testes

### Unit

- [ ] `resolveSecret(stringValue)` retorna a string
- [ ] `resolveSecret({get: () => "value"})` retorna "value" via await
- [ ] Chamadas repetidas usam cache (mock `get()` chamado 1×)
- [ ] `resolveSecret(undefined)` throws com mensagem clara
- [ ] `resolveSecret({get: () => ""})` throws (empty value não é válido)
- [ ] `clearSecretCache()` esvazia cache (próxima chamada refaz fetch)

### Mocks/fixtures necessários

Nenhum. Testes usam objetos inline.

## Validação executável

```bash
# 1. Testes verdes
cd packages/shared && npx vitest run secrets-store-wrapper
# Esperado: 6 passed, 0 failed

# 2. Typecheck
cd packages/shared && npx tsc --noEmit
# Esperado: 0 errors

# 3. Criar Secrets Store via API Cloudflare (REQUER CF_API_TOKEN + CF_ACCOUNT_ID)
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/secrets_store/stores" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "funilmkt-prod-secrets"}'
# Esperado: 200 OK com {"result": {"id": "<store-id>", "name": "funilmkt-prod-secrets"}}
# REGISTRAR store-id retornado em STATUS-2.11.md para próximos slices.
```

## Smoke checklist

- [ ] Cloudflare UI mostra Secrets Store `funilmkt-prod-secrets` criado (vazio)
- [ ] Wrapper compila sem erros TypeScript (`npx tsc --noEmit` em packages/shared)
- [ ] CI gates passam: typecheck + unit (sem mudanças em workers)

## Rollback

```bash
# 1. Deletar Secrets Store (se foi criado)
curl -X DELETE \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/secrets_store/stores/${STORE_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"

# 2. Reverter código
git revert <commit_hash>
```

Validação pós-rollback: `curl GET /secrets_store/stores` não lista `funilmkt-prod-secrets`; `packages/shared/src/secrets-store-wrapper.ts` não existe.

## Execução (append-only)

### 2026-05-18 ~01:15 by Claude Code

- O que foi tentado: criação do slice file + implementação do wrapper TDD
- Próximo passo: criar testes (Red), implementar wrapper (Green), rodar `npx vitest run`

### 2026-05-18 ~01:55 by Claude Code

- TDD Red: criado `test/unit/secrets-store-wrapper.test.ts` com 7 testes
- `npx vitest run secrets-store-wrapper` confirmou falha (módulo não existe) — Red ✅
- TDD Green: criado `src/secrets-store-wrapper.ts` (78 linhas) com `resolveSecret` + `clearSecretCache` + interface `SecretsStoreBinding`
- `npx vitest run secrets-store-wrapper` → 7/7 passed ✅
- `npx vitest run` (suite completa de packages/shared) → 35/35 passed (sem regressão) ✅
- `npx tsc --noEmit` → 0 erros nos arquivos novos (erros pré-existentes em `transactional-email.test.ts` são alheios)

### 2026-05-18 ~01:58 by Claude Code

- Tentativa de criar Secrets Store `funilmkt-prod-secrets` via Cloudflare API → erro `maximum_stores_exceeded` (code 1003)
- **Descoberta:** Cloudflare Secrets Store em beta tem **limite de 1 store por account**. Apenas o `default_secrets_store` (criado automaticamente pela Cloudflare) está disponível, ID `23bdc9c2e8ca470d82352c53ec8d2e67`.
- Tentativa de renomear o `default_secrets_store` via PATCH → erro `method_not_allowed`. Nome é fixo.
- **Decisão (ver "Decisões tomadas" abaixo):** usar `default_secrets_store` como único Secrets Store; diferenciar prod vs staging por sufixo no nome do secret (`_STG`).
- Store confirmado vazio (`GET /secrets` retorna `result: []`) — pronto para popular na Fase 1 (slice 2.11A.2).
- Próximo passo: documentar decisão no satélite 1 + STATUS + commit + fechar slice.

## Revisão G.12 (Code + Architecture + Tests)

> Este é um slice de Fase 0 (fundação, não-disruptivo) — auto-revisão é aceita conforme exceção em G.12.

### 2026-05-18 ~02:00 by Claude Code (auto-revisão — Fase 0, exceção G.12)

**Código TypeScript**
- [x] Strict mode respeitado — sem `any`, sem `!` não justificado
- [x] Funções puras (`resolveSecret` é async pura, sem side effects além do cache); erros com mensagem clara (`${name} not found`, `${name} returned empty value`)
- [x] Nomes expressivos: `resolveSecret`, `clearSecretCache`, `SecretsStoreBinding`, `SecretValue`
- [x] 0 referências hardcoded a DECOLE, PLANOVOO ou qualquer tenant/produto

**Arquitetura**
- [x] Módulo sem dependência do catálogo — propositalmente agnóstico (é infraestrutura, não config)
- [x] Sem fallback silencioso para tenant default — lança erro explícito
- [x] Cache module-level é equivalente ao isolate-scoped de Cloudflare Workers — design correto
- [x] O mesmo wrapper funcionaria para SUPERARE sem mudança de código

**Testes**
- [x] TDD Red verificado — teste criado antes da implementação (erro `Cannot find module`)
- [x] 7 testes cobrindo: string OK, binding OK, cache (1× get), undefined throws, empty binding throws, clearCache invalida cache, empty string treat as missing
- [x] Mocks inline com `vi.fn()` — sem state compartilhado (afterEach `clearSecretCache()`)
- [x] Isolamento N/A neste slice (wrapper é genérico, sem lógica de tenant)
- [x] Nomes descrevem comportamento ("returns string value directly when...", "caches binding result across repeated calls")
- [x] Nenhum `it.only` ou `describe.skip`

**Slice file**
- [x] Seção `Execução` preenchida com 3 entradas append-only
- [x] Decisão tomada documentada (1 store global em vez de 2 — limite beta)
- [x] Gotchas registrados (limite do Secrets Store, `default_secrets_store` não renomeável, cache sem TTL)

**Resultado:** APROVADO

Ressalvas menores (não bloqueantes — registrar no backlog):
1. **Cache sem TTL:** se um secret for rotacionado sem redeploy, isolates ativos continuarão servindo valor antigo. Aceitável com a política "rotação acompanha redeploy". Se necessário no futuro, adicionar TTL opcional (ex: `resolveSecret(binding, name, { ttlMs: 60_000 })`).
2. **`clearSecretCache()` é global** (limpa todo o cache, não por secret específico). Para N workers com N secrets, um redeploy limpa tudo — comportamento correto e desejado.

## Gotchas / lições aprendidas

- **Cloudflare Secrets Store é beta com limite de 1 store por account.** Documentar isso no satélite 1 evita que outros agentes tentem criar `funilmkt-staging-secrets` e batam no mesmo erro.
- **`default_secrets_store` é fixo** — nome não é renomeável. Aceitar como nome do hub único de secrets.
- **Isolamento prod vs staging via sufixo** (`_STG`) é workaround necessário, não ideal. Vazamento de API token com permissão de leitura agora dá acesso a todos os secrets (prod E staging). Mitigação: **API tokens fine-grained** com policy restringindo `secret_name patterns` por ambiente — a confirmar suporte da Cloudflare.

## Decisões tomadas (delta vs plano original)

### Decisão 1: 1 Secrets Store global em vez de 2 separados (prod + staging)

- **Plano original:** satélite 1 seção 10.2 propunha 2 stores separados (`funilmkt-prod-secrets` + `funilmkt-staging-secrets`) com mesmo naming dentro.
- **Realidade descoberta:** Cloudflare Secrets Store em beta tem limite de 1 store por account (erro `maximum_stores_exceeded`).
- **Decisão aplicada:** usar `default_secrets_store` (ID `23bdc9c2e8ca470d82352c53ec8d2e67`) como único hub. Diferenciar prod vs staging por **sufixo no nome do secret** (`BREVO_API_KEY_DECOLE` para prod, `BREVO_API_KEY_DECOLE_STG` para staging).
- **Trade-off:** isolamento por store some; isolamento por API token continua viável (tokens com policy restringindo `secret_name patterns`). Pior do que ter 2 stores, mas único caminho disponível hoje.
- **Plano/satélite atualizado:** satélite 1 seção 10.2 reescrita refletindo essa realidade. STATUS-2.11.md atualizado com store_id real.
- **Reversão futura:** se Cloudflare aumentar limite no GA, podemos migrar para 2 stores (slice futuro 2.12.X — não bloqueia 2.11).

### Decisão 2: Cache do wrapper é instância-local, não persistente

- Cache é um `Map<string, string>` no módulo. Reinstanciação do Worker isolate (a cada deploy ou cold start) invalida automaticamente.
- Não há TTL — se um secret for rotacionado, isolates que já cachearam continuam servindo o valor antigo até o próximo deploy.
- Mitigação aceita: rotação de secret em prod sempre acompanhada de redeploy de workers consumidores (já é prática padrão). Documentar no runbook futuro.
