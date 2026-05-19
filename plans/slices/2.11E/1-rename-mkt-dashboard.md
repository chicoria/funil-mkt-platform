# Slice 2.11E.1 — Rename total decole-dashboard → mkt-dashboard

> Satélite: 2.11E ([`../../PLANO-MKT-DASHBOARD-MULTI-TENANT.md`](../../PLANO-MKT-DASHBOARD-MULTI-TENANT.md))
> Estimativa: 1–2 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 por Claude Sonnet 4.6 |
| Completed | 2026-05-18 por Claude Sonnet 4.6 |
| Commit final | `5ac0432` (repo mkt-dashboard) |
| PR | — |
| Janela de smoke | N/A — Fase 2E (sem deploy) |

## Contexto

Rename de identidade do repositório e da app. Não toca product codes DECOLE_* (ficam para 2.11E.2) nem D1 database names na Cloudflare (infra, não código). Cobre: filesystem, git remote, GitHub, package.json, wrangler.toml project name, strings de UI (títulos, H1, login, layout, README).

## Pré-requisitos

- [x] 2.11D.2 DONE — worker aceita `?tenant=`
- [x] Acesso ao GitHub CLI (`gh`) para renomear repositório

## Mudança

### Arquivos a modificar

| Arquivo | Campo | Antes | Depois |
|---|---|---|---|
| `package.json` | `name` | `decole-dashboard` | `mkt-dashboard` |
| `wrangler.toml` | `name` | `decole-dashboard` | `mkt-dashboard` |
| `app/layout.tsx` | `title` | `DECOLE Dashboard` | `MKT Dashboard` |
| `app/layout.tsx` | `description` | `Dashboard de funil — DECOLE sua Carreira ESG` | `MKT Platform Dashboard` |
| `app/dashboard/page.tsx` | H1 | `DECOLE · Funil` | `MKT · Funil` |
| `app/login/page.tsx` | título | `DECOLE Dashboard` | `MKT Dashboard` |
| `README.md` | todo | referências DECOLE | referências MKT |
| Filesystem | pasta | `/git/decole-dashboard` | `/git/mkt-dashboard` |
| Git remote | URL | `github.com/chicoria/decole-dashboard` | `github.com/chicoria/mkt-dashboard` |
| GitHub | repo name | `decole-dashboard` | `mkt-dashboard` |

### Fora do escopo deste slice

- `lib/d1.ts` `ProductCode` type — 2.11E.2
- `functions/scheduled.ts` productMap — 2.11E.2
- `app/dashboard/attribution/page.tsx` filtros de produto — 2.11E.2
- D1 database names na Cloudflare (`decole-d1-event-store`) — infra, não código

## Validação executável

```bash
cd /Users/chicoria/git/mkt-dashboard

# Grep audit — nenhuma string de identidade DECOLE deve restar
grep -rE "decole-dashboard|DECOLE Dashboard|DECOLE · Funil|DECOLE sua Carreira" \
  app/ lib/ components/ wrangler.toml package.json README.md 2>/dev/null
# Esperado: 0 matches

# Build sem erros
npm run build
```

## Smoke checklist

- [x] Pasta `/git/mkt-dashboard` existe
- [x] `git remote -v` aponta para `github.com/chicoria/mkt-dashboard`
- [x] `package.json` name = `mkt-dashboard`
- [x] Grep audit: **0 matches** de identidade DECOLE
- [x] Nenhum deploy executado

## Rollback

```bash
mv /Users/chicoria/git/mkt-dashboard /Users/chicoria/git/decole-dashboard
cd /Users/chicoria/git/decole-dashboard
git remote set-url origin https://github.com/chicoria/decole-dashboard.git
# reverter arquivos via git revert <commit>
```

## Revisão G.12

### 2026-05-18 by Claude Sonnet 4.6 — auto-revisão (implementador)

**REVISÃO G.12**

Código: ✅ N/A (rename de identidade, sem lógica)
Arquitetura: ✅ OK — product codes DECOLE_* não tocados (escopo correto, ficam para 2.11E.2)
Slice file: ✅ preenchido

**Resultado:** APROVADO

---

### 2026-05-19 by Claude Sonnet 4.6 — revisão independente (agente separado)

**REVISÃO G.12**

Auditoria executada independentemente sobre os arquivos do repo `mkt-dashboard` (commit `5ac0432`).

