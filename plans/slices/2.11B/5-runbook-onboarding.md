# Slice 2.11B.5 — Criar RUNBOOK-ONBOARDING-TENANT.md

> Satélite: 2.11B ([`../../PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md`](../../PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md))
> Estimativa: 2 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-19 por Claude Sonnet 4.6 |
| Completed | 2026-05-19 por Claude Sonnet 4.6 |
| Commit final | (ver abaixo) |
| PR | — |
| Janela de smoke | n/a — documentação |

## Contexto

O runbook de onboarding de novo tenant foi prometido ao longo do plano. A seção 6 do satélite 2.11B já tinha os passos macro. Este slice combina esse esboço com todos os detalhes concretos descobertos durante a execução do plano (Store IDs, DB IDs, GTM IDs, CF account IDs, naming conventions) e produz um runbook executável step-by-step para onboarding de um novo tenant como SUPERARE.

## Pré-requisitos

- [x] 2.11B.4 DONE — sGTM publicado em produção com lookup tables multi-tenant
- [x] 2.11A.2 DONE — Secrets Store `default_secrets_store` criado e populado
- [x] Catálogo schema v5 ativo (`config/products.catalog.json`)
- [x] Todos os workers deployados com Secrets Store bindings (Fase 3 completa)

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `plans/slices/2.11B/5-runbook-onboarding.md` | CREATE | Este slice file |
| `plans/RUNBOOK-ONBOARDING-TENANT.md` | CREATE | Runbook step-by-step executável |
| `plans/STATUS-2.11.md` | EDIT | Fase 4: +1 slice DONE |

## Testes

Não aplicável — slice de documentação. G.12 auto-revisão aceita.

## Validação executável

```bash
# Verificar que o runbook foi criado e tem as seções esperadas
grep -c "^## " plans/RUNBOOK-ONBOARDING-TENANT.md
# Esperado: >= 8 seções

grep "SUPERARE" plans/RUNBOOK-ONBOARDING-TENANT.md | wc -l
# Esperado: >= 10 referências (exemplo concreto ao longo do runbook)
```

## Smoke checklist

- [x] Runbook cobre todas as 8 frentes: DNS, Secrets Store, catálogo, sGTM, CF Pages, workers wrangler.toml, smoke checklist
- [x] Todos os IDs concretos referenciados (Store ID, GTM IDs, GCP project)
- [x] Exemplo SUPERARE percorre cada passo
- [x] Checklist executável no final

## Rollback

Slice de documentação — sem rollback necessário. Reverter com `git revert` se conteúdo estiver errado.

## Revisão G.12 — preenchido antes de DONE

> Slice de documentação — auto-revisão aceita (G.12 exceção documentada para slices não-código).

### 2026-05-19 por Claude Sonnet 4.6 — auto-revisão

**Documentação**
- [x] Todos os IDs reais referenciados no runbook (Store ID `23bdc9c2e8ca470d82352c53ec8d2e67`, GTM Account `6266094107`, Container `241313282`, GCP project `gtm-k6q4h6br-ndq3n`)
- [x] Convenção `{SECRET}_{TENANT}[_{PRODUCT}]` usada consistentemente
- [x] Exemplo SUPERARE concreto ao longo de cada passo
- [x] Smoke checklist final executável (comandos `curl`, `dig`, `grep`)
- [x] Zero referências hardcoded a DECOLE onde deveria ser placeholder `{TENANT}`

**Resultado:** APROVADO

---

## Execução (append-only)

### 2026-05-19 por Claude Sonnet 4.6

- O que foi tentado: leitura dos satélites (2.11B seção 6, PLANO-MKT-DASHBOARD seção 5.1, PLANO-MULTI-TENANT-SECRETS-CONFIG seção 2), slices 2.11A.2, 2.11B.2, 2.11B.4 para extrair IDs concretos.
- O que funcionou: todos os IDs encontrados nos slice files existentes; runbook criado com exemplo SUPERARE end-to-end.
- O que falhou: nada.
- Próximo passo: commit `docs(2.11B.5): RUNBOOK-ONBOARDING-TENANT.md`.

## Gotchas / lições aprendidas

- `ADMIN_SECRET_{TENANT}` é um **Cloudflare Pages secret** (não Secrets Store de Workers) — criado via `wrangler pages secret put`, não via Secrets Store API.
- Bindings em `wrangler.toml` dos workers precisam de redeploy para ativar novos secrets do Secrets Store — não é automático.
- DNS CNAME para sGTM pode demorar até 48h para propagar; SSL via Google-managed pode demorar 15-30min após o CNAME ser resolvido.
- Workspace GTM é deletado automaticamente após publish — comportamento esperado.

## Decisões tomadas (delta vs plano original)

- Runbook inclui passo de `wrangler.toml` + redeploy dos workers afetados, que não estava no esboço da seção 6 do satélite 2.11B. Necessário porque os workers bindam secrets do Secrets Store via `wrangler.toml` — adicionar secret ao Store sem binding no toml não o expõe ao worker.
- Roadmap de automação (seção 10 do satélite 2.11B) referenciado mas não detalhado no runbook — foco no processo manual executável hoje.
