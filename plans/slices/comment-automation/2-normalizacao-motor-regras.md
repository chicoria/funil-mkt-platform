# Slice 2 — Normalização + motor de regras (TDD, puro, sem rede)

Status: DONE

## Objetivo e problema

Antes de qualquer worker, precisamos de 3 módulos puros (sem I/O) que: (a)
definem o formato de evento de comentário normalizado, (b) traduzem o
payload bruto do webhook da Meta (Facebook `object:"page"` / Instagram
`object:"instagram"`) pra esse formato, e (c) casam o texto do comentário
contra as regras de `commentAutomation.rules[]` do catalog (Slice 1).

## Escopo dentro

- `packages/shared/src/social-comment-event.ts` — tipo `SocialPlatform`
  (`"facebook"|"instagram"`), interface `SocialCommentEvent` (irmã de
  `FunnelEvent` em `funnel-event.ts`, não subtipo: `event_id`,
  `event_type: "SOCIAL_COMMENT_RECEIVED"`, `tenant_id`, `product_code`,
  `platform`, `comment_id`, `post_id?`, `text`, `from_id`,
  `from_username?`, `account_id` — page_id ou ig_business_account_id —,
  `occurred_at`, `payload`), `isSocialCommentEvent()` mirror de
  `isFunnelEvent()`.
- `packages/shared/src/meta-webhook-normalizer.ts` —
  `fromMetaWebhookPayload(payload, resolveProductCode)`, onde
  `resolveProductCode: (platform, accountId) => {tenantId, productCode} | undefined`
  é injetado (não lê catalog direto — testável sem fixture de catalog
  inteiro). Internamente: `object:"page"` → percorre `entry[].changes[]`
  filtrando `value.item === "comment" && value.verb !== "remove"`;
  `object:"instagram"` → percorre `entry[].changes[]` filtrando
  `field === "comments"`. Cada `entry[].id` é o `account_id` (page_id ou
  ig_business_account_id) usado pra resolver tenant/produto via
  `resolveProductCode`; se não resolver, aquele comentário é descartado
  (não lança erro — outros comentários do mesmo payload continuam sendo
  processados). ⚠️ Os nomes exatos de campo (`comment_id` vs `id`,
  `message` vs `text`, shape de `from`) devem ser confirmados contra a doc
  atual da Graph API durante a implementação — já mudaram entre versões;
  implementar com base no shape mais recente conhecido e documentar a
  fonte/data da verificação no código.
- `packages/shared/src/comment-automation.ts` —
  `matchCommentRule(comment, rules)`: primeiro-casa-vence, filtra por
  `platforms.includes(comment.platform)`, depois por `matchType`
  (`"exact"` = trim+igual, `"contains"` = substring), respeitando
  `caseSensitive` (default `false`, sem accent-folding — "tradução" ≠
  "traducao" por padrão, decisão deliberada pra evitar falso positivo
  silencioso); `resolveCommentAutomationRules(catalog, tenantId, productCode)`
  lê `tenants[tenantId].products[productCode].commentAutomation.rules`;
  `resolveProductCodeForSocialAccount(catalog, platform, accountId)` lê
  `tenants.*.socialAccounts.facebookPages`/`instagramBusinessAccounts`
  (varre todos os tenants — só existe `decole` hoje, mas a função não deve
  assumir isso) e retorna `{tenantId, productCode}` ou `undefined`. Mirror
  de `tryResolveTenantIdFromHostname`/`resolveTenantIdFromHostname` em
  `tenant-from-hostname.ts` (mesmo padrão `tryX`/`X com fallback`, mas
  aqui sem fallback sensato — `undefined` é o caminho correto quando não
  resolve). **Tipo de catalog: `CommentAutomationCatalog` próprio e
  estreito** (mirror exato de `TenantHostnameCatalog`: `{ tenants?:
  Record<string, { socialAccounts?: {...}, products?: Record<string,
  { commentAutomation?: {...} }> }> }`), não estende `CatalogV5Tenant` de
  `catalog-v5.ts` (que ainda não declara esses campos) — decisão fixada
  agora pra não ficar aberta durante o TDD (achado do Planning Review).

**Gap conhecido (não bloqueia este slice):** `config/README.md` ainda não
documenta os campos `socialAccounts`/`commentAutomation.rules` adicionados
no catalog pelo Slice 1 — dívida do Slice 1, registrada aqui pra não ficar
escondida como suposição.

## Escopo fora

