# Slice 1A — Migration D1 `session_engagement` + merge puro

> Satélite: engagement
> Estimativa: 1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-29 por Claude Sonnet 4.6 (agent) |
| Completed | 2026-05-29 por Claude Sonnet 4.6 (agent) |
| Commit final | (ver `feat(1A)` em git log) |
| PR | — |

## Contexto

Base do modelo híbrido: tabela `session_engagement` (1 linha/sessão, costurada por identidade) + função pura de merge (snapshot↔linha existente) reutilizável por server e testes. Additive — não toca `funnel_events`.

## Pré-requisitos

- [x] 0-disc DONE (não bloqueante para a tabela, mas recomendado)

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

- [x] merge de snapshot vazio (no-op)
- [x] merge de seção repetida (idempotente, sem duplicar — section_view e section_engaged)
- [x] elevação de `funnel_stage` (nunca regride; avança quando patch é maior)
- [x] merge de `vsl_sections` (acumula `watched_sec` por section_id — soma)
- [x] merge de `cta_clicks` (soma counts por `cta_id`)
- [x] `max_scroll_pct` toma o máximo
- [x] `vsl_max_pct` toma o máximo

## Validação executável

```bash
cd packages/shared && npx vitest run
# Esperado: 80 passed, 0 failed (resultado real: 80/80 ✓)

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

## Revisão G.12 — 2026-05-29 por Claude Sonnet 4.6 (agent — Slice Validator independente)

> Agente diferente do implementador, actuando como revisor autónomo conforme GUARDRAILS.

**Código TypeScript**
- [x] Strict mode respeitado — sem `any`, sem `!` não justificado
- [x] Funções puras — `mergeSnapshot`, `maxFunnelStage`, `mergeVslSections`, `mergeCtaClicks`, `unionStringArray` sem IO/rede/DOM
- [x] 0 referências hardcoded a tenants/produtos em `session-engagement.ts` (grep confirma)
- [x] Nomes expressivos; sem abreviações opacas

**Arquitectura**
- [x] `session_engagement.sql` segue exactamente o DDL do PLANO
- [x] Migration idempotente via `__funilmkt_schema_migrations` (padrão existente em dashboard-sync)
- [x] Chamada em ambos os entry points: `scheduled` e `fetch`

**Testes**
- [x] TDD Red verificável: stub `throw new Error('not implemented')` confirmado falhar antes da implementação
- [x] Happy path + edge cases: idempotência, stage não regride, vsl soma, cta soma, max pct
- [x] 80/80 testes verdes — sem regressões nos testes anteriores
- [x] Sem `it.only` ou `describe.skip`

**Resultado:** APROVADO

---

## Execução (append-only)

### 2026-05-29 por Claude Sonnet 4.6 (agent)

- **Red**: criados `session-engagement.test.ts` (11 casos) e stub com `throw new Error('not implemented')`. Confirmado 11 FAIL com `npx vitest run`.
- **Green**: implementado `mergeSnapshot` com helpers puros (`maxFunnelStage`, `mergeVslSections`, `mergeCtaClicks`, `unionStringArray`). Confirmado 80/80 PASS sem regressões.
- **SQL**: criado `config/d1/session_engagement.sql` com DDL exacto + 3 índices (`idx_se_tenant_profile`, `idx_se_tenant_anon`, `idx_se_tenant_product_stage`).
- **Migration**: adicionada `applyEngagementMigrationsOnce` em `workers/dashboard-sync/src/index.ts` seguindo exactamente o padrão `__funilmkt_schema_migrations`. Migration ID: `session_engagement_v1_2026_05_29`. Chamada em `scheduled` e `fetch`.
- **Guardrails**: `grep hardcode` → 0 matches; `git diff --check` → OK.

## Gotchas / lições aprendidas

- `page_views` com `patch.page_views ?? 0` para garantir que patch vazio não incrementa o contador
- `unionStringArray` usa `Set` para idempotência — preserva ordem de inserção
- funnel_stage: order array `FUNNEL_STAGE_ORDER` evita string comparison ad-hoc; indexOf devolve -1 para undefined, mas a guarda `if (!a) return b` garante segurança
