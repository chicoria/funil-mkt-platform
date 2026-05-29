# Slice 1J — Meta: eventos custom de alta intenção (Pixel + CAPI), flag `metaForward`

> Satélite: engagement · Outward-facing (Meta Graph/CAPI + GTM Server)
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

Enviar **seletivamente** ao Meta só eventos de alta intenção (evitar diluição): ex. `VSLProgress` (≥75%), `SectionEngaged` na seção de oferta, via Pixel (web) + CAPI (server, padrão `meta-am.ts`/`emit_tracking`). Controlado por flag `metaForward` por evento no catálogo.

## Pré-requisitos

- [ ] 0-disc DONE (pixels/eventos Meta existentes; nomes de token corretos)
- [ ] 1D DONE (eventos no dataLayer); 1H recomendado

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição |
|---|---|---|
| `config/products.catalog.json` | EDIT | flag `metaForward` nos eventos de alta intenção; `updatedAt` |
| `trafego/gtm/engagement-server-import.json` | CREATE (repo decole) | export container Server (tags Meta CAPI) |
| worker/handler CAPI (se server-side) | EDIT | espelhar `emit_tracking` p/ os eventos marcados |

Credenciais: `META_SYSTEM_USER_ACCESS_TOKEN`, `META_PIXEL_ID_DECOLE_ESG`/`_PLANOVOO`, `META_CAPI_ACCESS_TOKEN_*`, `META_TEST_EVENT_CODE_*`.

## Testes

- [ ] Meta Events Manager → Test Events confirma os eventos (com `META_TEST_EVENT_CODE_*`)
- [ ] flag `metaForward=false` suprime o envio
- [ ] dedup browser/server (event_id) sem dupla contagem

## Validação executável

```bash
# Test Events no Events Manager (manual) usando META_TEST_EVENT_CODE_*
node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"
```

## Rollback

Desligar pela flag `metaForward`; publicar versão GTM Server anterior. `git revert` do código.

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova. Planning Review obrigatório (analytics/dados pessoais).

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- seleção de alta intenção evita diluição? flag por evento funciona?
- sem token/secret no diff? dedup correto?

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
