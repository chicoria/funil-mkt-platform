# Product Engineer — Meta Pixel + CAPI (2026-11-01)

Tenant `product-engineer`, site theproductengineer.net. Segue a Frente 3c do
[runbook](../RUNBOOK-ONBOARDING-TENANT.md). O onboarding de 2026-10-08 ficou
"sem Meta nesta fase"; esta é essa fase.

## Decisões do titular

- Business próprio: "Adilson Chicoria - Business" (`1147709561172015`), não o
  da DECOLE.
- **Sem banner de consentimento**: o titular decidiu instalar o Pixel sem
  banner e assume o risco RGPD para visitantes da UE.
- Mesmo padrão da DECOLE/Plano de Voo; nada de Pixel no código do site. Uma
  primeira instalação em `assets/analytics.js` (commit `f6282a0` no repo do
  site) foi revertida antes de publicar (`4f5c3d7`).

## M1 — Ativos Meta — DONE (2026-11-01)

Passos, casos de uso e permissões: [RUNBOOK-META-BUSINESS-NOVO.md](../RUNBOOK-META-BUSINESS-NOVO.md).

| Ativo | ID | Como |
|---|---|---|
| Business | `1147709561172015` | titular |
| App "PE Agents API" (Business; Marketing API, Instagram, Páginas) | `1652135719775313` | Claude pelo Chrome; senha pelo titular |
| System user `agent-api-pe` (Admin) | `61596252744678` (app-scoped `122095196313541758`) | Claude pelo Chrome |
| Ativos do system user | Página The Product Engineer, app, Instagram @adilsonchicoria (`17841400141127553`) | Claude + titular |
| Token sem expiração, 24 permissões | `META_SYSTEM_USER_ACCESS_TOKEN_PRODUCT_ENGINEER` em `~/.env.local` | gravado do clipboard; GET `me` confirma |
| Dataset/Pixel "The Product Engineer (theproductengineer.net)" | `3208451502837323` | interface; `POST /{business}/adspixels` deu #10 |

Fecho de M1 (2026-11-01):
- `agent-api-pe` atribuído ao Pixel pela interface (separador Pessoas, acesso
  total); GET `assigned_users` confirma `ADVERTISE, UPLOAD, ANALYZE, EDIT`.
- Test event code `TEST43942` (`META_TEST_EVENT_CODE_PRODUCT_ENGINEER`).
- CAPI de teste com o token do `agent-api-pe`: `events_received: 1`. Esse token
  serve de token CAPI; não foi gerado outro.
- `~/.env.local`: `META_BUSINESS_ID_`, `META_APP_ID_`, `META_SYSTEM_USER_ACCESS_TOKEN_`,
  `META_PIXEL_ID_`, `META_TEST_EVENT_CODE_PRODUCT_ENGINEER`.

## M2 — GTM Web `GTM-TK6V8G33` (`266435700`) — NOT_STARTED

Live v4 tem só GA4 Configuration + GA4 Event - All Custom Events. Replicar do
live v23 da DECOLE as 5 tags, 2 triggers e 8 variáveis
`FB_CONVERSIONS_API-1329973348435032-Web-*` com o pixel `3208451502837323`.
Mapa `FBEventName`: `generate_lead` → `Lead`, `bio_link_click` → custom
`BioLinkClick`. Publicar só com diff revisto; exportar para `trafego/gtm/`.

## M3 — sGTM `241313282` — NOT_STARTED

Live v25. `LT - Tenant ID by Host` já tem `theproductengineer.net → product-engineer`.
Acrescentar:
- `LT - Meta Pixel ID by Tenant/Product`: `product-engineer|PRODUCT_ENGINEER_NEWSLETTER` → `3208451502837323`
- `LT - Meta CAPI Token by Tenant`: `product-engineer` → `META_SYSTEM_USER_ACCESS_TOKEN_PRODUCT_ENGINEER`
- `LT - Meta Test Event Code by Tenant/Product`: `product-engineer|PRODUCT_ENGINEER_NEWSLETTER` → `TEST43942`

Container partilhado com DECOLE e Entrepontos: Planning Review antes de publicar.

## M4 — Catálogo e smoke — NOT_STARTED

`tenants.product-engineer` no catálogo (`metaPixel`, `metaCapi`), `updatedAt`.
Smoke: Pixel Helper (PageView), Testar eventos (Lead com test code),
deduplicação browser/servidor pelo `event_id`.

## Execução M2–M4 (2026-11-01)

Verificação prévia: o GA4 Configuration do PE já tem
`transport_url = https://sgtm.theproductengineer.net`. A `LT - Tenant ID by
Host` só tinha `theproductengineer.net`, mas o pedido chega com host
`sgtm.theproductengineer.net` (DECOLE e Entrepontos usam `sgtm.…`). O GA4
chega na mesma (a tag GA4 do sGTM usa o measurement ID do pedido), mas a tag
Meta CAPI precisa do tenant: acrescentada a linha `sgtm.theproductengineer.net`.

**M2 — workspace `meta-pixel-2026-11-01` (GTM Web 266435700), por publicar.**
Copiado do live v23 da DECOLE, pixel trocado, com adaptações:
- não copiada a `GA4_Config` do template (o PE já tem a sua com `transport_url`);
- pausada (não apagada) `GA4 Event - All Custom Events`: a `GA4_Event` do
  template substitui-a e manda `event_id`, `user_data`, `produto`;
- `Custom_Event` exclui `^gtm\.` (o PageView vem do `DOM_Ready`);
- `DOM_Ready` só em `^(www\.)?theproductengineer\.net$`;
- `DL - produto` com default `PRODUCT_ENGINEER_NEWSLETTER` (sem ele o PageView
  não acha pixel no sGTM); `DL - event_id`; built-in Container ID.
Diff: 4 tags, 2 triggers, 10 variáveis, 1 built-in, 1 tag pausada; 0 conflitos.

**M3 — workspace `meta-product-engineer-2026-11-01` (sGTM 241313282), por publicar.**
Só linhas acrescentadas: Tenant by Host `sgtm.theproductengineer.net`;
Pixel, Token e Test code para `product-engineer|PRODUCT_ENGINEER_NEWSLETTER`.
Diff: 4 variáveis atualizadas; 0 conflitos.

**Publicação:** a chamada de publish foi recusada pelo classificador de
permissões do agente; publica o titular (ver relatório da sessão).

**M4 — catálogo:** `tenants.product-engineer.tracking.metaCapi` e
`products.PRODUCT_ENGINEER_NEWSLETTER.tracking.metaPixel`, `updatedAt`
2026-11-01. Vitest: 583 passam; 1 ficheiro falha por motivo alheio
(`tests/setup-brevo-domain.test.mjs` sem suite vitest).

## Ledger

| Fatia | Aceite | Status |
|---|---|---|
| M1 | Ativos, token, atribuição ao pixel e CAPI de teste | DONE |
| M2 | GTM Web live com tags Meta, PageView no Pixel Helper | IN_PROGRESS (workspace pronto, falta publicar) |
| M3 | LTs sGTM live, CAPI de teste recebido | IN_PROGRESS (workspace pronto, falta publicar) |
| M4 | Catálogo + smoke de deduplicação + checagem Codex | IN_PROGRESS (catálogo feito; smoke e Codex depois de publicar) |
