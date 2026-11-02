# Entrepontos — funil de workshop (newsletter → inscrição → pagamento manual)

Plano de 2026-11-02. Classificação: **externo/sensível** (dados pessoais, CRM,
analytics, produção). Planning Review: **PENDENTE** (obrigatória antes de W1).
Relacionado: [STATUS-ENTREPONTOS-META.md](../STATUS-ENTREPONTOS-META.md),
BUG-002 em [BACKLOG.md](../../BACKLOG.md).

## Decisões do titular

- Produtos = os workshops: `ENTREPONTOS_MULHERES` e `ENTREPONTOS_KIDS`. Newsletter
  **não é produto**; assinar a newsletter é a entrada do funil do produto.
- **Uma lista por produto** (Brevo 2 = Mulheres, 4 = Kids), com segmentos
  diferentes conforme o contato avança, como na DECOLE
  (`*_FUNIL_STEPS`/`LAST_STEP`). Sem `intent`, sem produtos `_WORKSHOP`, sem
  rota separada de newsletter.
- Pixel por produto (já criado): Mulheres `1709529480821304`, Kids
  `1102408865735469`. GA4 diferencia pelo `produto`.
- **Sem Hotmart.** Pagamento por MB Way, Revolut ou IBAN, **confirmado à mão
  no Brevo** na fase 1 (revisto: o registo do pagamento passa para a plataforma, ver W2c).
- Site sem banner de consentimento (como o PE); a privacidade tem de refletir isso.

## Modelo de funil

| Etapa | Evento | Origem | Segmento Brevo (a criar) | Meta |
|---|---|---|---|---|
| Interessado | `GENERATE_LEAD` | formulário do site | Interessados | `Lead` |
| Confirmado | `SIGN_UP` | DOI via `links-redirect` | Confirmados | `CompleteRegistration` |
| Inscrição iniciada | `BEGIN_CHECKOUT` | rota de checkout → página de pagamento | Inscrição iniciada | `InitiateCheckout` |
| Inscrito | manual | Elizete confere o pagamento e move o contato | Inscritos | — (fase 1) |

O mesmo formulário é newsletter ou pré-checkout conforme o produto tenha, ou
não, rota `type: "checkout"` em `tenants.entrepontos.links.routes`
(`buildCheckoutRedirect`). Abrir um workshop = acrescentar a rota; fechar = tirar.

## Slices (cada um ≤ 1 dia; rollback = reverter o commit/config)

| ID | Objetivo | Aceite | Estado |
|---|---|---|---|
| W1 | BUG-002: `/funnel/precheckout` rejeita payload inválido | `product_code` obrigatório e ∈ produtos do tenant; email válido; `consent === true`; resposta 400 estável; nenhum `profile_id`/`identity_links` para rejeitados; testes cross-tenant | NOT_STARTED |
| W2a | Spike (só leitura): checkout para destino não-Hotmart | Confirmar em `links-redirect` se `checkoutBaseUrl` aceita uma página do site e **quem emite `BEGIN_CHECKOUT`** (hoje `source: site`); registar o resultado | NOT_STARTED |
| W2b | Catálogo | Eventos `BEGIN_CHECKOUT` nos dois produtos; `segments` (`managedVia: manual_dashboard`); rota `checkout` e `links.checkoutBaseUrl` só quando houver workshop aberto; `updatedAt`; testes de catálogo | NOT_STARTED |
| W2c | Plataforma: edição e pagamento | `activeEdition` no catálogo; `edition`/`payment_ref` no payload; endpoint admin + script idempotente que emite `PURCHASE_APPROVED`; testes | NOT_STARTED |
| W3 | Brevo (externo, aprovação do titular) | Segmentos e atributos de funil criados; template de email com instruções de pagamento; nada enviado a contactos reais sem aprovação | NOT_STARTED |
| W4 | Site | Página de instruções de pagamento por produto (MB Way/Revolut/IBAN, valor, referência); estado workshop aberto/fechado; textos dos formulários; privacidade reescrita (GTM e Pixel sem banner, como recusar) | NOT_STARTED |
| W5 | GTM Web + sGTM | Allowlists com `begin_checkout`; publicar workspaces 5 e 35 só com autorização; export em `trafego/gtm/`; smoke com Eventos de teste (`TEST57663`, `TEST36097`); contra-checagem independente | NOT_STARTED |

