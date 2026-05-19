# Slice 2.11E.4 — Deploy mkt-dashboard no Cloudflare Pages

> Satélite: 2.11E
> Estimativa: 2 horas

## Status

| Campo | Valor |
|---|---|
| Estado | IN_PROGRESS |
| Started | 2026-05-19 por Claude Sonnet 4.6 |
| Completed | — |
| Commit final | — |
| PR | — |
| Janela de smoke | 2026-05-19 → 2026-05-20 |

## Contexto

Após Fase 2E completa (slices 2.11E.1–2.11E.5 DONE, commit `7517e42`), o `mkt-dashboard` precisa ser buildado e deployado no Cloudflare Pages com nome `mkt-dashboard`. Este é o primeiro deploy disruptivo da Fase 3 para este repositório. App usa `next-on-pages` + `wrangler pages deploy`.

Satélite: [`PLANO-MKT-DASHBOARD-MULTI-TENANT.md`](../../PLANO-MKT-DASHBOARD-MULTI-TENANT.md)

## Pré-requisitos

- [x] Slice 2.11E.5 DONE (auth por tenant — commit `7517e42`)
- [x] `wrangler.toml` com `name = "mkt-dashboard"` e `pages_build_output_dir = ".vercel/output/static"`
- [x] Projeto Pages `mkt-dashboard` no Cloudflare (renomeado em 2.11E.1)
- [ ] `ADMIN_SECRET_DECOLE` setado como Pages environment variable no CF

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `.vercel/output/static` | BUILD OUTPUT | Gerado pelo `npx @cloudflare/next-on-pages` |
| Cloudflare Pages | DEPLOY | `wrangler pages deploy` via CLI |

### Diff conceitual

Sem alterações de código neste slice. É um slice de deploy + smoke.

## Testes

### Unit

N/A — smoke manual/semi-automático pós-deploy.

### Smoke checklist

- [ ] `GET /` → redirect para `/login` ou 200
- [ ] `GET /dashboard` sem cookie → redirect para `/login`
- [ ] `GET /api/dashboard-sync` sem cookie → 401
- [ ] Login com tenant inválido → redirect `/login?error=1`
- [ ] Login com credenciais DECOLE corretas → 200 + cookie + redirect `/dashboard`

## Validação executável

```bash
# 1. Build
cd /Users/chicoria/git/mkt-dashboard
npm run pages:build
# Esperado: sem erros, .vercel/output/static/ criado

# 2. Deploy
wrangler pages deploy
# Esperado: URL de deploy retornada (ex: https://mkt-dashboard.pages.dev)

# 3. Smoke básico (substituir URL pela saída do deploy)
PAGES_URL="https://mkt-dashboard.pages.dev"
curl -sI "$PAGES_URL/" | head -5
curl -sI "$PAGES_URL/dashboard" | head -5
curl -s -o /dev/null -w "%{http_code}" "$PAGES_URL/api/dashboard-sync"
```

## Rollback

```bash
# Opção 1: Cloudflare Dashboard → Pages → mkt-dashboard → Deployments → rollback
# Opção 2:
wrangler pages deployment rollback --project-name=mkt-dashboard
```

Validação pós-rollback: versão anterior visível no Cloudflare Pages dashboard, smoke no deploy anterior retorna 200.

## Revisão G.12 (Code + Architecture + Tests)

> Este slice é deploy-only — o código foi revisado nos slices 2.11E.1–2.11E.5.
> Revisão aqui foca em: deploy OK + smoke OK + sem regressão DECOLE.

### 2026-05-19 por Claude Sonnet 4.6

**Deploy**
- [ ] Build `next-on-pages` sem erros
- [ ] Deploy via `wrangler pages deploy` retorna URL
- [ ] URL acessível (200 ou redirect esperado)

**Smoke**
- [ ] `GET /` → redirect ou 200
- [ ] `GET /dashboard` sem auth → redirect `/login`
- [ ] `GET /api/dashboard-sync` sem auth → 401
- [ ] Login inválido → `/login?error=1`

**Resultado:** PENDENTE

---

## Execução (append-only — preenchido AO LONGO da execução)

### 2026-05-19 por Claude Sonnet 4.6

- Recovery point: commit `7517e42` em `/Users/chicoria/git/mkt-dashboard`
- Pré-requisitos verificados: `wrangler.toml` correto, `name = "mkt-dashboard"`, `pages_build_output_dir = ".vercel/output/static"`
- **Build OK**: `npm run pages:build` concluiu sem erros. Output em `.vercel/output/static/`. Rotas: 7 Edge Functions + 4 Prerendered + 36 Static Assets. Build em 4.97s.
- **BLOQUEIO — wrangler auth expirado**: token OAuth em `~/Library/Preferences/.wrangler/config/default.toml` expirou em 2026-05-15. Refresh token também retorna 400 Bad Request. Sem `CLOUDFLARE_API_TOKEN` no ambiente.
- **Ação necessária do humano**: re-autenticar wrangler (`npx wrangler login`) ou fornecer `CLOUDFLARE_API_TOKEN`. Ver seção Bloqueio abaixo.
- Próximo passo (após auth): `npx wrangler pages deploy` e smoke

## BLOQUEIO: wrangler auth expirado

**Estado:** Token OAuth do wrangler expirou em 2026-05-15. Refresh retorna 400 Bad Request.

**Ação necessária (humano):**

Opção A — Re-login via browser (recomendado):
```bash
cd /Users/chicoria/git/mkt-dashboard
npx wrangler login
# Abre browser → autorizar → token novo salvo em ~/Library/Preferences/.wrangler/config/default.toml
```

Opção B — API Token (para CI/CD):
```bash
# Criar token em: https://dash.cloudflare.com/profile/api-tokens
# Permissões mínimas: Cloudflare Pages:Edit, User:Read
export CLOUDFLARE_API_TOKEN="seu-token-aqui"
cd /Users/chicoria/git/mkt-dashboard
npx wrangler pages deploy
```

**Após auth, continuar com:**
```bash
cd /Users/chicoria/git/mkt-dashboard
npx wrangler pages deploy
# Smoke: ver seção Smoke checklist
```

## Gotchas / lições aprendidas

- `wrangler.toml` com `pages_build_output_dir = ".vercel/output/static"` — não confundir com `.vercel/output/static` que é gerado pelo next-on-pages
- Projeto Pages no Cloudflare deve estar com o nome `mkt-dashboard` (renomeado em 2.11E.1)
- `ADMIN_SECRET_DECOLE` precisa estar configurado como env var do Pages project para smoke de login funcionar

## Decisões tomadas (delta vs plano original)

Nenhuma ainda.
