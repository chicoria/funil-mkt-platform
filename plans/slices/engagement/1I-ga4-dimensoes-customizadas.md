# Slice 1I — GA4 Admin: dimensões customizadas + reconciliação no dashboard-sync

> Satélite: engagement · Outward-facing (GA4 Admin API)
> Estimativa: 0,5 dia

## Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |
| Commit final | — |
| PR | — |

## Contexto

Registrar as dimensões customizadas event-scoped para os parâmetros de engajamento, reaproveitando `produto` (já existe, `customEvent:produto`). E estender `dashboard-sync/src/ga4.ts` para ler os novos eventos na reconciliação.

## Pré-requisitos

- [ ] 0-disc DONE (quantas das 50 dimensões livres; nomes de credenciais)
- [ ] 1H DONE (eventos chegando ao GA4)

## Mudança

### Dimensões a registrar (consolidar LP+VSL)

`section_id`, `section_name`, `section_index`, `visible_pct`, `time_visible_ms`, `vsl_version`, `vsl_section_key`, `video_time_sec`, `progress_pct`. Via Admin API `customDimensions.create` (`GOOGLE_SERVICE_ACCOUNT_JSON` + `GA4_PROPERTY_ID`).

### Arquivos a modificar

| Arquivo | Ação | Descrição |
|---|---|---|
| `workers/dashboard-sync/src/ga4.ts` | EDIT | incluir `section_view`/`section_engaged`/`vsl_section_*` no `runReport` (filtro/dimensões) p/ reconciliação |
| `workers/dashboard-sync/test/unit/*` | EDIT | unit do report atualizado |

## Testes

- [ ] unit do report GA4 com os novos eventos/dimensões
- [ ] GA4 Data API mostra as dimensões registradas

## Validação executável

```bash
cd workers/dashboard-sync && npx vitest run
# Admin API: customDimensions.list confirma as novas
```

## Rollback

Dimensões GA4 podem ser arquivadas (não deletadas). `git revert` do código de `ga4.ts`.

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova.

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- consolidação respeita o limite de 50? `produto` reaproveitado?
- reconciliação coerente com a fonte primária D1?

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
