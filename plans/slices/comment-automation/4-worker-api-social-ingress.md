# Slice 4 — Worker `api-social-ingress` (TDD)

Status: DONE

## Objetivo e problema

Primeiro worker do motor: recebe os webhooks da Meta (Facebook + Instagram,
mesmo endpoint), faz o handshake de verificação (`GET`), valida a assinatura
HMAC do corpo (`POST`), normaliza via `fromMetaWebhookPayload` (Slice 2) e
enfileira em `decole-q-social-events`. Mirror estrutural de
`workers/api-hotmart-ingress/` — mesma forma de arquivo
(`package.json`/`tsconfig.json`/`vitest.config.js`/`wrangler.toml`/`src/index.ts`/
`test/unit/index.test.ts`), mesma convenção de resolução de tenant por
hostname, mesma convenção de log (`logIngress` com `worker: "api-social-ingress"`).

## Decisões de design (antes da implementação)

- **Rota única:** `/webhooks/v1/meta`, mesma para `GET` (handshake) e `POST`
  (eventos), em vez do padrão `/webhooks/v1/{slug}/hotmart/{operation}` do
  Hotmart — não faz sentido aqui porque 1 App Meta cobre N páginas/contas IG
  já mapeadas pra produto via `socialAccounts` no catalog (resolvido a
  partir do `account_id` do payload, não da URL).
- **Tenant resolvido por hostname** (`tryResolveTenantIdFromHostname`, igual
  Hotmart) — cada tenant futuro teria seu próprio Meta App registrado sob o
  próprio domínio (`api.{dominio-do-tenant}/webhooks/v1/meta`). Não há tenant
  no payload do handshake `GET` (Meta só envia `hub.mode`/`hub.verify_token`/
  `hub.challenge`) nem garantia de que o `POST` traga um identificador de
  tenant fora do `entry[].id` (account_id) — daí a necessidade do hostname.
- **Falha de verificação (`GET`) não distingue "tenant desconhecido" de
  "token errado"** — os dois retornam `403` genérico, decisão deliberada
  pra não vazar a existência de hostnames/tenants via enumeração.
- **Catalog tipado como `CatalogV5`** para a resolução de hostname (igual
  Hotmart). Dois casts pontuais distintos, cada um para um propósito
  diferente (achado do Planning Review: a primeira versão deste slice file
  descrevia os dois como se fossem o mesmo padrão — clarificado agora):
  1. **Leitura de `credentials`** (`meta_app_secret_env`/
     `meta_webhook_verify_token_env`): cast local `as TenantWithSocialCredentials`
     (interface estreita declarada no próprio `index.ts`, mirror exato de
     `TenantWithCredentials` do Hotmart, `:21-23`).
  2. **Resolução de produto por conta social**: cast
     `catalog as unknown as CommentAutomationCatalog` (tipo importado do
     Slice 2), só na chamada de `resolveProductCodeForSocialAccount`. O
     `as unknown as` é obrigatório aqui (não opcional) porque
     `CatalogV5Tenant` tem index signature `[key: string]: unknown` —
     `socialAccounts`/`commentAutomation` caem em `unknown`, e um cast
     direto `CatalogV5 as CommentAutomationCatalog` falha a checagem
     estrutural do TS em `products` (confirmado pelo Planning Review).
- **Secrets resolvidos via `resolveSecret()`/`SecretValue`** (não leitura
  direta de `env[nome]`) — MUST-FIX do Planning Review. Idêntico ao padrão
  `resolveTenantHotmartToken` do Hotmart: `getCatalog(env)` (fallback
  `CATALOG_JSON` → `bundledCatalog`) + `resolveSecret(env[envName] as
  SecretValue, envName)` para os dois secrets (`meta_webhook_verify_token_env`
  no `GET`, `meta_app_secret_env` no `POST`). Sem isso, o binding via
  Cloudflare Secrets Store do Slice 6 (`{ get(): Promise<string|null> }`)
  não funcionaria — só string legada funcionaria.
- **Content-type do `POST` é deliberadamente ignorado** — o worker lê
  `request.text()` bruto (necessário para o HMAC) e nunca valida o header
  `content-type`; não há checagem de "content-type errado" porque o fluxo
  não depende dele (diferente do Hotmart, que usa `request.json()`).
- **`GET` com `hub.challenge` ausente mas `hub.mode`/`hub.verify_token`
  corretos**: decisão (SHOULD-FIX do Planning Review) — responde `200` com
  corpo vazio (`""`), mesma lógica de "sucesso de verificação" independente
  do challenge estar populado; não é tratado como erro porque mode+token
  já provam que é a Meta verificando.
