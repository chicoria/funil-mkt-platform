# GA4-PRODUTO — Garantir dimensao `produto` em eventos web

## Objetivo

Garantir que os eventos web usados pelo funil e dashboard cheguem ao GA4 com a dimensao customizada de evento `produto` preenchida de forma explicita.

## Diagnostico

- `cta_click` ja chega com `produto` via tag GA4 especifica no GTM Web.
- `gtm.dom` chega com `produto` porque existe uma tag GA4 Event generica disparada em DOM Ready/Custom Event.
- O `page_view` automatico da Google Tag / GA4 Config esta sem `produto`, entao o GA4 recebe `page_view` sem `ep.produto`.
- Ainda existe tag antiga de `button_click` no GTM Web live, apesar do catalogo e landing pages estarem a convergir para `cta_click`.

## Decisao tecnica

Usar `page_view` explicito com `produto = {{DL - produto}}` e desligar o `page_view` automatico da Google Tag para evitar duplicidade.

Eventos web canonicos para dashboard:

- `page_view`
- `cta_click`

`button_click` fica descontinuado.

## Tickets

| Ticket | Escopo | Estado |
|---|---|---|
| [001](001-gtm-page-view-produto.md) | Corrigir `page_view` no GTM Web | Publicado |
| [002](002-remover-button-click-legado.md) | Remover/migrar `button_click` legado | Publicado |
| [003](003-alinhar-repo-catalogo-dashboard.md) | Alinhar catalogo, docs, diagramas e dashboard | Validado localmente |
| [004](004-validacao-ga4-produto.md) | Validar Tag Assistant, network, GA4 e Data API | Parcialmente validado |

## Gate geral de aceite

- Cada carregamento de landing page envia exatamente um `page_view` util ao GA4.
- `page_view` carrega `ep.produto`.
- `cta_click` carrega `ep.produto`.
- Nao ha novo envio de `button_click`.
- O dashboard-sync consulta apenas `page_view` e `cta_click`.
- Nenhum segredo foi registrado em arquivos versionados.

## Execucao GTM

- Data: 2026-05-10
- Container Web: `GTM-58CQ9K7X`
- Workspace editavel usado: `22` (`Default Workspace`)
- Versao publicada: `18` — `GA4 produto page_view explicito`
- Estado: publicado.
- Observacao: o workspace `21` configurado no `.env.local` estava submetido e nao aceitava edicao via API.

## Correcao de container externo

Tambem foi identificado que o stream GA4 `G-22ZR1Q37JD` pertence ao container `GTM-KLVRLSWN` (`elizetefazza.com`) e estava sendo carregado em `decolesuacarreiraesg.com.br` via script first-party `/syvi/`.

- Container: `GTM-KLVRLSWN`
- Versao publicada: `14` — `Restrict Elizete GTM to own hostname`
- Fix: tags ativas do container Elizete restritas a `elizetefazza.com` e `www.elizetefazza.com`.
- Resultado: DECOLE deixou de enviar hits para `G-22ZR1Q37JD`; `elizetefazza.com` continua enviando `page_view` para esse stream.

## Correcao `sign_up` Plano de Voo

O `sign_up` da pagina `site/planodevoo/confirmacao.html` ja existia no `dataLayer`, mas nao chegava ao GA4 porque a tag GA4 generica exclui paths `/planodevoo`.

- Container Web: `GTM-58CQ9K7X`
- Versao publicada: `19` — `GA4 sign_up PlanoVoo`
- Tag criada: `69` — `GA4 - Sign Up - PlanoVoo`
- Trigger criado: `68` — `Sign Up - PlanoVoo`
- Resultado: `/planodevoo/confirmacao.html` envia `sign_up` com `produto=DECOLE_PLANOVOO`.
