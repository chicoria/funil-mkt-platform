# Slice 2.11E.5 — Auth por tenant (ADMIN_SECRET_{TENANT})

> Satélite: 2.11E ([`../../PLANO-MKT-DASHBOARD-MULTI-TENANT.md`](../../PLANO-MKT-DASHBOARD-MULTI-TENANT.md))
> Estimativa: 3–4 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-19 por Claude Sonnet 4.6 |
| Completed | 2026-05-19 por Claude Sonnet 4.6 |
| Commit final | `781301c` (Red: `09329b3`) + fix `7517e42` (repo mkt-dashboard) |

## Contexto

`lib/auth.ts` e `app/api/auth/route.ts` usam `process.env.ADMIN_SECRET` (errado para edge runtime Cloudflare — deveria ser `getRequestContext().env`). Auth é single-tenant global sem seleção de tenant. Este slice introduz `ADMIN_SECRET_{TENANT}` por tenant, cookie de sessão com `{tenantId}:{secret}`, login com campo de tenant, e faz `getActiveTenantId()` ler da sessão autenticada.

## Pré-requisitos

- [x] 2.11E.2 DONE — `lib/tenant.ts` com `getActiveTenantId()` (transitória)
- [x] 2.11E.3 DONE — API routes com tenant passthrough

## Mudança

| Arquivo | Ação |
|---|---|
| `lib/auth.ts` | Reescrever — helpers puros + IO com `getRequestContext().env`; `ADMIN_SECRET_{TENANT}` |
| `lib/auth.test.ts` | CREATE — testes Red/Green dos helpers puros |
| `lib/tenant.ts` | Tornar `getActiveTenantId()` async; lê `getSessionTenantId()` |
| `app/api/auth/route.ts` | Usar `getRequestContext().env`; validar por tenant; cookie `{tenantId}:{secret}` |
| `app/login/page.tsx` | Adicionar campo de tenant (input text) |
| `app/api/dashboard-sync/route.ts` | Usar `isAuthenticated()` de `lib/auth` (remover `requireAuth` local) |
| `app/dashboard/page.tsx` | `await getActiveTenantId()` |
| `app/dashboard/attribution/page.tsx` | Idem |
| `app/dashboard/user/[profile_id]/page.tsx` | Idem |
| `wrangler.toml` | Adicionar comentário de binding `ADMIN_SECRET_DECOLE` (secret via CF Pages env) |

## Design (SoC)

```typescript
// lib/auth.ts — helpers puros (testáveis sem mocks)
export function resolveSecretKey(tenantId: string): string
export function encodeSession(tenantId: string, secret: string): string
export function decodeSession(value: string): { tenantId: string; secret: string } | null

// lib/auth.ts — IO (dependem de Cloudflare runtime)
export async function isAuthenticated(): Promise<boolean>
export async function getSessionTenantId(): Promise<string | null>

// lib/tenant.ts — async após 2.11E.5
export async function getActiveTenantId(): Promise<string>
```

## Validação executável

```bash
cd /Users/chicoria/git/mkt-dashboard
npx vitest run
# Esperado: todos passed

npx tsc --noEmit 2>&1 | grep -v node_modules
# Esperado: 0 errors
```

## Smoke checklist

- [x] Testes Green — **24/24 passed** (8 auth-helpers + 9 d1 + 7 sync-client)
- [x] `tsc --noEmit` limpo
- [ ] Login com tenant + senha válida → redireciona (validado em 2.11E.4 deploy)
- [ ] Login com tenant errado → erro (validado em 2.11E.4 deploy)
- [ ] Admin DECOLE não vê dados de tenant diferente (validado em 2.11E.4 deploy)
- [x] Nenhum deploy executado

## Revisão G.12

> ⛔ **GUARD RAIL:** agente implementador NÃO pode auto-aprovar este bloco.
> Revisão obrigatória = lançar agente separado antes de marcar DONE.

### 2026-05-19 08:20 by Revisor Externo <claude-sonnet-4-6>

**REVISÃO G.12**

Código: ✅ OK
Arquitetura: ⚠️ Ressalvas (2 itens menores — ver abaixo)
Testes: ✅ OK

**Resultado:** APROVADO COM RESSALVAS

---

#### Verificações executadas

**Segurança — Cookie `admin_session`**
- `httpOnly: true` ✅ — `app/api/auth/route.ts` linha 26
- `secure: true` ✅ — linha 27
- `sameSite: "lax"` ✅ — linha 28
- `maxAge: 60*60*24*7` ✅ — cookie de 7 dias, razoável para admin
- Secret não logado nem exposto em nenhum `console.*` ✅
- Timing attack: comparação com `!==` simples; não crítico em edge para admin-only single-user, conforme nota do slice ✅

