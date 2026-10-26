# Onboarding — adilsonchicoria.net (só GA4 via GTM)

> Baseado em: [`RUNBOOK-ONBOARDING-TENANT.md`](../RUNBOOK-ONBOARDING-TENANT.md) v2.0, **apenas a Frente 3b**.
> Data: 2026-10-26. Executado por Claude (sessão adilson-hub).

## Contexto

Site pessoal estático (Cloudflare Pages, repo `chicoria/adilsonchicoria`, submodule
`sites/adilsonchicoria.net` do adilson-hub). Objetivo pedido: medir o site e as visitas.
Não é um tenant do funil: sem formulário, catálogo, Brevo, secrets, workers, dashboard nem Turnstile.

## Escopo

| Frente | Situação |
|---|---|
| 3b — Web container: GA4 Configuration + ponte de eventos | ✅ feito |
| 3b.3 — `transport_url` / sGTM (Frentes 1, 3, 7) | ⏸ fora de escopo — hits vão direto ao Google |
| 2, 2b, 4, 5, 6, 8, 9 | não se aplica (sem funil) |

## IDs (também em `~/.env.local`, sufixo `_ADILSONCHICORIA_NET`)

| Recurso | Valor |
|---|---|
| GA4 account | `413458001` ("Adilson Chicória") |
| GA4 property | `560731739` (`adilsonchicoria.net`, Europe/Lisbon, EUR) |
| GA4 measurement ID | `G-F2G82GGJMD` |
| GTM account | `6400184658` ("Adilson Chicoria") |
| GTM container | `GTM-MN25JQ55` (containerId `283725583`), versão publicada `2` |

## Execução (append-only)

### 2026-10-26 by Claude (sessão adilson-hub)

- Primeiro tudo foi criado nas contas "The Product Engineer" (GA4 `411264354`, GTM
  `6381217846`), onde a service account já era admin. A pedido de Adilson, migrado para
  contas próprias:
  - GA4: Adilson criou a conta `413458001` na UI, adicionou a SA e **moveu** a propriedade
    `560731739` pela UI (Property details → Move property). O measurement ID não muda ao mover.
  - GTM: Adilson criou a conta `6400184658` com o container `GTM-MN25JQ55` e adicionou a SA
    como Administrator; a SA configurou e publicou o container.
- Container: `GA4 Configuration - adilsonchicoria.net` (`googtag`, trigger `2147479553`),
  trigger `All Custom Events` (regex negando `^gtm\..*`) e tag `GA4 Event - All Custom Events`
  (`gaawe`, `eventName={{Event}}`), sem `configSettingsTable`.
- Site: snippet GTM em `index.html` e no gerador `scripts/build_text.py` (`text/index.html`
  é gerada). Commits `11737a1` (no ar) e `766415f`.
- Verificação: `gtm.js?id=GTM-MN25JQ55` contém `G-F2G82GGJMD`; GA4 `runRealtimeReport`
  depois de uma visita real: `page_view` 4, `session_start` 1, `first_visit` 1; Tag Assistant
  mostrou `G-F2G82GGJMD` + `GT-PLWHCDZR` e `GTM-MN25JQ55`.
- Limpeza feita por Adilson na UI: propriedade duplicada `560751363`, rascunho `560810580`
  ("REMOVER") e container antigo `GTM-P9W7FLJJ`.

### Gotchas

- **A SA não cria contas GTM**: a Tag Manager API v2 não tem `accounts.create`. Conta nova
  só pela UI; depois convidar a SA como Administrator.
- **Propriedade GA4 não se move por API**: só pela UI, e precisa de Editor nas duas contas.
  Criar uma propriedade nova na conta destino, em vez de mover, gera um measurement ID novo.
- **Exclusões pela SA foram negadas pelo classificador do harness** (DELETE de propriedades
  GA4), como na Frente 7.2. O humano apaga pela UI.
- Realtime API: `eventName` + `activeUsers` juntos dá `Selected dimensions and metrics cannot
  be queried together`; usar só `eventCount`.
- Páginas geradas: pôr o snippet no gerador, senão o próximo build o apaga.

## Pendente

- Banner de consentimento (GDPR), como no Entrepontos, antes de divulgar o site amplamente.
- sGTM (`sgtm.adilsonchicoria.net` + `transport_url`) só se vierem a ser precisos cookies
  first-party ou conversões.