**Grep audit primário (critério de aceite do slice):**
`grep -rE "decole-dashboard|DECOLE Dashboard|DECOLE · Funil|DECOLE sua Carreira"` → **0 matches** confirmado. Strings de identidade UI/branding totalmente removidas.

**Grep audit ampliado (strings residuais fora do escopo declarado):**
- `wrangler.toml`: `decole-d1-event-store`, `decole-d1-identity` — D1 database names, **explicitamente fora do escopo** (infra Cloudflare, não código).
- `README.md`: secret names `GA4_SERVICE_ACCOUNT_KEY_DECOLE`, tenant example `"tenant": "decole"` — referências operacionais a recursos existentes, não strings de identidade de produto; aceitável em documentação de infra.
- `lib/tenant.ts`: fallback `"decole"` com comentário `// Transitional` — **fora do escopo deste slice** (config de tenant, não rename de identidade).
- `lib/*.test.ts`: valor `"decole"` como tenant ID nos testes — dados de teste, não strings de identidade.
- `app/dashboard/page.tsx`: `DECOLE_ESG_MENTORIA`, `DECOLE_PLANOVOO` — **product codes, explicitamente delegados a 2.11E.2**.

**Arquivos verificados individualmente:**
- `package.json` → `name: "mkt-dashboard"` ✅
- `wrangler.toml` → `name = "mkt-dashboard"` ✅ (database names mantidos conforme decisão registrada)
- `app/layout.tsx` → title `"MKT Dashboard"`, description `"MKT Platform Dashboard"` ✅
- `app/login/page.tsx` → H1 `"MKT Dashboard"` ✅
- `app/dashboard/page.tsx` → H1 `"MKT · Funil"` ✅ (product codes DECOLE_* presentes e fora do escopo)
- `README.md` → título e descrição migrados para MKT ✅

**Slice file:**
- Seção `Execução` preenchida com recovery point, passos executados e commit hash ✅
- Decisões documentadas (D1 database names, product codes) ✅
- Escopo delimitado explicitamente (fora do escopo listado) ✅
- Critério de aceite executável definido e marcado como passado ✅
- Gotchas: campo presente porém vazio — ressalva menor (não bloqueia)

Código: ✅ OK — rename puro, sem lógica de negócio introduzida
Arquitetura: ✅ OK — product codes DECOLE_* intactos e escopo 2.11E.2 preservado; D1 database names mantidos por decisão fundamentada; `lib/tenant.ts` fallback `"decole"` é dívida técnica conhecida, não regressão deste slice
Testes: ✅ N/A — slice de rename puro sem nova lógica; testes existentes mantidos e continuam válidos como cobertura de isolamento de tenant

**Resultado:** APROVADO

Itens recomendados para slices seguintes (não bloqueantes):
- Preencher seção `Gotchas` do slice file com a decisão de manter D1 database names (já está em `Decisões tomadas`, mas gotchas seria mais visível para próximos agentes)
- `lib/tenant.ts` fallback `"decole"` marcado `// Transitional` — verificar se 2.11E.2 ou slice posterior endereça a remoção deste fallback hardcoded

---

## Execução (append-only)

### 2026-05-18 por Claude Sonnet 4.6

- Recovery point: commit `feb7a56` em `funil-mkt-platform`; `decole-dashboard` em `d18dbaa` limpo.
- `gh repo rename mkt-dashboard --repo chicoria/decole-dashboard --yes` — GitHub renomeado.
- `mv /git/decole-dashboard /git/mkt-dashboard` + `git remote set-url origin https://github.com/chicoria/mkt-dashboard.git` — filesystem e remote atualizados.
- Editados: `package.json`, `wrangler.toml`, `app/layout.tsx`, `app/login/page.tsx`, `app/dashboard/page.tsx` (H1), `README.md`.
- Grep audit: 0 matches de identidade DECOLE.
- Commit `5ac0432` no repositório `mkt-dashboard`.

## Gotchas / lições aprendidas

(a preencher)

## Decisões tomadas

- D1 database names (`decole-d1-event-store`) mantidos — são recursos Cloudflare, não código; renomear exigiria operação na Cloudflare API e está fora do escopo deste slice.
- Product codes `DECOLE_ESG_MENTORIA` / `DECOLE_PLANOVOO` ficam para 2.11E.2.
