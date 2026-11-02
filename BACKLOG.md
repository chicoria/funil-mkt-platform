# Backlog — FunilMKT Platform

Pendências e bugs técnicos deste repo (backend compartilhado Cloudflare —
workers, filas, D1, KV, catálogo). Escopo é o **código**, não um tenant ou
produto específico — bugs que afetam um tenant/produto de forma pontual
(conteúdo, copy, campanha) continuam no backlog do respectivo tenant em
`mkt-brain` (`knowledge-core/tenants/{tenant}/backlog.md`).

---

## BUG-001 — Checkout redirect não repassava nome/telefone pro Hotmart

- **Status:** resolvido
- **Data:** 2026-07-13
- **Componente:** `workers/api-funnel-ingress/src/index.ts` (`CHECKOUT_FORWARD_PARAMS`)
- **Produtos afetados:** DECOLE_PLANOVOO, DECOLE_ESG_MENTORIA (allowlist é
  catalog-driven por `productCode`, mesmo bug nos dois)
- **Relatado por:** usuário, ao testar manualmente o fluxo de pré-checkout
  até o Hotmart pros dois produtos e notar que o formulário do Hotmart não
  vinha mais pré-preenchido com nome/telefone (só e-mail) — "já esteve a
  funcionar com parâmetros até a mais do que o esperado".

### Causa raiz

O redirect de checkout não é direto pro Hotmart — passa por
`api-funnel-ingress` (`/funnel/precheckout`) → `links-redirect` → Hotmart.
`CHECKOUT_FORWARD_PARAMS` (a allowlist de query params repassados do
formulário pro `links-redirect`) só incluía `email` + parâmetros de
atribuição (UTMs, fbp/fbc/fbclid, gclid/wbraid/gbraid, anonymous_id,
session_id, lead_id) — `name`, `phoneac` e `phonenumber` nunca foram
adicionados a essa lista desde a migração pro redirect catalog-driven via
`links-redirect` (commit `200ff17`, `feat(precheckout-redirect): 302
catalog-driven redirect após precheckout`).

Confirmado por investigação direta no código: `links-redirect`
(`workers/links-redirect/src/index.ts`, função `appendQueryParams`) **não**
tem allowlist própria — ele repassa adiante qualquer query param que
recebe. O corte acontecia inteiramente no `api-funnel-ingress`, antes dos
parâmetros chegarem no `links-redirect`.

### Fix aplicado

Commit `c495018` — `fix(precheckout-redirect): repassar
name/phoneac/phonenumber pro checkout redirect`. Adicionados os 3 campos
faltantes a `CHECKOUT_FORWARD_PARAMS`.

- Typecheck limpo (`tsc --noEmit`).
- 24/24 testes existentes passando (nenhum cobria esse array
  especificamente antes do fix — considerar um teste dedicado pra
  `CHECKOUT_FORWARD_PARAMS` como follow-up, pra não regredir de novo em
  silêncio).
- Deploy publicado no mesmo dia: `decole-api-funnel-ingress`, Version ID
  `1d774ab7-8851-4fff-a8f5-7efb2ed33287`.

### Follow-up sugerido (não feito ainda)

- Adicionar teste unitário cobrindo o conteúdo de `CHECKOUT_FORWARD_PARAMS`
  (ou um teste de integração que valida os campos no `redirect_url` final),
  pra pegar uma futura remoção acidental antes de produção.
- Confirmação end-to-end pendente: usuário testou o fluxo de pré-checkout
  pros dois produtos em 2026-07-13T11:14:23Z (antes do fix) — vale repetir
  o teste pós-deploy pra confirmar visualmente que o Hotmart chega
  pré-preenchido agora.

---

## BUG-003 — corpo público escolhe o tipo de evento em `/funnel/precheckout` e `/funnel/event`

- **Status:** corrigido em `948de7a` e implantado em 2026-11-02 (ingress `a5c926e2-5f12-4a1f-b18b-98b6625cf96d`, antes `37274a24-68ce-48a5-adbc-89e7e5249575`). Smokes CORS 204/403 nos 3 tenants; sem POST de teste.
- **Componente:** `packages/shared/src/event-normalizer.ts` (`fromPrecheckoutForm`,
  `fromBrowserTracking` leem `event_type`/`event`/`type` do corpo);
  `workers/api-funnel-ingress/src/index.ts` (handlers).
- **Tenants afetados:** todos.
- **Descoberto por:** investigação do fluxo do Plano de Voo (W2a Entrepontos), 2026-11-02.

### Sintoma

Um POST público podia enfileirar qualquer tipo de evento (ex.: `PURCHASE_APPROVED`,
também como `purchase-approved`), e o dispatcher corria a cadeia desse tipo no
catálogo. `isOriginAllowed` aceita pedidos sem `Origin`, e só tenants com Turnstile
server-side têm barreira adicional no precheckout. `/funnel/event` também aceitava
produtos de outro tenant.

### Correção