**Fix de `process.env`**
- `app/api/auth/route.ts` usa exclusivamente `getRequestContext().env` ✅ — `process.env` removido
- `lib/auth.ts` usa `getRequestContext().env` via `readAdminSecret()` ✅
- `lib/env.ts` mantém `ADMIN_SECRET: string` na interface `Env` (transitório, documentado como "substituído pela sessão em 2.11E.5") — não é um erro de runtime, só acoplamento residual de tipo

**SoC — Separação helpers puros / IO**
- `lib/auth-helpers.ts`: zero imports; apenas funções puras ✅
- `lib/auth.ts`: importa `cookies` e `getRequestContext` — IO corretamente isolado no arquivo de IO ✅
- `auth.test.ts` importa apenas de `auth-helpers` — sem necessidade de mocks de runtime ✅

**Isolamento de tenant**
- Cookie encoda `{tenantId}:{secret}` ✅
- `getSessionTenantId()` decodifica tenantId e valida contra `ADMIN_SECRET_{TENANT_UPPERCASE}` do env — admin de tenant A não pode acessar tenant B ✅
- `decodeSession("")` e `decodeSession("semcolon")` retornam `null` ✅
- Secrets de tenants distintos mapeiam chaves distintas no env ✅

**TDD Red/Green verificável**
- Commit Red: `09329b3` — `lib/auth.test.ts` adicionado, 51 linhas, 8 testes; implementação ainda inexistente ✅
- Commit Green: `781301c` — implementação + 24/24 testes passando ✅
- `npx vitest run` executado: **3 test files, 24 tests passed** ✅
- `npx tsc --noEmit`: **0 errors** ✅

**`getActiveTenantId()` async — 4 callers com `await`**
- `app/dashboard/page.tsx:40` ✅
- `app/dashboard/attribution/page.tsx:19` ✅
- `app/dashboard/user/[profile_id]/page.tsx:17` ✅
- `app/api/dashboard-sync/route.ts:37 e :70` ✅

**Sem `any` não justificado**
- `env as Record<string, unknown>` — cast necessário e documentado implicitamente pela ausência de tipo rico no binding Cloudflare ✅
- Nenhum `any` solto ✅

**Sem `it.only` / `describe.skip`**
- Verificado em todos os `*.test.ts` — limpo ✅

**Nomes de testes**
- Todos descrevem comportamento em português claro ✅

---

#### Ressalvas (a resolver no próximo slice ou issue)

1. **`lib/env.ts` interface `Env` ainda declara `ADMIN_SECRET: string` (singular, sem tenant)**
   - Campo não é mais usado em produção após 2.11E.5, mas ainda presente na interface. Pode gerar confusão para próximo agente. Remover em próximo slice ou no fechamento de 2.11E.
   - Severidade: baixa — não causa bug, é só ruído de tipo.

2. **`app/api/dashboard-sync/route.ts` fallback `env.ADMIN_SECRET` no `resolveSyncConfig()`**
   - `resolveSyncConfig()` ainda aceita `ADMIN_SECRET` como fallback para o secret de sync (linha 18). Este `ADMIN_SECRET` é o secret do worker de sync, não o secret do admin de login — são conceitos distintos. O nome ambíguo pode enganar. Considerar renomear binding para `SYNC_SECRET` (sem fallback para `ADMIN_SECRET`) e documentar no `wrangler.toml`.
   - Severidade: baixa — não viola isolamento de tenant, apenas nomenclatura confusa.

**O humano decide se aceita as ressalvas.** O próximo slice (2.11E.4 deploy) pode avançar.

---

## Execução (append-only)

### 2026-05-19 por Claude Sonnet 4.6

- Recovery point: `d4cd9ee` (funil-mkt-platform); `2adc1bc` (mkt-dashboard).
- Problemas: `process.env.ADMIN_SECRET` em 2 lugares (errado para edge); `requireAuth()` duplicado; auth single-tenant global.
- Design: helpers puros em `lib/auth-helpers.ts` (testáveis sem runtime); IO em `lib/auth.ts`; `getActiveTenantId()` async lê sessão primeiro.
- Red `09329b3`: 8 testes falhando. Green `781301c`: 24/24 passed.
- Fix `7517e42`: `ADMIN_SECRET` obsoleto removido de `lib/env.ts` (ressalva G.12).

## Gotchas / lições aprendidas

(a preencher)

## Decisões tomadas

- Cookie `admin_session` = `{tenantId}:{adminSecret}` — simples, sem JWT, sem signing separado. Adequado para admin-only single-user por tenant.
- `getActiveTenantId()` async — cascade em 4 callers, mas necessário para leitura correta da sessão.
- Sessões antigas invalidadas automaticamente (cookie sem tenantId não passa no `decodeSession`).
