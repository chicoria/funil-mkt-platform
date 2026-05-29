# Slice 1H — GTM Web: vars/triggers/tags GA4 dos eventos de engajamento

> Satélite: engagement · Outward-facing (GTM/GA4)
> Estimativa: 0,5–1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |
| Commit final | — |
| PR | — |

## Contexto

Perna analytics (aditiva): replicar o padrão real do `cta_click` (`trafego/gtm/cta-click-import.json`) para os novos eventos no container Web `GTM-58CQ9K7X` (account `6266094107`, container `231314463`). `engagement_snapshot` não recebe tag (vai só para D1).

## Pré-requisitos

- [ ] 0-disc DONE (estado live + nomes de credenciais)
- [ ] 1D DONE (eventos no `dataLayer`)

## Mudança

### Por evento (`section_view`, `section_engaged`, `vsl_section_start`, `vsl_section_end`, opcional `vsl_section_progress`)

1. Variáveis `DL - <param>` (tipo `v`, dataLayerVersion 2)
2. Trigger `CUSTOM_EVENT` `_event == <event_name>`
3. Tag GA4 (`gaawe`) com `eventName`, `eventSettingsTable` mapeando `{{DL - param}}`→parâmetro, `measurementIdOverride = G-BQQB6X5XN1`

### Artefato versionado (repo decole)

| Arquivo | Ação | Descrição |
|---|---|---|
| `trafego/gtm/engagement-web-import.json` | CREATE | export do container Web atualizado |

Aplicar via Tag Manager API v2 em **workspace** (não publicar direto): credenciais `GOOGLE_SERVICE_ACCOUNT_JSON` + `GTM_*_WEB`.

## Testes

- [ ] GTM Preview: tags disparam com os parâmetros corretos
- [ ] GA4 DebugView: eventos `section_*`/`vsl_section_*` aparecem com params

## Validação executável

```bash
# GTM Preview + GA4 DebugView (manual/semi-automático)
# diff do export commitado
git diff --stat trafego/gtm/engagement-web-import.json
```

## Rollback

GTM tem versionamento nativo: publicar a versão anterior. Workspace descartável antes de publicar.

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova.

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- nomes de parâmetros consistentes com o `dataLayer.push` do site (1D)?
- export versionado? aplicado em workspace e revisado antes de publicar?

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
