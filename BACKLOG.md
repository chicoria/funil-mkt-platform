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