Ordem: W1 → W2a → W2b → W3 → W4 → W5. W4 não publica o site sem banner
antes de a privacidade estar reescrita.

## Em aberto

- Referência da inscrição: gerar no formulário (ex.: `lead_id` já reencaminhado
  pelo `links-redirect`) ou usar nome + email na transferência. Decide W2a/W4.
- Valor, moeda (EUR) e prazo para pagar antes de libertar a vaga; dados de
  pagamento (números e IBAN) fornecidos pela Elizete — **não inventar**.
- Estrutura igual para Mulheres e Kids (decidido). Dados de crianças: só
  quantidade e dados do adulto (privacidade atual).
- Fase 2 (fora de escopo): endpoint admin autenticado, idempotente por
  referência, a emitir `PURCHASE_APPROVED` e `Purchase` (EUR) à Meta.
- Contactos atuais nas listas 2 e 4 (2 e 1): origem não verificada.

## Registo de execução (append-only)

- 2026-11-02: plano criado após decisões acima; nenhuma alteração de código,
  catálogo, Brevo ou GTM.

## Campos customizados no Brevo — verificado 2026-11-02 (só leitura)

Conta Entrepontos, `GET /v3/contacts/attributes`:

- Existem os 6 atributos de funil que o catálogo espera: `EP_MULHERES_FUNIL_STEPS`,
  `..._LAST_STEP` (text) e `..._LAST_STEP_TIMESTAMP` (date); idem `EP_KIDS_*`.
  Catálogo e Brevo estão alinhados.
- Padrão do que o dispatcher grava (visto nos contatos das listas 2 e 4):
  `STEPS = "GENERATE_LEAD|SIGN_UP"` (etapas separadas por `|`),
  `LAST_STEP = "SIGN_UP"`, `LAST_STEP_TIMESTAMP` só com a data (sem hora).
- Atributos padrão úteis já existentes: `FIRSTNAME`, `LASTNAME`, `WHATSAPP`, `SMS`,
  `OPT_IN`, `LEAD_ID`. `WHATSAPP`/`SMS`/`LEAD_ID` estão vazios hoje (o formulário
  só envia nome, email e consentimento).
- Um contato da lista 2 (criado em 2026-10-09) não tem atributos de funil: é
  anterior ao fluxo automático. Origem não verificada.

Consequências para W3 (segmentos):

| Segmento | Condição sugerida |
|---|---|
| Interessados | `STEPS` contém `GENERATE_LEAD` e não contém `SIGN_UP` |
| Confirmados | `STEPS` contém `SIGN_UP` e não contém `BEGIN_CHECKOUT` |
| Inscrição iniciada | `STEPS` contém `BEGIN_CHECKOUT` e não contém `PURCHASE_APPROVED` |
| Inscritos | `STEPS` contém `PURCHASE_APPROVED` |

- **Correção (2026-11-02):** `STEPS` **não é editável à mão**. O dispatcher
  (`handlers/index.ts`, ~L1786-1817) reconstrói o valor a cada evento a partir de
  `funnel_events` (tipos de evento distintos do perfil, por ordem), então uma
  edição manual de `STEPS`/`LAST_STEP` é sobrescrita no evento seguinte. Como só
  guarda o **tipo** de evento, também não distingue encontros.
- **Decisão (2026-11-02): Brevo simples, estado do encontro na plataforma.** O
  Brevo fica só com: 1 lista por produto, os 3 atributos de funil já existentes
  e segmentos sobre `STEPS`. Nenhum atributo novo por produto ou por encontro.
- A **edição** e o **pagamento** vivem no event store (`funnel_events.payload_json`
  já existe; sem migração): `BEGIN_CHECKOUT` e `PURCHASE_APPROVED` levam
  `edition` (do catálogo, ex. `activeEdition: "2026-11-14"`) e `payment_ref`.
  "Pendente" = `BEGIN_CHECKOUT` sem `PURCHASE_APPROVED` da mesma edição.
