# Slice 2 — Workers Analytics Engine: eventos crus + drill-down VSL ao segundo

> Satélite: engagement · Fase 2 (posterior)
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

Drill-down cru (em que segundo da VSL largam; cada section_view individual) sem inundar o D1. Workers Analytics Engine: cardinalidade ilimitada, sampling, SQL API, retenção ~90d → rollup. Sem JOIN (só GROUP BY); a coorte por identidade continua no D1 (fase 1).

## Pré-requisitos

- [ ] 1E DONE (pipeline de engajamento funcionando)
- [ ] Volume real observado (decidir sampling/retention)

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição |
|---|---|---|
| `workers/funnel-dispatcher/src/...` ou ingress | EDIT | escrever eventos crus no dataset Analytics Engine (blobs: anonymous_id, product, event, section_key; doubles: vsl_pct, time_sec) |
| `wrangler.toml` do worker | EDIT | binding `analytics_engine_datasets` |
| `mkt-dashboard` (drill-down) | EDIT | consulta AE por `anonymous_id`/`session_id` na jornada |
| testes | CREATE | unit do escritor/consulta |

## Testes

- [ ] unit do escritor (mapeia evento → blobs/doubles)
- [ ] consulta AE por anonymous_id retorna a linha do tempo crua
- [ ] sampling/retention configurados

## Validação executável

```bash
# SQL API do Analytics Engine: GROUP BY section_key / faixa de segundos
# drill-down na jornada (mkt-dashboard) mostra retenção ao segundo
```

## Rollback

Desabilitar o binding/escrita; D1 e dashboard fase 1 seguem funcionando.

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova.

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- AE não substitui o D1 (coorte continua em D1)? custo/retention OK?

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
