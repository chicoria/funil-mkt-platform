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
  - `/`: 1 `page_view`, `ep.produto=DECOLE_ESG_MENTORIA`
  - `/planodevoo/`: 1 `page_view`, `ep.produto=DECOLE_PLANOVOO`
  - `/bio-insta.html`: 1 `page_view`, `ep.produto=DECOLE_ESG_MENTORIA`
- [x] Duplicidade identificada em Bio Insta:
  - causa: `site/bio-insta.html` ainda fazia `dataLayer.push({ event: "page_view", ... })`
  - fix no repo: remover a chave `event` desse push e manter apenas dados de origem no `dataLayer`
  - fix publicado via push e revalidado no site publicado
- [x] Property externa observada:
  - `G-22ZR1Q37JD` envia `page_view` sem `produto`
  - pertence ao container `GTM-KLVRLSWN` (`elizetefazza.com`), nao ao `GTM-58CQ9K7X`
  - origem no navegador em DECOLE: script first-party `/syvi/...`
- [x] Fix da property externa:
  - Container `GTM-KLVRLSWN`
  - Versao publicada `14`: `Restrict Elizete GTM to own hostname`
  - Tags ativas restringidas ao trigger `Page View - somente elizetefazza.com`
  - Tags afetadas: `[Pixel] Facebook`, `Google Tag G-22ZR1Q37JD`, `G4 Fluxo de Dados para decolesuacarreiraesg.com.br`
- [x] Revalidacao apos fix externo:
  - `/`: nenhum hit `G-22ZR1Q37JD`; 1 `page_view` `G-BQQB6X5XN1` com `DECOLE_ESG_MENTORIA`
  - `/planodevoo/`: nenhum hit `G-22ZR1Q37JD`; 1 `page_view` `G-BQQB6X5XN1` com `DECOLE_PLANOVOO`
  - `/bio-insta.html`: nenhum hit `G-22ZR1Q37JD`; 1 `page_view` `G-BQQB6X5XN1` com `DECOLE_ESG_MENTORIA`
  - `https://elizetefazza.com/`: continua enviando `page_view` para `G-22ZR1Q37JD`
- [x] Fix `sign_up` Plano de Voo:
  - Container `GTM-58CQ9K7X`
  - Versao publicada `19`: `GA4 sign_up PlanoVoo`
  - Tag criada `69`: `GA4 - Sign Up - PlanoVoo`
  - Trigger criado `68`: `Sign Up - PlanoVoo`
- [x] Revalidacao das paginas de confirmacao:
  - `/confirmacao.html`: `sign_up` com `produto=DECOLE_ESG_MENTORIA`, `event_name=CompleteRegistration`; `page_view` com `produto=DECOLE_ESG_MENTORIA`
  - `/planodevoo/confirmacao.html`: `sign_up` com `produto=DECOLE_PLANOVOO`, `event_name=CompleteRegistration`; `page_view` com `produto=DECOLE_PLANOVOO`
- [ ] GA4 Data API por `eventName` + `customEvent:produto` apos janela de processamento.
- [ ] Confirmar que `page_view` e `cta_click` aparecem para `DECOLE_ESG_MENTORIA`.
- [ ] Confirmar que `page_view` e `cta_click` aparecem para `DECOLE_PLANOVOO`.
- [ ] Confirmar ausencia de `button_click` em dados novos.

## Gate

O dashboard consegue popular `ga4_daily_metrics` por produto usando apenas `page_view` e `cta_click`.