- Marcar como pago = ação autenticada na plataforma (endpoint admin no
  `api-funnel-ingress` + script `scripts/entrepontos-mark-paid.sh <referência>`),
  idempotente pelo `event_id` derivado da referência. Emite `PURCHASE_APPROVED`
  pela cadeia existente (`upsert_event_store`, `update_brevo_funnel`; `emit_tracking`
  opcional via catálogo), então o Brevo recebe `STEPS` sozinho, sem edição manual.
- Listagem por encontro (quem está pendente/pago) sai de uma consulta ao D1
  (`json_extract(payload_json,'$.edition')`), script ou painel; emails por encontro
  saem pela plataforma (`send_template_email`), não por segmentos do Brevo.
- Limite aceite: o segmento Brevo "Inscritos" significa "já se inscreveu alguma
  vez" (o `STEPS` só tem tipos). O recorte por encontro é feito na plataforma.
- Nova fatia **W2c** (antes de W3): `activeEdition` no catálogo, `edition` e
  `payment_ref` no payload, endpoint/script de pagamento, testes (idempotência,
  tenant errado, referência inexistente). Substitui a "fase 1 manual no Brevo";
  `PURCHASE_APPROVED` para a Meta continua desligável por catálogo.
- `LAST_STEP_TIMESTAMP` é `date`, sem hora: não serve para ordenar eventos no mesmo dia.
- Para o formulário de inscrição pedir WhatsApp, o atributo `WHATSAPP` já existe;
  `api-funnel-ingress`/dispatcher teriam de o mapear (verificar em W2b).
- 2026-11-02: spike W2a (só leitura). `links-redirect` aceita qualquer
  `checkoutBaseUrl` (podia ser uma página do site) e é ele quem emite
  `BEGIN_CHECKOUT` (`source: site`). Mas `appendQueryParams` reencaminha todos
  os parâmetros, incluindo `email` e `name`, para o destino. Numa página do site
  isso põe PII no URL que o GTM e o Pixel veem. Proposta: o precheckout aceita
  `intent: "workshop"` e enfileira `BEGIN_CHECKOUT` no servidor (além do
  `GENERATE_LEAD`), sem `redirect_url`. Aguarda aprovação.

### Deploy ingress BUG-002 + BUG-003 — 2026-11-02 (autorizado pelo utilizador)

- `decole-api-funnel-ingress` versão `a5c926e2-5f12-4a1f-b18b-98b6625cf96d`
  (antes `37274a24-68ce-48a5-adbc-89e7e5249575`, de 2026-10-16). Rollback:
  `wrangler rollback 37274a24-68ce-48a5-adbc-89e7e5249575`.
- Código: HEAD `948de7a` + catálogo e rota `api.entrepontos.club` ainda não
  commitados (os mesmos que já estavam em produção desde 2026-10-16; um deploy de
  HEAD limpo removeria o tenant Entrepontos).
- Antes: ingress 72/72, tsc limpo, dry-run com bindings inalterados.
- Depois: preflight CORS em `/funnel/precheckout` — DECOLE, Product Engineer e
  Entrepontos válido 204, origem inválida 403. Nenhum POST para produção.

### W2a-1 Brevo — 2026-11-02 (autorizado pelo utilizador)

- Conta Brevo Entrepontos. Listas criadas: `entrepontos-workshop-mulheres` id **5**
  (pasta 1), `entrepontos-workshop-kids` id **6** (pasta 3). Todos os POST 201.
- Atributos normais: `EP_WS_MULHERES_FUNIL_STEPS`/`_LAST_STEP` (text),
  `_LAST_STEP_TIMESTAMP` (date); idem `EP_WS_KIDS_*`.
- Listas 2/4, contactos, templates e envios intocados. Rollback: DELETE das
  listas 5/6 e dos 6 atributos (vazios).

### Turnstile Entrepontos — 2026-11-02 (autorizado pelo utilizador)

