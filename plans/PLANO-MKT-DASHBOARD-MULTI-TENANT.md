# Plano Satélite 5 — mkt-dashboard Multi-Tenant

> **Satélite** de [`PLANO-MASTER-MULTI-TENANT.md`](./PLANO-MASTER-MULTI-TENANT.md) (Slice 2.11E)
> **Repositório afetado:** `/Users/chicoria/git/decole-dashboard` → `/Users/chicoria/git/mkt-dashboard`
> **Pré-requisito:** Fase 2 completa (2.11D.2 DONE) — worker `dashboard-sync` já aceita `?tenant=` e D1 já tem `tenant_id`

---

## 1. Objetivo

Transformar `decole-dashboard` em `mkt-dashboard` — uma app de dashboard agnóstica de tenant que:

- Carrega dados filtrando por `tenant_id` em todas as queries D1
- Repassa `?tenant=` ao worker `dashboard-sync`
- Isola sessão de admin por tenant (cada tenant tem sua senha própria no Secrets Store)
- Pode ser usada por DECOLE e SUPERARE sem code change — só config

---

## 2. Frentes de trabalho

### Frente A — Rename total + queries tenant_id

Objetivo: app genérica, sem nenhum "DECOLE" hardcoded. Habilita onboarding de SUPERARE sem alterar código.

### Frente B — Auth por tenant (senha única por tenant no Secrets Store)

Objetivo: isolamento de acesso — admin de DECOLE não vê dados de SUPERARE. Segue o mesmo padrão `{SECRET}_{TENANT}` já estabelecido.

---

## 3. Inventário de acoplamento atual

### 3.1 Identidade / nome

| Local | Valor atual | Valor alvo |
|---|---|---|
| `package.json` `.name` | `decole-dashboard` | `mkt-dashboard` |
| `package.json` `.description` | — | `MKT Platform Dashboard` |
| `wrangler.toml` project name | `decole-dashboard` (inferido) | `mkt-dashboard` |
| `app/layout.tsx` metadata title | `DECOLE Dashboard` | dinâmico ou `MKT Dashboard` |
| `app/dashboard/page.tsx` H1 | `"DECOLE · Funil"` | `"{tenant.displayName} · Funil"` |
| Pasta no filesystem | `/git/decole-dashboard` | `/git/mkt-dashboard` |
| Git remote (se existir) | `decole-dashboard` (repo GitHub) | `mkt-dashboard` |

### 3.2 D1 bindings e queries

| Local | Acoplamento | Mudança |
|---|---|---|
| `wrangler.toml` D1 binding `EVENT_STORE_DB` | `decole-d1-event-store` | `mkt-event-store` (ou manter + renomear em CF) |
| `wrangler.toml` D1 binding `IDENTITY_DB` | `decole-d1-identity` | `mkt-identity` |
| `lib/d1.ts` todas as queries | Sem `WHERE tenant_id = ?` | Adicionar `AND tenant_id = ?` em todas |

### 3.3 Auth

| Local | Comportamento atual | Comportamento alvo |
|---|---|---|
| `app/api/auth/route.ts` | Valida contra `ADMIN_SECRET` global | Valida contra `ADMIN_SECRET_{TENANT_ID}` do Secrets Store |
| `lib/auth.ts` | Cookie `admin_session` = valor de `ADMIN_SECRET` | Cookie `admin_session` = `{tenant_id}:{hash}` |
| Login UI | Campos: senha | Campos: tenant (select) + senha |

### 3.4 Sync API

| Local | Comportamento atual | Comportamento alvo |
|---|---|---|
| `app/api/dashboard-sync/route.ts` GET | `GET /sync/status` sem tenant | `GET /sync/status?tenant={tenant}` |
| `app/api/dashboard-sync/route.ts` POST | `POST /sync/run` com `{date, part}` | `POST /sync/run` com `{date, part, tenant}` |

---

## 4. Frente A — Rename total + queries tenant_id

