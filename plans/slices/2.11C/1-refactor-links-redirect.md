# Slice 2.11C.1 — Refatorar links-redirect (catálogo + lookup)

> Satélite: 2.11C ([`../../PLANO-LINKS-REDIRECT-MULTI-TENANT.md`](../../PLANO-LINKS-REDIRECT-MULTI-TENANT.md))
> Estimativa: 4–6 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 por Claude Sonnet 4.6 |
| Completed | 2026-05-18 por Claude Sonnet 4.6 |
| Commit final | `92bb29a` |
| PR | — |
| Janela de smoke | N/A — Fase 2 (sem deploy) |

## Contexto

`workers/links-redirect` tem `DEFAULT_TENANT_ID = "decole"` hardcoded, switch de paths DECOLE/PLANOVOO, número de WhatsApp ELIZETE hardcoded em env var, e `LINKS_PRODUCTS` JSON em env var. Este slice remove tudo isso e faz o worker ler rotas e contatos do `config/products.catalog.json` bundled. Habilita onboarding de novo tenant sem mudar código.

Pré-requisito: catálogo v5 já tem `tenants.decole.links.routes`, `tenants.decole.links.contacts` e `products.*.links.checkoutBaseUrl` (confirmado).

## Pré-requisitos

- [x] 2.11A.1 DONE — catálogo v5 com `tenants.{id}.links` e `products.{code}.links`
- [x] `packages/shared/src/tenant-from-hostname.ts` — `tryResolveTenantIdFromHostname` disponível
- [x] `config/products.catalog.json` tem `decole.links.routes`, `.contacts`, `products.*.links.checkoutBaseUrl`

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `workers/links-redirect/src/index.ts` | EDIT | Remover hardcode DECOLE/ELIZETE; bundlar catálogo; resolver tenant do hostname |
| `workers/links-redirect/tsconfig.json` | EDIT | Adicionar `resolveJsonModule: true` |
| `workers/links-redirect/test/unit/route-resolver.test.ts` | CREATE | Testes unitários de `resolveCheckoutByCatalog` |
| `workers/links-redirect/test/unit/contact-handler.test.ts` | CREATE | Testes unitários de `resolveContact` |
| `workers/links-redirect/test/index.test.ts` | EDIT | Atualizar `makeEnv` (remover env vars de tenant); remover teste LINKS_PRODUCTS |

### Diff conceitual

```typescript
// Antes
const DEFAULT_TENANT_ID = "decole";
function inferProductCodeByPath(path) { /* switch DECOLE hardcoded */ }
function resolveCheckoutProductByPath(path, env) { /* fallback DECOLE env vars */ }
const handlers = { "elizete-wp": handleElizeteWhatsapp }; // estático

// Depois
import bundledCatalogJson from "../../../config/products.catalog.json";
// export para teste:
export function resolveCheckoutByCatalog(catalog, tenantId, path): LinksProductConfig | null
export function resolveContact(catalog, tenantId, slug): CatalogContact | null
// fetch handler resolve tenant via tryResolveTenantIdFromHostname → fail-fast 404 se unknown
```

## Testes

### Unit (TDD Red primeiro)

- `test/unit/route-resolver.test.ts`:
  - `resolveCheckoutByCatalog(catalog, 'decole', '/decole-esg/checkout')` → config ESG
  - `resolveCheckoutByCatalog(catalog, 'decole', '/plano-de-voo/checkout')` → config PlanoVoo
  - `resolveCheckoutByCatalog(catalog, 'decole', '/checkout')` → config legacy ESG
  - `resolveCheckoutByCatalog(catalog, 'decole', '/rota-desconhecida')` → null
  - Isolamento: `resolveCheckoutByCatalog(catalog, 'superare-test', '/decole-esg/checkout')` → null (tenant desconhecido)

- `test/unit/contact-handler.test.ts`:
  - `resolveContact(catalog, 'decole', 'elizete-wp')` → `{ type: 'whatsapp', number: '...', defaultText: '...' }`
  - `resolveContact(catalog, 'decole', 'slug-inexistente')` → null
  - `resolveContact(catalog, 'superare-test', 'elizete-wp')` → null (contact não existe no tenant)

### Integração (via worker.fetch — golden master preservado)

Todos os testes em `test/index.test.ts` existentes devem passar sem mudança de comportamento:
- healthcheck, WhatsApp, checkout, offer, recovery, BEGIN_CHECKOUT

## Validação executável