- Nenhum `fetch`/rede — zero I/O nos 3 arquivos.
- Nenhum worker (`api-social-ingress`/`social-dispatcher`) — isso é Slice 4/5.
- Nenhuma verificação de assinatura HMAC (isso é Slice 4, no ingress).

## TDD — testes escritos ANTES da implementação (Red → Green)

- `packages/shared/test/unit/social-comment-event.test.ts`:
  `isSocialCommentEvent` aceita objeto válido, rejeita campos faltando,
  rejeita `platform` fora de `facebook|instagram`, rejeita não-objeto.
- `packages/shared/test/unit/meta-webhook-normalizer.test.ts`: payload
  Facebook 1 entry/1 change → 1 evento; Facebook multi-entry → N eventos;
  Instagram 1 entry/1 change → 1 evento; `resolveProductCode` retorna
  `undefined` pra 1 account_id → aquele comentário descartado, outros do
  mesmo payload continuam; `field`/`item` não-comentário (ex.: `verb:"remove"`
  ou outro `field`) → filtrado, não gera evento; `object` desconhecido →
  array vazio; payload malformado (sem `entry`, `entry` não-array) → array
  vazio, não lança exceção.
- `packages/shared/test/unit/comment-automation.test.ts`:
  `matchCommentRule` — exact vs contains; case sensitivity on/off; acento
  não casa por padrão (`"traducao"` não casa regra `"tradução"`); filtro
  por `platforms`; sem match → `null`; 2+ regras, primeira que casa vence;
  array de regras vazio → `null`. `resolveCommentAutomationRules` — produto
  existente com regras, produto sem `commentAutomation` → `[]`, tenant
  inexistente → `[]`. `resolveProductCodeForSocialAccount` — facebook
  resolve, instagram resolve, account_id desconhecido → `undefined`,
  catalog sem `socialAccounts` → `undefined` (não lança).
- **Simetria de trim/case no matching (achado do Planning Review):** caso
  de teste explícito com `rule.keyword` tendo espaço ao redor no catalog
  (ex.: `" tradução "`) e `comment.text` sem espaço equivalente, confirmando
  que trim é aplicado nos dois lados antes da comparação tanto em `exact`
  quanto em `contains`.

## Critério de aceite

`npx vitest run packages/shared` 100% verde (incluindo os 3 arquivos de
teste novos), zero chamada de rede, zero `any`/`!` sem justificativa nos 3
arquivos novos.

## Rollback

Arquivos novos, sem dependentes ainda (Slice 1 não os referencia) —
apagar os 6 arquivos (3 src + 3 test).

## Execução (append-only)

- **2026-06-22:** Planning Review (agente separado) → APROVADO COM AJUSTES.
  Ajustes incorporados: tipo `CommentAutomationCatalog` próprio e estreito
  (não estende `CatalogV5Tenant`); gap de `config/README.md` registrado
  como dívida do Slice 1; caso de teste de simetria de trim/case
  adicionado.
- **2026-06-22:** TDD Red→Green — 6 arquivos criados (3 src + 3 test):
  `social-comment-event.ts`, `comment-automation.ts`,
  `meta-webhook-normalizer.ts`. Testes escritos e confirmados falhando
  (módulo inexistente) antes de cada implementação.
- **2026-06-22:** `npx vitest run packages/shared/test/unit/social-comment-event.test.ts packages/shared/test/unit/comment-automation.test.ts packages/shared/test/unit/meta-webhook-normalizer.test.ts` → 3 arquivos, 33 testes, todos verdes.
- **2026-06-22:** `npx vitest run packages/shared` (suíte completa) → 9 arquivos, 113 testes, todos verdes — sem regressão nos módulos existentes.

## Revisão (Planning Review / Code Quality Review / Slice Validator)

**Code Quality Review: APROVADO** (agente independente, rodou
`npx vitest run packages/shared` ele mesmo: 9 arquivos, 113 testes, 100%
verde). Zero MUST-FIX. Zero SHOULD-FIX novo (gap de `config/README.md`
permanece registrado como dívida do Slice 1). NICE-TO-HAVE: `ProductResolution`
duplicado entre `comment-automation.ts`/`meta-webhook-normalizer.ts` (mesmo
shape) — não bloqueia, candidato a consolidação futura.

**Slice Validator: DONE** — todos os 9 itens do TDD test list mapeados a
teste real (não prosa); tipagem `CommentAutomationCatalog` confirmada como
própria/estreita (não estende `catalog-v5.ts`); cross-check contra
`config/products.catalog.json` real confirma compatibilidade total com o
que o Slice 1 entregou; diff aditivo, sem arquivos fora do escopo, sem
erros de whitespace.
