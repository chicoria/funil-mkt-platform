# Slice 1A — Migration D1 `session_engagement` + merge puro

> Satélite: engagement
> Estimativa: 1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |
| Commit final | — |
| PR | — |

## Contexto

Base do modelo híbrido: tabela `session_engagement` (1 linha/sessão, costurada por identidade) + função pura de merge (snapshot↔linha existente) reutilizável por server e testes. Additive — não toca `funnel_events`.

## Pré-requisitos

- [ ] 0-disc DONE (não bloqueante para a tabela, mas recomendado)

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição |
|---|---|---|
| `config/d1/session_engagement.sql` | CREATE | DDL da tabela + índices (ver PLANO) |
| `workers/dashboard-sync/src/index.ts` (ou migração equiv.) | EDIT | migration idempotente via `__funilmkt_schema_migrations` |
| `packages/shared/src/session-engagement.ts` | CREATE | tipos + `mergeSnapshot(existing, snapshot)` **puro** |
| `packages/shared/test/unit/session-engagement.test.ts` | CREATE | unit do merge |

### DDL

Ver `PLANO-ENGAGEMENT-FUNIL-COMPLETO.md` (bloco SQL `session_engagement` + 3 índices).

## Testes

### Unit (TDD Red primeiro)

- [ ] merge de snapshot vazio (no-op)
- [ ] merge de seção repetida (idempotente, sem duplicar)
- [ ] elevação de `funnel_stage` (nunca regride)
- [ ] merge de `vsl_sections` (acumula `watched_sec`, preserva `started/ended`)
- [ ] merge de `cta_clicks` (soma counts por `cta_id`)

## Validação executável

```bash
cd packages/shared && npx vitest run
# Esperado: N passed, 0 failed
# migration local
wrangler d1 execute <DB> --local --file=config/d1/session_engagement.sql
wrangler d1 execute <DB> --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='session_engagement'"
```

## Rollback

```bash
wrangler d1 execute <DB> --command "DROP TABLE IF EXISTS session_engagement"
git revert <hash>
```

Additive: `funnel_events` e o restante do funil não são afetados.

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova.

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- merge é função pura (sem IO)? happy+edge cobertos?
- DDL/índices conforme PLANO? migration idempotente?

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
