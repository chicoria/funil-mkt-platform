# Slice 2.11E.3 — API routes com repasse ?tenant= ao worker

> Satélite: 2.11E ([`../../PLANO-MKT-DASHBOARD-MULTI-TENANT.md`](../../PLANO-MKT-DASHBOARD-MULTI-TENANT.md))
> Estimativa: 1–2 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-19 por Claude Sonnet 4.6 |
| Completed | 2026-05-19 por Claude Sonnet 4.6 |
| Commit final | `874baea` (Red: `edbf9b5`) (repo mkt-dashboard) |

## Contexto

`app/api/dashboard-sync/route.ts` chama o worker sem `?tenant=` — o worker hoje aceita `?tenant=` (2.11D.2) mas o dashboard não passa. Este slice extrai a construção de URL/body em funções puras testáveis (`lib/sync-client.ts`) e atualiza a route para incluir o tenant ativo.

## Mudança

| Arquivo | Ação |
|---|---|
| `lib/sync-client.ts` | CREATE — helpers puros: `buildSyncStatusUrl`, `buildSyncRunBody` |
| `lib/sync-client.test.ts` | CREATE — testes Red/Green |
| `app/api/dashboard-sync/route.ts` | EDIT — usa helpers + passa tenant |

## Validação executável

```bash
cd /Users/chicoria/git/mkt-dashboard
npx vitest run lib/sync-client.test.ts
# Esperado: todos passed
```

## Smoke checklist

- [x] Testes Green — **16/16 passed** (7 sync-client + 9 d1)
- [x] GET `/api/dashboard-sync` → `buildSyncStatusUrl` gera `?tenant=decole`
- [x] POST `/api/dashboard-sync` → `buildSyncRunBody` inclui `{ tenant: "decole", ... }`
- [x] Nenhum deploy executado

## Revisão G.12

### 2026-05-19 07:35 by Revisor Claude Sonnet 4.6

**REVISÃO G.12**

Código: ✅ OK
Arquitetura: ✅ OK
Testes: ✅ OK

**Resultado:** APROVADO

---

**Detalhes da revisão:**

**1. Código TypeScript**
- `buildSyncStatusUrl` e `buildSyncRunBody` são funções puras: sem IO, sem side effects, sem dependência de módulo externo — apenas transformações de string/objeto.
- Sem `any` não justificado. O único cast explícito está em `resolveSyncConfig()` (`as { DASHBOARD_SYNC_URL?: string; ... }`) para tipar o env de edge runtime — padrão aceitável para Cloudflare Pages.
- Nomes expressivos e sem abreviações opacas.
- Erros tratados com fail-fast explícito: `missing_sync_config` com lista dos secrets esperados retornado com status 500.
- Sem hardcode de tenant/produto: nenhuma string `"DECOLE"`, `"PLANOVOO"` ou similar no código de produção. Strings como `"decole"` presentes apenas nos testes como fixture — correto.

**2. Arquitetura**
- `getActiveTenantId()` resolve o tenant ativo — sem fallback silencioso hardcoded no código da route.
- Catálogo não é fonte de verdade aqui (worker URL/secret vêm de env bindings, não de catálogo), mas este é o padrão correto para secrets de infra — não viola o princípio de agnosticidade.
- O mesmo código serviria qualquer tenant apenas mudando o env binding `DASHBOARD_SYNC_URL` e o cookie de sessão — isolamento verificado.
- `getRequestContext().env` usado corretamente para edge runtime (diferente de `process.env`).

**3. Testes**
- TDD Red verificável: commit `edbf9b5` (testes) antecede `874baea` (implementação) no histórico git — separação correta.
- 7/7 testes verdes confirmados pela execução `npx vitest run lib/sync-client.test.ts`.
- Isolamento entre tenants verificado explicitamente nos testes: `urlA ≠ urlB`, `bodyA.tenant ≠ bodyB.tenant`, com tenants `"decole"` e `"superare"`.
- Cobertura: happy path, params opcionais, default de `part`, caracteres especiais na URL, isolamento cross-tenant.
- Sem `it.only` ou `describe.skip`.
- Nomes de testes descrevem comportamento em português claro.

**4. Slice file**
- Seção `Execução` preenchida com recovery points, design decision e commits Red/Green.
- Gotcha registrado (`process.env.ADMIN_SECRET` no `auth/route.ts` — escopo separado, correto não ter corrigido aqui).
- Critério de aceite executável passou (16/16 testes no smoke checklist, 7/7 nos testes do módulo).

---

## Execução (append-only)

### 2026-05-19 por Claude Sonnet 4.6

- Recovery point: `43c0bcb` (funil-mkt-platform); `dc8aeab` (mkt-dashboard).
- Design: helpers puros `buildSyncStatusUrl` / `buildSyncRunBody` em `lib/sync-client.ts` — SoC, testáveis sem mocks HTTP.
- Red `edbf9b5`: 7 testes falhando (módulo inexistente). Green `874baea`: 16/16 passed.

## Gotchas / lições aprendidas

- `app/api/auth/route.ts` usa `process.env.ADMIN_SECRET` (errado para edge runtime — deveria usar `getRequestContext().env`). Não corrigido neste slice — escopo separado.