- **Corpo lido como texto (`request.text()`) antes de qualquer `JSON.parse`**
  — a assinatura HMAC da Meta é sobre os bytes brutos do corpo; parsear
  primeiro e reserializar depois poderia mudar espaçamento/ordem de chaves
  e invalidar a verificação silenciosamente.
- **Verificação de assinatura por igualdade de string simples** (`===` entre
  hex computado e hex recebido, ambos lowercased), não comparação
  constant-time — consistente com o padrão já usado pelo repo pra comparar
  o token do Hotmart (`isAuthorized`, em `api-hotmart-ingress/src/index.ts`).
  Risco teórico de timing attack existe nos dois casos; não introduzido
  agora, apenas mantido consistente. **Resolvido pelo Planning Review:
  aceitável para v1, NÃO é MUST-FIX** — risco marginal (atacante já
  precisaria do App Secret pra gerar assinatura válida; comparação de
  string de 64 hex chars sem oráculo de repetição de alta precisão).
  **Follow-up explícito registrado** (não escondido): migrar `isAuthorized`
  (Hotmart) + esta verificação HMAC pra comparação constant-time num slice
  transversal de hardening futuro — fora do escopo desta entrega.
- **Enfileiramento item-a-item** (`for (const event of events) await env.SOCIAL_EVENTS.send(event)`),
  não `sendBatch` — mirror do padrão de 1 chamada `send()` por evento já
  usado em `api-hotmart-ingress`; aceitável pro volume esperado de
  comentários (não é alto volume tipo pageview). Revisitar se virar gargalo.
- **Sempre 200 após assinatura válida**, mesmo com 0 eventos extraídos
  (filtro de "não é comentário" ou "account_id não resolvido" acontece
  dentro do normalizer, não é erro) — conforme decisão já registrada no
  plano-mestre. `401` é reservado exclusivamente pra falha de assinatura.
- **`wrangler.toml` criado nesta entrega mas não deployado** — referencia
  `decole-q-social-events` (fila) e os bindings de Secrets Store
  `META_APP_SECRET_DECOLE`/`META_WEBHOOK_VERIFY_TOKEN_DECOLE`, nenhum dos
  quais existe ainda na Cloudflare (isso é Slice 6). `wrangler deploy`
  falharia se rodado antes do Slice 6 — esperado, não é um bug.

## Escopo dentro

- `workers/api-social-ingress/src/index.ts`:
  - `GET /webhooks/v1/meta`: handshake — lê `hub.mode`/`hub.verify_token`/
    `hub.challenge` da query string, resolve tenant por hostname, resolve
    `credentials.meta_webhook_verify_token_env` do tenant, compara; sucesso
    → `200` com `hub.challenge` cru como corpo (`content-type: text/plain`);
    falha (tenant desconhecido OU `hub.mode !== "subscribe"` OU token
    incorreto) → `403`; secret mal configurado no catalog → `500`.
  - `POST /webhooks/v1/meta`: resolve tenant por hostname (`400
    unknown_tenant` se não resolver); resolve
    `credentials.meta_app_secret_env` (`500 secret_misconfigured` se
    ausente); lê corpo como texto; verifica `X-Hub-Signature-256`
    (`401 invalid_signature` se ausente/inválida); verifica
    `env.SOCIAL_EVENTS` configurado (`500 queue_not_configured`); faz
    `JSON.parse` do texto (corpo malformado → `payload = null`, tratado
    como 0 eventos, não como erro); chama `fromMetaWebhookPayload(payload,
    resolveProductCode)`; enfileira cada evento; responde `200` com
    `{ ok: true, enqueued: N }` (N pode ser 0).
  - `GET /health` → `200` (mirror Hotmart).
  - Método não suportado na rota `/webhooks/v1/meta` → `405`. Rota
    desconhecida → `404`.
- `workers/api-social-ingress/test/unit/index.test.ts` (TDD, escrito antes).
- `workers/api-social-ingress/{package.json,tsconfig.json,vitest.config.js,wrangler.toml}`
  — cópias adaptadas dos equivalentes em `api-hotmart-ingress` (nome do
  worker, binding da fila, secrets referenciados).
- `workers/api-social-ingress/test/integration/.gitkeep` (mirror Hotmart).

## Escopo fora

- Nenhuma lógica de match de regra/envio de resposta — isso é Slice 5
  (`social-dispatcher`), que consome a fila.
- Nenhuma infraestrutura real criada (fila, Secrets Store) — isso é Slice 6.
  Este slice só cria o **código** e o **manifesto declarativo**
  (`wrangler.toml`), não os recursos Cloudflare que ele referencia.
- Nenhum `wrangler deploy`.

## TDD — testes escritos ANTES da implementação

`workers/api-social-ingress/test/unit/index.test.ts`:

1. `GET /health` → `200`.
2. Handshake correto (`hub.mode=subscribe` + `hub.verify_token` certo) →
   `200`, corpo = exatamente o `hub.challenge` enviado.