### 4.1 Rename do repositório (Slice 2.11E.1)

```bash
# 1. Renomear pasta local
mv /Users/chicoria/git/decole-dashboard /Users/chicoria/git/mkt-dashboard
cd /Users/chicoria/git/mkt-dashboard

# 2. Atualizar remote (se repositório GitHub existe)
gh repo rename mkt-dashboard   # ou via GitHub Settings
git remote set-url origin git@github.com:{owner}/mkt-dashboard.git

# 3. package.json
#    name: "mkt-dashboard"

# 4. wrangler.toml
#    name = "mkt-dashboard"
#    D1 bindings: EVENT_STORE_DB → mesmo DB D1 (só muda o binding name se necessário)

# 5. Strings "DECOLE" em código (títulos, H1, descriptions)
#    Substituir por valores dinâmicos do catálogo ou por strings neutras "MKT Dashboard"
```

**Critério de aceite:**
```bash
grep -rE "decole-dashboard|DECOLE Dashboard|DECOLE · Funil" src/ app/ lib/ wrangler.toml package.json
# Esperado: 0 matches
```

### 4.2 Queries D1 com `tenant_id` (Slice 2.11E.2)

Todas as funções em `lib/d1.ts` recebem `tenantId: string` e adicionam `AND tenant_id = ?` nas queries.

```typescript
// Antes
export async function getFunnelCounts(db, productCode) {
  return db.prepare(`SELECT ... FROM funnel_events WHERE product_code = ?`).bind(productCode).all();
}

// Depois
export async function getFunnelCounts(db, tenantId, productCode) {
  return db.prepare(
    `SELECT ... FROM funnel_events WHERE tenant_id = ? AND product_code = ?`
  ).bind(tenantId, productCode).all();
}
```

Todas as pages/components que chamam `lib/d1.ts` recebem `tenantId` de onde? — da sessão autenticada (Frente B) ou de env var por enquanto (Frente A usa `TENANT_ID` env var = `"decole"` como transitório).

### 4.3 Seletor de tenant + repasse ao worker (Slice 2.11E.3)

- `app/api/dashboard-sync/route.ts`: repassa `tenant` para o worker
- Frente A: tenant fixo da sessão (ou env var `TENANT_ID`)
- Frente B: tenant resolvido da sessão autenticada

### 4.4 Deploy + smoke (Slice 2.11E.4)

- `wrangler pages deploy` com novo nome
- Smoke: todas as URLs do dashboard funcionando com `tenant_id=decole`
- Zero regressão nos gráficos DECOLE

---

## 5. Frente B — Auth por tenant

### 5.1 Modelo de autenticação

**Princípio:** mesmo naming convention do plano master — `ADMIN_SECRET_{TENANT_ID}` no Cloudflare Secrets Store.

```
Secrets Store (account-level):
  ADMIN_SECRET_DECOLE    = "senha-admin-decole"
  ADMIN_SECRET_SUPERARE  = "senha-admin-superare"
```

**Fluxo de login:**

1. Usuário acessa `/login`
2. Seleciona tenant (dropdown com tenants do catálogo — ou input manual em alpha)
3. Digita senha
4. App valida: `env["ADMIN_SECRET_" + tenantId.toUpperCase()]` === senha digitada
5. Se válido: seta cookie `admin_session` = `{tenantId}:{hash_da_senha}`
6. Middleware `/dashboard/*` valida cookie + extrai `tenantId` para filtrar queries

**Onboarding de novo tenant:** criar `ADMIN_SECRET_{TENANT}` no Secrets Store (via wrangler ou CF API). Zero code change na app.

### 5.2 Mudanças no código (Slice 2.11E.5)

