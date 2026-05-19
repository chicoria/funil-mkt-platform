# Slice 2.11A.10 — Fix identity resolution: email determinístico > anonymous_id probabilístico

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 2–3 horas

## Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |
| Commit final | — |

## Contexto

Bug descoberto em 2026-05-19: dois emails distintos (`chicoria@gmail.com` e `adilsonchicoriajardim@gmail.com`) foram linkados ao mesmo `profile_id` porque compartilhavam `anonymous_id` no mesmo browser.

**Causa raiz** — `resolveIdentityState` em `workers/funnel-dispatcher/src/handlers/index.ts:559`:
```typescript
// Prioridade atual (errada)
const profileId = state.profileId || profileIdFromEmail || profileIdFromAnon || crypto.randomUUID();
```
Quando chega `email=B` (novo) com o mesmo `anonymous_id` de `email=A`:
- `profileIdFromEmail` = null (email B não existia)
- `profileIdFromAnon` = UUID-A (herdado do anonymous_id)
- Resultado: email B herda UUID-A → merge não-autorizado

**Padrão de mercado (Segment, mParticle, RudderStack):**
> Sinais determinísticos (email) nunca são sobrescritos por sinais probabilísticos (device).
> Mesmo browser + email diferente = identidade separada.

## Pré-requisitos

- [x] 2.11A.6 DONE — funnel-dispatcher deployado em produção
- [x] Lógica de `resolveIdentityState` auditada (linhas 544–603)
- [x] Schema `identity_links` compreendido (UNIQUE por `email_hash`, UNIQUE por `anonymous_id`)

## Mudança

### Arquivo principal

| Arquivo | Linhas afetadas |
|---|---|
| `workers/funnel-dispatcher/src/handlers/index.ts` | ~559 (`resolveIdentityState`) |

### Lógica nova (3 regras claras)

```typescript
// Regra 1: email presente + email já tem perfil → match determinístico
// Regra 2: email presente + email é NOVO → novo perfil (ignorar anonymous_id)
// Regra 3: sem email → continuidade de sessão anônima (usar anonymous_id)

let profileId: string;

if (computedEmailHash) {
  if (profileIdFromEmail) {
    // Regra 1: mesmo email = mesma pessoa (determinístico)
    profileId = state.profileId || profileIdFromEmail;
  } else {
    // Regra 2: email novo no mesmo device → identidade separada
    profileId = state.profileId || crypto.randomUUID();
  }
} else {
  // Regra 3: sessão anônima — continuidade por device é aceitável
  profileId = state.profileId || profileIdFromAnon || crypto.randomUUID();
}
```

### O que NÃO muda

- Schema D1/KV — estrutura de `identity_links` permanece
- INSERTs de `anonymous_id` e `email_hash` separados — permanecem (corretos)
- Prioridade de `state.profileId` explícito — continua no topo

## Testes (TDD Red primeiro)

Arquivo de teste: `workers/funnel-dispatcher/test/unit/identity-resolution.test.ts`

### Casos obrigatórios

| # | Cenário | Input | Esperado |
|---|---|---|---|
| 1 | Email novo no mesmo device | `anonId=X` (ligado a email A), `email=B` | Novo `profile_id` (não UUID-A) |
| 2 | Mesmo email em device diferente | `anonId=Y` (novo), `email=A` (existente) | UUID-A (match determinístico) |
| 3 | Sessão anônima continuada | `anonId=X` (ligado a UUID-A), sem email | UUID-A (continuidade) |
| 4 | Novo usuário anônimo | `anonId=Z` (novo), sem email | Novo UUID |
| 5 | profile_id explícito no payload | qualquer `anonId`, qualquer email | O `profile_id` explícito (prioridade máxima) |
| 6 | Mesmo email, mesmo device | `anonId=X` (ligado a email A), `email=A` | UUID-A (match determinístico) |

### Isolamento cross-tenant (obrigatório)

- Tenant A não pode herdar `profile_id` de tenant B mesmo que `anonymous_id` coincida

## Validação executável

```bash
cd workers/funnel-dispatcher

# Red (antes da implementação)
npx vitest run test/unit/identity-resolution.test.ts
# Esperado: todos os casos falhando

# Green (após implementação)
npx vitest run
# Esperado: todos passed, 0 failed

# Typecheck
npx tsc --noEmit
# Esperado: 0 errors

# Audit grep — worker deve permanecer agnóstico
bash ../../scripts/audit-workers-agnostic.sh
# Esperado: 0 matches DECOLE/PLANOVOO em src/
```

## Smoke checklist

- [ ] Testes Green (incluindo os 6 casos acima)
- [ ] `tsc --noEmit` limpo
- [ ] Audit grep 0 matches
- [ ] Testar manualmente: buscar dois emails distintos no dashboard → `profile_id` diferentes
- [ ] Nenhum perfil DECOLE real afetado negativamente (dados históricos preservados)
- [ ] Deploy em produção (slice separado 2.11A.11 ou inline aqui)

## Rollback

```bash
git revert <commit_hash>
cd workers/funnel-dispatcher && wrangler deploy
```

Validação pós-rollback: `identity_links` com múltiplos emails por profile_id volta a ser possível.

## Revisão G.12

> ⛔ **GUARD RAIL:** agente implementador NÃO pode auto-aprovar este bloco.
> Revisão obrigatória = lançar agente separado antes de marcar DONE.
> Este slice afeta lógica de identidade crítica — revisão por agente externo é especialmente importante.

(a preencher pelo revisor externo)

---

## Execução (append-only)

### 2026-05-19 por Claude Sonnet 4.6

- Bug identificado via análise de dados D1: `chicoria@gmail.com` e `adilsonchicoriajardim@gmail.com` linkados ao mesmo `profile_id` `207223d0` por `anonymous_id=a5505e82` compartilhado
- Causa raiz confirmada em `handlers/index.ts:559`
- Padrão de mercado consultado: sinais determinísticos (email) > probabilísticos (device)
- Slice criado com design antes de qualquer código

## Gotchas / lições aprendidas

- O índice UNIQUE em `identity_links(tenant_id, email_hash)` já garante que o mesmo email só pode ter um `profile_id`. O bug está na RESOLUÇÃO, não na persistência.
- O `state.profileId` (passado explicitamente no payload) deve sempre ter prioridade máxima — é o caso de checkout recovery onde o `profile_id` é conhecido.
- Dados históricos já mergeados (como o caso atual) NÃO são desmergeados automaticamente. Uma limpeza de dados pontual pode ser feita manualmente se necessário.

## Decisões tomadas

- **Não retroativa:** a correção afeta eventos futuros; profiles já mergeados incorretamente ficam como estão (limpeza de dados é decisão do owner)
- **Deploy inline:** após Green + G.12, fazer `wrangler deploy` do funnel-dispatcher no mesmo slice (não criar slice separado de deploy para este fix)
