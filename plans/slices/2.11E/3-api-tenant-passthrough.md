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

(a preencher — agente separado)

---

## Execução (append-only)

### 2026-05-19 por Claude Sonnet 4.6

- Recovery point: `43c0bcb` (funil-mkt-platform); `dc8aeab` (mkt-dashboard).
- Design: helpers puros `buildSyncStatusUrl` / `buildSyncRunBody` em `lib/sync-client.ts` — SoC, testáveis sem mocks HTTP.
- Red `edbf9b5`: 7 testes falhando (módulo inexistente). Green `874baea`: 16/16 passed.

## Gotchas / lições aprendidas

- `app/api/auth/route.ts` usa `process.env.ADMIN_SECRET` (errado para edge runtime — deveria usar `getRequestContext().env`). Não corrigido neste slice — escopo separado.
