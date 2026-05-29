# Slice 1E — Pipeline: normalizer + `upsert_session_engagement` + stitching

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

Persistir o engajamento: o `ENGAGEMENT_SNAPSHOT` chega ao `api-funnel-ingress` → queue → funnel-dispatcher, que faz UPSERT por `(tenant_id, session_id)` usando o merge puro (1A). A stitching propaga `profile_id`/`became_lead`/`purchased` para sessões anônimas quando o lead/compra resolve identidade.

## Pré-requisitos

- [ ] 1A DONE (tabela + merge puro)
- [ ] 1B DONE (eventos `engagement_rollup` no catálogo)

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição |
|---|---|---|
| `packages/shared/src/event-normalizer.ts` | EDIT | aceitar/normalizar os novos `eventType` de engajamento |
| `workers/funnel-dispatcher/src/handlers/upsert-session-engagement.ts` | CREATE | handler (espelha `upsert_event_store`), usa merge puro |
| `workers/funnel-dispatcher/src/...` (chain) | EDIT | acionar handler p/ `delivery=engagement_rollup`; stitching em GENERATE_LEAD/PURCHASE_* |
| `workers/api-funnel-ingress/src/index.ts` | EDIT | aceitar `ENGAGEMENT_SNAPSHOT` no ingress existente |
| testes unit/integração | CREATE | normalizer + dispatcher |

## Testes

### Unit / Integração (TDD Red primeiro)

- [ ] normalizer: cada `eventType` novo → `FunnelEvent` correto
- [ ] integração: sessão anônima → lead → compra resulta em **1 linha** com merge correto
- [ ] stitching: UPDATE por `anonymous_id` preenche `profile_id`/`became_lead`/`purchased` (inclusive sessão anterior)
- [ ] idempotência (re-entrega da queue não duplica)

## Validação executável

```bash
cd workers/funnel-dispatcher && npx vitest run
cd workers/api-funnel-ingress && npx vitest run
# D1 local: SELECT * FROM session_engagement WHERE session_id=? → 1 linha mesclada
```

## Rollback

```bash
# feature-flag/desabilitar chain engagement_rollup (eventos descartados)
git revert <hash> && wrangler deploy
```

Demais eventos do funil não afetados.

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova. Planning Review obrigatório (cross-module).

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- merge puro reutilizado (sem regra de negócio no handler/IO)?
- stitching cobre sessões anteriores? idempotente? isolamento por tenant?

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