3. Handshake com `hub.verify_token` errado → `403`.
4. Handshake com `hub.mode` ausente/diferente de `subscribe` → `403`.
5. Handshake em hostname não cadastrado (tenant não resolve) → `403`.
6. Handshake com `meta_webhook_verify_token_env` ausente no catalog do
   tenant → `500 secret_misconfigured`.
7. `POST` com assinatura válida, payload Facebook (1 entry, 1 change de
   comentário) → `200`, `enqueued: 1`, `send` chamado 1x com
   `SocialCommentEvent` no shape esperado (`platform: "facebook"`).
8. `POST` com assinatura válida, payload Instagram (1 entry, 1 change) →
   `200`, `enqueued: 1`, `platform: "instagram"`.
9. `POST` multi-entrada (2 comentários no mesmo payload, contas diferentes
   ambas mapeadas) → `200`, `enqueued: 2`, `send` chamado 2x.
10. `POST` sem header `X-Hub-Signature-256` → `401 invalid_signature`,
    `send` não chamado.
11. `POST` com assinatura calculada com secret errado → `401
    invalid_signature`, `send` não chamado.
12. `POST` em hostname não cadastrado → `400 unknown_tenant`, `send` não
    chamado (sem nem tentar verificar assinatura — não há secret pra
    resolver).
13. `POST` com `meta_app_secret_env` ausente no catalog do tenant → `500
    secret_misconfigured`.
14. `POST` com assinatura válida mas `env.SOCIAL_EVENTS` ausente → `500
    queue_not_configured`.
15. `POST` com assinatura válida, payload com `change.value.verb ===
    "remove"` (não é um comentário novo) → `200`, `enqueued: 0`, `send`
    não chamado — confirma que o filtro do normalizer (Slice 2) também
    funciona end-to-end pelo worker, não só isolado.
16. `POST` com assinatura válida, `account_id` desconhecido (sem entrada em
    `socialAccounts`) → `200`, `enqueued: 0`, `send` não chamado.
17. Método não suportado (`PUT`) em `/webhooks/v1/meta` → `405`.
18. Rota desconhecida (`/webhooks/v1/outra-coisa`) → `404`.
19. `POST` com header `X-Hub-Signature-256` presente mas malformado (sem
    prefixo `sha256=`, ou prefixo presente com valor vazio/não-hex) →
    `401 invalid_signature`, `send` não chamado, sem exceção não tratada
    (MUST-FIX do Planning Review).
20. `POST` com `change.value` trazendo múltiplos comentários no mesmo
    `entry.changes[]` (não apenas múltiplos entries) → `enqueued: 2`,
    `send` chamado 2x (SHOULD-FIX do Planning Review — teste 9 só cobre
    multi-entry, não multi-change-no-mesmo-entry).
21. `POST` com corpo vazio (`""`) e assinatura válida (HMAC calculado sobre
    string vazia) → `200`, `enqueued: 0`, `send` não chamado (SHOULD-FIX
    do Planning Review).
22. Handshake `GET` com `hub.mode=subscribe` + `hub.verify_token` correto
    mas `hub.challenge` ausente → `200`, corpo vazio (`""`) — confirma a
    decisão de design registrada acima.

## Critério de aceite

`cd workers/api-social-ingress && npm install && npx vitest run` 100% verde
(25 testes — evoluiu de 22 pra 25 ao longo da execução, ver Execução), zero
chamada de rede real (sem `fetchImpl` aqui — o worker não chama Graph API,
só lê request/enfileira), zero `any`/`!` sem justificativa.

## Rollback

Diretório novo isolado (`workers/api-social-ingress/`), sem dependentes
ainda (nenhum outro worker/config referencia este worker) — apagar o
diretório inteiro. Nenhuma mudança em `config/products.catalog.json` neste
slice (já foi feita no Slice 1).

## Execução (append-only)

- **2026-06-22:** Slice file criado, decisões de design registradas antes
  do Planning Review.
- **2026-06-22:** Planning Review (agente separado, `ecc:architect`) →
  APROVADO COM AJUSTES. 2 MUST-FIX incorporados: (1) secrets resolvidos via
  `resolveSecret()`/`SecretValue` + `getCatalog(env)` fallback, mirror
  exato do Hotmart, não leitura direta de `env[nome]`; (2) teste de
  assinatura malformada (sem prefixo `sha256=`) adicionado (teste 19). 4
  SHOULD-FIX incorporados: teste multi-change-no-mesmo-entry (20), teste de
  corpo vazio (21), decisão de `hub.challenge` ausente registrada + teste
  (22), nota de content-type deliberadamente ignorado. HMAC `===` simples
  confirmado como aceitável pra v1 (não MUST-FIX), com follow-up de
  hardening registrado explicitamente. Lista de testes: 18 → 22.