- `/funnel/precheckout`: só `GENERATE_LEAD`; outro tipo normalizado → 400 `invalid_event_type`.
- `/funnel/event`: allowlist `PAGE_VIEW`, `ENGAGEMENT_SNAPSHOT`; produto fora do tenant →
  400 `unknown_product`. `GENERATE_LEAD` só entra pelo precheckout (o `scripts/e2e-prod.sh`
  passou a usar `/funnel/precheckout`).
- `parseBody` lê JSON em `text/plain`: o beacon `ENGAGEMENT_SNAPSHOT` da DECOLE
  (`navigator.sendBeacon` com string) chegava como `{}` e virava `PAGE_VIEW/UNKNOWN_PRODUCT`.
- Testes: `workers/api-funnel-ingress/test/unit/event-type-validation.test.ts`.
- Revisão independente (sessão Claude, 2026-11-02) no lugar do Codex (sem quota).

### Follow-up

- Acrescentar `workers/api-funnel-ingress` à matriz de unitários do `ci-multitenant-gates`
  **no mesmo push do catálogo Entrepontos** — `entrepontos-precheckout.test.ts` (já commitado)
  falha sem o tenant no catálogo.
- Ingress enfileira o código canónico do produto: alias com espaço (`"plano voo"` → `PLANO_VOO`)
  passa no ingress e não casa no dispatcher (`funnel-dispatcher/src/catalog-adapter.ts:76`).
- Corpo público pode trazer `__handler_results`, lido pelo dispatcher (`dispatcher.ts:56,86`);
  `event_id` vem do cliente e a chave de dedupe não inclui o tipo (`dispatcher.ts:91-95`).
- Avaliar exigir `Origin` (ou Turnstile) nos endpoints públicos de todos os tenants.
- Conferir no D1 se houve eventos de compra com `source = site` antes do deploy.

---

## BUG-002 — `/funnel/precheckout` aceita payload vazio/inválido e grava evento + perfil

- **Status:** corrigido em `78a9af3` e implantado em 2026-11-02 com BUG-003 (ingress `a5c926e2-5f12-4a1f-b18b-98b6625cf96d`).
  O precheckout recusa `unknown_product` e `invalid_email`; e-mail ausente continua aceite
  (redirect de checkout sem e-mail).
- **Data:** 2026-11-02
- **Componente:** `workers/api-funnel-ingress/src/index.ts` (handler de
  `/funnel/precheckout`); validação a jusante em `workers/funnel-dispatcher`
- **Tenants afetados:** todos (o handler é genérico); visto no `entrepontos`
- **Descoberto por:** teste manual em produção em 2026-11-02, ao verificar se o
  Entrepontos já tinha formulário de pré-checkout.

### Sintoma

`POST https://api.entrepontos.club/funnel/precheckout` com `Origin` permitido e
corpo `{}` ou `{"EMAIL":"x"}` devolve `202 {"ok":true,"event_id":…,
"event_type":"GENERATE_LEAD"}`. O evento foi persistido em `funnel_events`
(`product_code = UNKNOWN_PRODUCT`) e criou um `profile_id` novo com linhas em
`identity_links` (uma delas com `email_hash` do valor `x`). Os 2 eventos de teste
e as 3 ligações de identidade foram apagados à mão em 2026-11-02 (contagens
antes/depois confirmadas); o endpoint continua com o mesmo comportamento.

### Causa provável

Depois de `resolveTenantId` e `isOriginAllowed`, o handler não valida o corpo
(email com formato válido, `product_code` presente e pertencente ao tenant,
consentimento) antes de enfileirar em `FUNNEL_EVENTS`. A única barreira
adicional é o Turnstile, e só nos tenants que têm o secret configurado. O
Entrepontos não tem.

### Impacto

- Qualquer origem permitida (ou script que forje o header `Origin`) gera eventos
  `GENERATE_LEAD` e perfis de lixo.
- Infla `funnel_events`, o dashboard e, quando houver Pixel/CAPI, as conversões
  de Lead enviadas à Meta e ao GA4.
- Risco de contato inválido ou de conta alheia no Brevo (DOI) se o dispatcher
  não rejeitar.

### Correção sugerida

- Validar no `api-funnel-ingress`, antes de enfileirar: `email` (formato e
  tamanho), `product_code` ∈ produtos do tenant no catálogo, `consent === true`
  quando o produto exigir DOI. Responder `400` com erro estável
  (`invalid_email`, `invalid_product`, `consent_required`).
- Não gerar `profile_id` nem `identity_links` para payload rejeitado.
- Testes: corpo vazio, email inválido, produto desconhecido, produto de outro
  tenant, e o caminho feliz para cada tenant do catálogo (cross-tenant).
- Avaliar rate limit por IP e ativar Turnstile no Entrepontos.
- Antes de ativar o Pixel do Entrepontos (`plans/STATUS-ENTREPONTOS-META.md`,
  M3), resolver ou aceitar o risco: sem isto os Leads enviados à Meta podem ser
  falsos.
