# 001 — GTM Web: `page_view` explicito com `produto`

## Objetivo

Fazer o `page_view` das landing pages chegar no GA4 com `ep.produto` preenchido.

## Causa raiz

O `page_view` atual e gerado automaticamente por tags Google Tag / GA4 Config em All Pages. Essas tags nao carregam o parametro `produto`, mesmo que o `dataLayer` inicial ja tenha `produto`.

## Fix

- [x] Desativar envio automatico de `page_view` na tag Google Tag / GA4 Config responsavel por All Pages:
  - Tag `39` `FB_CONVERSIONS_API-1329973348435032-Web-Tag-GA4_Config`
  - `send_page_view = false`
- [x] Criar tag GA4 Event explicita:
  - `event_name = page_view`
  - `produto = {{DL - produto}}`
  - measurement ID: `G-BQQB6X5XN1`
  - Tag `67` `GA4 - Page View - Produto`
- [x] Usar trigger de page load que cubra as landing pages relevantes.
  - Trigger `66` `DOM Ready - Page View Produto`
- [x] Evitar duplicidade com tags especificas existentes, como `GA4 - Page View - Bio Insta`.
  - Tag `17` `GA4 - Page View - Bio Insta` permanece pausada no workspace draft.

## Execucao

- Workspace GTM Web: `22` (`Default Workspace`)
- Versao publicada: `18` — `GA4 produto page_view explicito`
- Estado: publicado.
- Conflitos de workspace: `0`.
- Observacao: o parametro `page_title` foi removido da tag nova porque a built-in variable `Page Title` nao esta habilitada no container; `page_location`, `page_referrer` e `produto` permanecem.

## Teste

- [ ] GTM Preview em `/`.
- [ ] GTM Preview em `/planodevoo/`.
- [ ] GTM Preview em `/bio-insta.html`.
- [x] Network browser confirma `en=page_view` com `ep.produto` para a property alvo `G-BQQB6X5XN1`.
  - `/`: 1 `page_view`, `ep.produto=DECOLE_ESG_MENTORIA`
  - `/planodevoo/`: 1 `page_view`, `ep.produto=DECOLE_PLANOVOO`
  - `/bio-insta.html`: 1 `page_view`, `ep.produto=DECOLE_ESG_MENTORIA`
- [ ] GA4 DebugView mostra `page_view` com parametro `produto`.

## Gate

`page_view` aparece no GA4 uma unica vez por carregamento de pagina e sempre com `produto`.
