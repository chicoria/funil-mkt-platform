# 002 — Remover legado `button_click`

## Objetivo

Eliminar o evento generico `button_click` do fluxo web e consolidar cliques relevantes em `cta_click`.

## Contexto

O catalogo e as landing pages usam `CTA_CLICK` / `cta_click` como evento canonico de clique de chamada para acao. Manter `button_click` aumenta ruido no GA4 e no dashboard.

## Fix

- [x] Desativar ou remover no GTM Web a tag antiga `GA4 - Button Click Metodo - Bio Insta`.
  - Tag `20` permanece pausada no workspace draft.
- [x] Confirmar que `site/bio-insta.html` envia `cta_click`, nao `button_click`.
- [x] Confirmar que `products.catalog.json` nao declara `BUTTON_CLICK`.
- [x] Confirmar que `dashboard-sync` nao consulta `button_click`.
- [x] Confirmar que docs e diagramas nao mantem `button_click` como evento ativo.

## Execucao

- Workspace GTM Web: `22` (`Default Workspace`)
- Versao publicada: `18` — `GA4 produto page_view explicito`
- Estado: publicado.

## Teste

- [x] `rg "button_click|BUTTON_CLICK"` sem referencias ativas ao evento fora destes tickets.
- [ ] GTM Preview nao dispara tag `button_click`.
- [ ] GA4 DebugView nao recebe `button_click` em navegação normal.

## Gate

Nao ha emissao ativa de `button_click`; os cliques de CTA chegam como `cta_click` com `produto`.
