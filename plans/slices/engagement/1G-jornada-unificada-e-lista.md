# Slice 1G — Jornada unificada (anon+profile) + comportamento agregado + lista

> Satélite: engagement · Repo: `mkt-dashboard`
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

Visualizar a jornada de um usuário (anônimo ou identificado): timeline de eventos únicos (`funnel_events`) + marcadores por sessão (rollup) + painel agregado de comportamento. E uma lista navegável de usuários (anônimos + identificados) com acesso à jornada. Rota unificada aceita `profile_id` ou `anonymous_id`.

## Pré-requisitos

- [ ] 1E DONE (rollup povoado)
- [ ] 1F recomendado (queries base)

## Mudança

### Arquivos a criar/modificar (repo mkt-dashboard)

| Arquivo | Ação | Descrição |
|---|---|---|
| `lib/d1.ts` | EDIT | `getUserJourney` aceita `anonymous_id` + LEFT JOIN `session_engagement`; nova `listUsers(tenantId,{filter,cursor})` |
| `app/dashboard/user/[id]/page.tsx` | CREATE/EDIT | rota unificada (profile_id ou anonymous_id) |
| `components/UserTimeline.tsx` | EDIT | marcadores por sessão (engajamento agregado) |
| `components/UserBehaviorSummary.tsx` | CREATE | totais: nº sessões, seções distintas, vsl_max_pct, CTAs, tempos |
| `components/UserList.tsx` | CREATE | lista anônimos + identificados, filtro, link p/ jornada |
| `app/dashboard/user/page.tsx` | EDIT | lista navegável (mantém busca por email) |
| `lib/d1.test.ts` | EDIT | unit de `getUserJourney`/`listUsers` (anon e profile) |

## Testes

### Unit (TDD Red primeiro)

- [ ] `getUserJourney` por `profile_id` e por `anonymous_id`
- [ ] `listUsers`: filtro todos/anônimos/identificados, ordem por `last_seen_at`, paginação
- [ ] sem PII para anônimos

## Validação executável

```bash
cd mkt-dashboard && npx vitest run
npm run dev   # jornada de um anonymous_id e de um profile_id; lista navega e abre a jornada certa
```

## Rollback

```bash
git revert <hash>   # leitura apenas
```

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova. Planning Review obrigatório (dados pessoais).

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- rota unificada cobre anon e profile? lista sem PII para anônimos?
- SoC e isolamento por tenant mantidos?

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
