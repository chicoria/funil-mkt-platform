# 003 — Alinhar repositorio, catalogo, dashboard e diagramas

## Objetivo

Refletir no repositorio a semantica final de delivery e eventos web:

- `gtm_web_only` envia tracking via GTM Web/sGTM, mas nao entra no funil operacional.
- `both` em `GENERATE_LEAD` significa backend queue + tracking web/sGTM, sem `emit_tracking` no dispatcher.
- Dashboard usa `page_view` e `cta_click` com dimensao `customEvent:produto`.

## Arquivos no escopo

- `config/products.catalog.json`
- `config/DIAGRAMS.md`
- `config/DASHBOARD.md`
- `config/ARCHITECTURE.md`
- `config/diagramas/*.puml`
- `workers/dashboard-sync/src/index.ts`
- `marketing/Estrategia.md`
- `site/bio-insta.html`

## Fix

- [x] Remover `BUTTON_CLICK` do catalogo.
- [x] Incluir `PAGE_VIEW` para Plano de Voo no catalogo.
- [x] Alinhar Bio Insta para `cta_click`.
- [x] Filtrar no dashboard-sync apenas `page_view` e `cta_click`.
- [x] Documentar `GENERATE_LEAD` como backend queue + tracking web/sGTM.
- [x] Adicionar diagrama de delivery por evento.
- [x] Validar JSON e diagramas.
- [x] Rodar typecheck/build do worker impactado.

## Validacao executada

- `products.catalog.json` parse OK.
- `plantuml -checkonly config/diagramas/05-dados-entrada-funil.puml config/diagramas/06-eventos-delivery.puml` OK.
- `npx tsc --noEmit` em `workers/dashboard-sync` OK.
- `rg "button_click|BUTTON_CLICK"` retorna apenas estes tickets, sem referencias ativas no codigo/catalogo/docs operacionais.

## Gate

Catalogo, docs, diagramas e codigo concordam sobre os eventos canonicos e suas rotas de delivery.