```bash
# 1. Red — antes da implementação
cd workers/links-redirect && npx vitest run
# Esperado: testes unitários falham (funções não exportadas ainda)

# 2. Green — após implementação
cd workers/links-redirect && npx vitest run
# Esperado: todos passed, 0 failed

# 3. Typecheck
cd workers/links-redirect && npx tsc --noEmit
# Esperado: 0 errors

# 4. Audit grep — critério de aceite de Fase 2
grep -rE "DECOLE|PLANOVOO|ESG|SUPERARE|ELIZETE|decolesuacarreiraesg|planodevoo|plano-de-voo|decole-esg|351915787088" \
  workers/links-redirect/src/
# Esperado: 0 matches (exceto comentários)
```

## Smoke checklist

- [x] `npx vitest run` verde — **28/28 passed** (11 novos unitários + 17 integração)
- [x] `tsc --noEmit` limpo — 0 errors
- [x] `grep` audit: **0 matches** em `workers/links-redirect/src/`
- [x] Nenhum deploy executado

## Rollback

```bash
git revert <commit_hash>
# Sem wrangler deploy — Fase 2 não faz deploy
```

## Revisão G.12 — preenchido antes de DONE

### 2026-05-18 by Claude Sonnet 4.6 — revisão externa (agente separado, leitura fria)

**REVISÃO G.12**

**Código TypeScript**

- ✅ Strict mode respeitado — `tsc --noEmit` limpo (verificado em execução real).
- ✅ 0 referências hardcoded a DECOLE, PLANOVOO, ESG, ELIZETE, números de telefone em `src/` — `grep` retornou vazio (exit 1).
- ✅ Sem `any` não justificado em `src/index.ts`. Dois casts `bundledCatalogJson as LinksCatalog` são necessários porque JSON importado não carrega anotação de tipo automaticamente — padrão aceitável e documentado implicitamente pelo comentário `// Pure functions (exported for unit testing)`.
- ✅ Sem `!` non-null assertion em `src/` — nenhuma ocorrência encontrada.
- ✅ Erros tratados com fail-fast explícito (`tenant_not_configured`) e mensagem estruturada em JSON.
- ⚠️ Ressalva menor: `as never` em `contact-handler.test.ts` linha 41 (teste de catálogo sem `contacts`) é workaround de tipo em arquivo de teste, não em `src/`. Aceitável em contexto de teste de edge case estrutural, mas preferível usar `satisfies Partial<LinksCatalog>` ou overload de tipo no futuro.

**Arquitetura**

- ✅ Rotas lidas de `catalog.tenants[tenantId].links.routes` — sem switch hardcoded.
- ✅ Contatos lidos de `catalog.tenants[tenantId].links.contacts` — sem map estático.
- ✅ Tenant resolvido exclusivamente via `tryResolveTenantIdFromHostname(url.hostname, bundledCatalogJson)` — fail-fast 404 se hostname desconhecido. Nenhum fallback silencioso para DECOLE.
- ✅ Catálogo bundled substituiu completamente `LINKS_PRODUCTS` e env vars de tenant — `Env` contém apenas `FUNNEL_EVENTS` e `IDENTITY_KV`.
- ✅ O mesmo código serviria SUPERARE adicionando `tenants.superare.links` ao catálogo — zero mudança de código.
- ✅ Funções puras `resolveCheckoutByCatalog` e `resolveContact` exportadas e testáveis em isolamento.

**Testes**

- ✅ 28/28 testes verdes — verificado em execução real com `npx vitest run`.
- ✅ Sem `it.only`, `describe.skip` ou `test.only` esquecidos — grep confirmado vazio.
- ✅ TDD Red documentado na Execução do slice file (commit único `92bb29a` consolida testes + implementação, porém a narrativa de execução descreve a sequência Red→Green).
- ⚠️ Ressalva: TDD Red não é verificável via `git log` independente — testes unitários e implementação estão no mesmo commit `92bb29a`. O slice file documenta a sequência, mas o histórico não preserva o commit Red intermediário. Para slices futuros, recomenda-se commit de testes Red separado do commit Green.
- ✅ Isolamento cross-tenant testado em ambas as suítes unitárias (`superare-test` → null).
- ✅ Mocks isolados — cada `it()` constrói seus próprios arrays e envs; sem estado compartilhado.
- ✅ Nomes dos testes descrevem comportamento em português claro.
- ✅ `test/index.test.ts` cobre: healthcheck, WhatsApp, checkout legacy, PlanoVoo, BEGIN_CHECKOUT, checkout recovery, offer, CF-IP, método inválido, hostname desconhecido, contato sem config — cobertura de happy path + edge cases + fail-fast.

**Slice file**