- **2026-06-22:** TDD Red→Green. `test/unit/index.test.ts` escrito primeiro
  (22 testes); confirmado falhando (`Cannot find module ../../src/index`)
  antes de criar `src/index.ts`. Scaffolding (`package.json`/`tsconfig.json`/
  `vitest.config.js`/`wrangler.toml`/`test/integration/.gitkeep`) criado
  mirror exato do `api-hotmart-ingress`. Ajuste de implementação no teste
  (não no worker): assinatura HMAC nos testes calculada via `crypto.subtle`
  (mesma API do worker), não `node:crypto` — evita dependência nova
  (`@types/node`) e mantém os testes na mesma primitiva que o código real
  usa. `npm install` local (76 pacotes) executado em
  `workers/api-social-ingress/`.
- **2026-06-22:** `npx vitest run` em `workers/api-social-ingress` → 22/22
  testes verdes. `npx tsc --noEmit` → zero erros. `npx vitest run` em
  `packages/shared` (suíte completa, não tocada neste slice) → 121/121
  ainda verdes, sem regressão.
- **2026-06-22:** Code Quality Review (agente separado, `ecc:typescript-reviewer`,
  rodou os comandos ele mesmo) → APROVADO COM RESSALVAS. 2 SHOULD-FIX
  encontrados e corrigidos nesta atualização: (1) **achado real, não só
  gap de teste** — `resolveProductCode` (closure em `index.ts`) chamava
  `resolveProductCodeForSocialAccount` sem escopar ao `tenantId` já
  autenticado por hostname+HMAC; como essa função varre todos os tenants
  do catalog (decisão do Slice 2), um `account_id` duplicado/mal-cadastrado
  em outro tenant atribuiria o evento ao tenant errado mesmo com assinatura
  válida. Corrigido: a closure agora descarta a resolução se
  `resolution.tenantId !== tenantId`. Teste novo "16b" confirma isolamento
  (payload autenticado como `decole`, `account_id` só cadastrado em
  `superare` → `enqueued: 0`). (2) teste 19 ampliado de 1 caso pra
  `it.each` com 3 casos (sem prefixo, prefixo+hex inválido, prefixo+valor
  vazio) — cobertura que o nome do teste original já alegava mas não
  exercitava. Lista de testes: 22 → 25. Re-execução pelo implementador após
  o fix: `npx vitest run` → 25/25 verdes, `npx tsc --noEmit` → zero erros
  (evidência do implementador — a confirmação independente dos 2 fixes
  fica a cargo do Slice Validator a seguir, já que o agente de Code
  Quality Review não pôde ser re-invocado na mesma sessão por limitação de
  ferramenta).
- **2026-06-22:** Slice Validator (agente separado, `ecc:code-reviewer`,
  leitura fria, rodou todos os comandos ele mesmo) → **DONE**. Confirmou de
  forma independente: 25/25 testes verdes; `tsc --noEmit` zero erros;
  `packages/shared` 121/121 sem regressão (`git status` confirma que nada
  lá foi tocado por este slice); fix de isolamento entre tenants
  (`index.ts:186`) confirmado por leitura de código + confirmação de que o
  teste 16b falharia se o guard fosse revertido; cobertura de assinatura
  malformada com 3 casos (`it.each`) confirmada; cross-check de assinaturas
  de função contra `packages/shared/src/*` sem gaps; zero `any`/`!` não
  justificado; diff aditivo confirmado (mudanças soltas em
  `config/products.catalog.json`/`workers/links-redirect/README.MD` no
  working tree são de outros escopos — Slice 1 deste mesmo plano + feature
  não relacionada — não tocadas por este slice).

## Revisão (Planning Review / Code Quality Review / Slice Validator)

**Planning Review: APROVADO COM AJUSTES** (agente separado, `ecc:architect`)
— 2 MUST-FIX + 4 SHOULD-FIX, todos incorporados antes da implementação.

**Code Quality Review: APROVADO COM RESSALVAS** (agente separado,
`ecc:typescript-reviewer`, rodou os comandos ele mesmo) — zero MUST-FIX.
2 SHOULD-FIX, ambos corrigidos pelo implementador com evidência (testes +
typecheck): (1) achado real de isolamento entre tenants na resolução de
produto por `account_id` — corrigido escopando ao tenant já autenticado;
(2) cobertura de teste de assinatura malformada ampliada de 1 pra 3 casos.

**Slice Validator: DONE** (agente separado, `ecc:code-reviewer`, leitura
fria) — confirmou de forma independente toda a evidência acima, incluindo
que o fix de isolamento é real (não cosmético: o teste 16b falharia sem
ele) e que o diff é estritamente aditivo.
