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

### 2026-05-18 by Claude Sonnet 4.6 — auto-revisão

**REVISÃO G.12**

Código: ✅ N/A (rename de identidade, sem lógica)
Arquitetura: ✅ OK — product codes DECOLE_* não tocados (escopo correto, ficam para 2.11E.2)
Slice file: ✅ preenchido

**Resultado:** APROVADO

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
