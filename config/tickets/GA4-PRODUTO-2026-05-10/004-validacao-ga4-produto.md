# 004 — Validacao GA4/GTM da dimensao `produto`

## Objetivo

Validar ponta a ponta que `produto` aparece como parametro de evento no GA4 para os eventos web canonicos.

## Validacao manual assistida

- [ ] GTM Preview: `/`
- [ ] GTM Preview: `/planodevoo/`
- [ ] GTM Preview: `/bio-insta.html`
- [ ] Browser Network: requests GA4 com `en=page_view` e `ep.produto`.
- [ ] Browser Network: requests GA4 com `en=cta_click` e `ep.produto`.
- [ ] GA4 DebugView: parametros de evento incluem `produto`.

## Validacao automatizada

- [x] Verificacao via GTM API do workspace draft:
  - Tag `39`: `send_page_view = false`
  - Tag `67`: `eventName = page_view`
  - Tag `67`: `produto = {{DL - produto}}`
  - Tag `51`: `eventName = cta_click`
  - Tag `51`: `produto = {{DL - produto}}`
  - Tag `20`: pausada
  - Conflitos de workspace: `0`
- [x] GTM `quick_preview` sem erro de compilacao apos remover `page_title` da tag `67`.
- [x] Versao GTM Web publicada:
  - Versao `18`
  - Nome: `GA4 produto page_view explicito`
- [x] Verificacao via GTM API da versao live:
  - Tag `39`: `send_page_view = false`
  - Tag `67`: `eventName = page_view`
  - Tag `67`: `produto = {{DL - produto}}`
  - Tag `51`: `eventName = cta_click`
  - Tag `51`: `produto = {{DL - produto}}`
  - Tag `20`: pausada
- [x] Browser headless / Network para a property alvo `G-BQQB6X5XN1`:
  - `/`: `page_view` com `ep.produto=DECOLE_ESG_MENTORIA`
  - `/planodevoo/`: `page_view` com `ep.produto=DECOLE_PLANOVOO`
  - `/bio-insta.html`: `page_view` com `ep.produto=DECOLE_ESG_MENTORIA`
- [x] Duplicidade identificada em Bio Insta:
  - causa: `site/bio-insta.html` ainda fazia `dataLayer.push({ event: "page_view", ... })`
  - fix no repo: remover a chave `event` desse push e manter apenas dados de origem no `dataLayer`
- [x] Property externa observada:
  - `G-22ZR1Q37JD` envia `page_view` sem `produto`
  - nao esta no GTM Web `GTM-58CQ9K7X` nem no HTML versionado
  - origem no navegador: script first-party `/syvi/...`
- [ ] GA4 Data API por `eventName` + `customEvent:produto` apos janela de processamento.
- [ ] Confirmar que `page_view` e `cta_click` aparecem para `DECOLE_ESG_MENTORIA`.
- [ ] Confirmar que `page_view` e `cta_click` aparecem para `DECOLE_PLANOVOO`.
- [ ] Confirmar ausencia de `button_click` em dados novos.

## Gate

O dashboard consegue popular `ga4_daily_metrics` por produto usando apenas `page_view` e `cta_click`.