- ✅ Seção `Execução` preenchida (append-only, 3 entradas).
- ✅ Decisões tomadas documentadas (delta vs plano).
- ✅ Gotchas registrados (`as const` + `ReadonlyArray`, chave de recovery, remoção de `LINKS_PRODUCTS`).
- ✅ Critério de aceite executável passou (28/28, tsc limpo, grep 0).

Código: ✅ OK
Arquitetura: ✅ OK
Testes: ✅ OK (com ressalva de processo: commit Red não preservado no histórico git)

**Resultado:** APROVADO COM RESSALVAS

Ressalvas a resolver no próximo slice ou backlog:
1. **TDD Red no histórico**: próximos slices devem commitar testes Red antes da implementação — o commit intermediário pode ser squashado no PR, mas deve existir localmente para evidência auditável.
2. **`as never` em teste de edge case**: substituir por casting mais expressivo (`catalogSemContatos as unknown as LinksCatalog` ou ajuste na assinatura para aceitar `Partial`) para eliminar o cast opaco.

---

## Execução (append-only)

### 2026-05-18 por Claude Sonnet 4.6

- O que foi tentado: recovery point confirmado (commit `dcd1d7c`, branch `main` limpa); leitura completa do worker e testes existentes; catálogo v5 confirmado com `links` e `contacts` já presentes.
- O que funcionou: contexto coletado; arquitetura do refactor definida.
- O que falhou: —
- Próximo passo planejado: adicionar `resolveJsonModule` no tsconfig; escrever testes Red; implementar funções.

### 2026-05-18 (continuação) por Claude Sonnet 4.6

- O que foi tentado: TDD Red — testes unitários criados antes da implementação. `resolveCheckoutByCatalog` e `resolveContact` inexistentes → 11 failing.
- O que funcionou: Red confirmado; testes em `test/unit/route-resolver.test.ts` (7 testes) e `test/unit/contact-handler.test.ts` (4 testes).
- O que falhou: —
- Próximo passo planejado: implementar o refactor no `src/index.ts`.

### 2026-05-18 (fechamento) por Claude Sonnet 4.6

- O que foi tentado: reescrita do `src/index.ts` — bundlar catálogo, exportar funções puras, resolver tenant do hostname, remover toda env var de tenant/produto.
- O que funcionou:
  - `tsconfig.json`: `resolveJsonModule: true` adicionado.
  - `src/index.ts`: importa `bundledCatalogJson`, exporta `resolveCheckoutByCatalog` e `resolveContact`; resolve tenant via `tryResolveTenantIdFromHostname` com fail-fast 404; remove `DEFAULT_TENANT_ID`, `ELIZETE_*`, `DECOLE_*`, `LINKS_PRODUCTS` da interface `Env`; `checkoutRecoveryKeys` recebe `tenantId` em vez de `env`.
  - `test/index.test.ts`: `makeEnv` simplificado (só `FUNNEL_EVENTS` e `IDENTITY_KV`); teste `LINKS_PRODUCTS` removido; 2 novos testes adicionados.
  - Typecheck limpo; 28/28 testes verdes; grep audit 0 matches.
- O que falhou: primeiro typecheck falhou por `as const` criando `readonly` incompatível com `routes?: Array<...>` mutável — corrigido usando `ReadonlyArray` na interface.
- Próximo passo planejado: commit + fechar STATUS e PLANO-MASTER.

## Gotchas / lições aprendidas

- `as const` em fixtures de teste cria tuplas e arrays `readonly` — a interface `LinksCatalog` deve usar `ReadonlyArray` e `readonly` nos campos para compatibilidade sem casting no teste.
- O teste de recuperação de checkout `"expande token de recuperacao escopado por tenant"` já usava `decole:checkout_recovery:rec-scoped` como key esperada — continua funcionando sem mudança porque `checkoutRecoveryKeys` agora usa `tenantId` resolvido do hostname (que é `decole`).
- O teste de `LINKS_PRODUCTS` foi removido: a funcionalidade de configurar produtos via env var JSON era um workaround para o catálogo não ter `links` — com v5 o catálogo é a fonte de verdade.

## Decisões tomadas (delta vs plano original)

- **Funções puras exportadas de `index.ts`** (não module separado): worker é simples o suficiente; evita over-engineering.
- **Fail-fast para tenant desconhecido**: hostname não mapeado → 404 `tenant_not_configured`. Nenhum fallback para DECOLE.
- **Remoção de `LINKS_PRODUCTS` env var**: catálogo bundled substitui completamente; teste existente de `LINKS_PRODUCTS` removido e substituído por teste via catálogo.