| Arquivo | Mudança |
|---|---|
| `app/api/auth/route.ts` | Lê `tenantId` do body; valida contra `ADMIN_SECRET_{tenantId.toUpperCase()}` |
| `lib/auth.ts` | Cookie encoda `{tenantId}:{hash}`; extrai `tenantId` para queries |
| `app/login/page.tsx` | Adiciona campo de seleção de tenant |
| `middleware.ts` (ou equivalente) | Extrai `tenantId` do cookie e injeta no contexto da request |
| `wrangler.toml` | Adicionar bindings `ADMIN_SECRET_DECOLE` e `ADMIN_SECRET_SUPERARE` do Secrets Store |

### 5.3 Segurança e rollback

- Sessão inválida (tenant removido) → redirect `/login`
- Smoke: admin DECOLE não vê dados de SUPERARE e vice-versa
- Rollback: revert cookie model + restaurar `ADMIN_SECRET` global

---

## 6. Slices

| ID | Frente | Descrição | Fase |
|---|---|---|---|
| **2.11E.1** | A | Rename total: pasta, git remote, package.json, wrangler.toml, strings | **Fase 2** (refactor, sem deploy) |
| **2.11E.2** | A | `lib/d1.ts`: adicionar `tenant_id` em todas as queries + testes | **Fase 2** (refactor, sem deploy) |
| **2.11E.3** | A | API routes: repasse `?tenant=` ao worker; `TENANT_ID` env var transitória | **Fase 2** (refactor, sem deploy) |
| **2.11E.4** | A | Deploy `mkt-dashboard` + smoke DECOLE | Fase 3 (deploy disruptivo) |
| **2.11E.5** | B | Auth: `ADMIN_SECRET_{TENANT}` + login com seleção de tenant | **Fase 2** (refactor, sem deploy) |
| **2.11E.6** | B | Smoke auth cross-tenant + remover `ADMIN_SECRET` global | Fase 4 (limpeza) |

---

## 7. Integração com o plano master

### 7.1 Dependências

```
2.11D.2 DONE (worker aceita ?tenant=) ──► 2.11E.1 (rename)
                                     ──► 2.11E.2 (queries tenant_id)
                                     ──► 2.11E.3 (repasse ?tenant=)
                                                  ──► 2.11E.4 (deploy)
                                                               ──► 2.11E.5 (auth B)
                                                                            ──► 2.11E.6 (smoke B)
```

### 7.2 Onboarding de novo tenant (atualização do runbook 2.11B.5)

Adicionar ao `RUNBOOK-ONBOARDING-TENANT.md`:

7. Criar `ADMIN_SECRET_{TENANT}` no Secrets Store (Cloudflare)
8. Adicionar binding `ADMIN_SECRET_{TENANT}` no `wrangler.toml` do mkt-dashboard
9. Deploy `wrangler pages deploy` para ativar novo binding
10. Smoke: login com credencial do tenant → dados filtrados corretamente

---

## 8. Riscos

| # | Risco | Mitigação |
|---|---|---|
| 1 | **D1 binding rename** pode requerer migração de dados se nome do D1 mudar no CF | Manter o mesmo D1 database ID; só o binding name muda no wrangler.toml |
| 2 | **Rename de pasta** quebra paths em scripts locais | Atualizar referências em shell scripts, aliases, etc. |
| 3 | **Cookie auth** com `{tenantId}:{hash}` pode vazar o tenant ID | Usar hash do conjunto, não expor tenant em clear text no cookie value |
| 4 | **Secrets Store bindings** no Cloudflare Pages requerem redeploy | Planejar janela de deploy após criar cada novo binding |

---

## 9. Definition of Done

**Frente A:**
- `grep -rE "decole-dashboard|DECOLE Dashboard|DECOLE · Funil"` → 0 matches
- Queries D1 filtram por `tenant_id`
- Worker recebe `?tenant=` corretamente
- Dashboard DECOLE funcionando sem regressão

**Frente B:**
- Admin DECOLE não consegue ver dados de SUPERARE (teste cross-tenant)
- Onboarding de novo tenant = criar secret + binding + redeploy (sem code change)
- `ADMIN_SECRET` global removido