- Token Cloudflare ganhou Turnstile Edit + Secrets Store Edit (feito pelo utilizador).
- Widget `entrepontos.club`, modo managed, domínios entrepontos.club e
  www.entrepontos.club. Sitekey (pública): `0x4AAAAAAFxO4_KBNede6TIW`.
- Secret guardado direto da API no Secrets Store `23bdc9c2e8ca470d82352c53ec8d2e67`
  como `turnstile_secret_key_entrepontos` (id 93c580a6bc99425baa2943c0621b5237),
  sem passar por terminal/repo.
- Ainda NÃO ligado ao ingress: o binding `TURNSTILE_SECRET_KEY_ENTREPONTOS` exige
  Turnstile em todo o tenant; só entra no deploy junto com o widget no site
  (newsletter + workshop), senão o formulário da newsletter quebra.

### Plano de lançamento coordenado (site + ingress + dispatcher) — 2026-11-02, por aprovar

Estado de partida: Pages `entrepontos` em produção = f2f0e070 (commit 4a8e70d, com banner);
ingress a5c926e2; dispatcher 5aced385. Site local `main` 4a323e1 (sem push).

0. Pré-voo (sem efeitos): testes funil (ingress, dispatcher, shared) e site; dry-run
   ingress e dispatcher; confirmar se o Pages é Git-connected (push de main publica).
1. Site: `wrangler pages deploy site --project-name entrepontos --branch main` (ou push,
   se Git-connected). Muda também a medição: sem banner, GTM sempre (decisão 919a465).
   Verificar GET /, /kids/, /privacidade/, /funnel.js 200 e widget a renderizar.
   Newsletter continua a funcionar: o ingress ainda não exige token e ignora o campo.
2. Ingress: binding `TURNSTILE_SECRET_KEY_ENTREPONTOS` (secrets_store_secrets,
   secret_name turnstile_secret_key_entrepontos) + catálogo com os produtos de workshop.
   Deploy logo após 1 (cache do browser: funnel.js antigo sem token passa a receber 400).
3. Dispatcher: deploy com directListIds + catálogo (mesmo catálogo do passo 2).
4. Smokes sem POST de teste: OPTIONS 204/403 nos 3 tenants. Teste real só com
   autorização: 1 newsletter (alias da caixa principal) para validar Turnstile+DOI.
   Inscrição de workshop fica sem teste real até haver edições (editions.json = []).
5. Commits/push: catálogo + linha do ingress na matriz CI + planos (W5); push de
   funil-mkt-platform main e entrepontos main só com autorização.

Rollback: Pages → f2f0e070; ingress → a5c926e2; dispatcher → 5aced385
(`wrangler rollback <id>`). Se só o Turnstile falhar: rollback do ingress (sem binding,
volta a aceitar sem token) e manter site.

### Lançamento executado — 2026-11-02 (autorizado: "Continuar aqui")

- Pré-voo: funil 634 passados (falha só no baseline setup-brevo-domain), site 11/11,
  dry-runs com TURNSTILE_SECRET_KEY_ENTREPONTOS no ingress.
- Site: push entrepontos main 4a8e70d..4a323e1 (Pages ligado ao GitHub) → Pages
  fbb81b91-6c33-4694-ac20-dbce25c50344 (antes f2f0e070). Sem banner; GTM sempre.
- Ingress fdda001c-728d-4bdf-b67c-5654669d3449 (antes a5c926e2) com binding Turnstile
  Entrepontos + catálogo dos produtos de workshop.
- Dispatcher 7f936cc9-18ca-4b6a-bbfb-d5da21340863 (antes 5aced385) com directListIds.
- Smokes: OPTIONS 204/403 nos 3 tenants; GET /, /kids/, /privacidade/, /funnel.js,
  /editions.json 200; funnel.js publicado com Turnstile; widget renderiza em
  entrepontos.club (browser automatizado recebe "Verify you are human", não resolvido).
- Nenhum POST de teste. Falta: 1 envio real de newsletter feito pelo utilizador para
  validar Turnstile + DOI; commit/push do catálogo, wrangler.toml, CI e planos (W5).
