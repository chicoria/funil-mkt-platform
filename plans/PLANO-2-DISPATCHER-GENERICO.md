# Plano 2 — Dispatcher Genérico Declarativo + Multi-Tenant

> **Status:** Slices 2.0–2.10 concluídos · E2E transacional Plano de Voo validado em 2026-05-15/16 · Repo canónico: **`funil-mkt-platform`** · Pendente: **2.11 (split em satélites — ver tabela abaixo)**, 2.12–2.15.
> **Pré-requisito:** Plano 1 (Separação de Responsabilidades) ✅ — arquivado em `plans/completed/PLANO-1-SEPARACAO-RESPONSABILIDADES.md`
> **Resultado:** FunilMKT é plataforma multi-tenant e genérica. Novo tenant/produto = JSON no catálogo. Zero código de Worker para casos cobertos pelo catálogo.
> **Localização (2026-05-18):** este plano foi movido de `decole-plano-de-voo-app/docs/` para `funil-mkt-platform/plans/` (mesmo repo dos workers que ele governa).

---

## Planos satélites

Quando um slice originalmente concebido aqui cresceu e ganhou autonomia, ele virou um plano satélite no próprio repo afetado. Este documento mantém apenas a referência e o **escopo macro**; o detalhamento operacional vive no satélite.

| Satélite | Caminho | Escopo | Slice |
|---|---|---|---|
| PLANO-MASTER-MULTI-TENANT | `plans/PLANO-MASTER-MULTI-TENANT.md` | **Ponto de entrada autoritativo** — overview + governance + guard rails para todas as mudanças multi-tenant | (master) |
| PLANO-MULTI-TENANT-SECRETS-CONFIG | `plans/PLANO-MULTI-TENANT-SECRETS-CONFIG.md` | Credenciais por tenant, schema v5 do catálogo, naming `{SECRET}_{TENANT}`, Cloudflare Secrets Store, princípio agnostic dos workers, testes de regressão | 2.11A |
| PLANO-SGTM-PLATAFORMA-COMPARTILHADO | `plans/PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md` | 1 sGTM compartilhado da plataforma (Modelo B), custom domains por tenant, lookup tables internas, roadmap de backoffice automatizado | 2.11B |
| PLANO-LINKS-REDIRECT-MULTI-TENANT | `plans/PLANO-LINKS-REDIRECT-MULTI-TENANT.md` | Remove hardcode do `links-redirect` (paths, contatos WhatsApp, URLs Hotmart) para `tenants.{id}.links` no catálogo | 2.11C |
| PLANO-DASHBOARD-SYNC-MULTI-TENANT | `plans/PLANO-DASHBOARD-SYNC-MULTI-TENANT.md` | dashboard-sync itera catálogo, `tenant_id` em D1 (`ga4_daily_metrics`, `meta_daily_metrics`), cron multi-tenant | 2.11D |

**Política:** este PLANO-2 documenta arquitetura, decisões e história dos slices. Quando um slice cobrir trabalho concentrado em um repo único (como secrets, dashboard, sGTM, links), o plano operacional fica no repo afetado, com link bidirecional. **Comece sempre por `PLANO-MASTER-MULTI-TENANT.md` para entender governance antes de mexer em qualquer satélite.**

---

## Contexto

### Processo por Slice

Cada slice segue um ciclo obrigatório, com escopo pequeno e registro explícito antes e depois da implementação:

1. **Proposta antes de implementar**
   - apresentar objetivo do slice, arquivos prováveis, contrato público afetado, riscos, plano de rollback e critério de aceite;
   - declarar qual camada será alterada e quais camadas não devem ser tocadas;
   - indicar se `config/products.catalog.json` e `config/README.md` precisam mudar.
2. **TDD Red**
   - escrever ou ajustar testes primeiro, em Vitest, cobrindo happy path, bordas, regressões e falhas esperadas;
   - quando a mudança afeta Workers, incluir teste do contrato HTTP/queue e não só teste de função pura;
   - quando a mudança afeta catálogo/configuração, incluir validação do catálogo bundled.
3. **Green mínimo**
   - implementar apenas o necessário para passar os testes do slice;
   - manter compatibilidade com eventos/keys legadas quando o risco operacional exigir janela de transição.
4. **Refactor**
   - reorganizar para baixo acoplamento, alta coesão e aderência aos padrões locais;
   - remover duplicação real, não introduzir abstrações especulativas;
   - garantir que nomes, tipos e limites de módulo expressem o domínio.
5. **Revisão Kent Beck**
   - um agente revisor no papel "Kent Beck reviewer" avalia design incremental, simplicidade, TDD, legibilidade, testes e risco de regressão;
   - o reviewer classifica achados em **MUST-FIX**, **SHOULD-FIX** e **NICE-TO-HAVE**;
   - nenhum slice avança com MUST-FIX aberto; SHOULD-FIX vira desdobramento explícito se não for tratado no mesmo corte.
6. **Documentação e desdobramentos**
   - registrar no plano: escopo entregue, decisões arquiteturais, testes executados, achados do reviewer, correções aplicadas e pendências;
   - atualizar runbooks/config/docs impactados no mesmo slice;
   - registrar quando o catálogo **não** precisou ser alterado.

### Arquitetura e design esperado

O FunilMKT deve seguir arquitetura em camadas, com dependências apontando para dentro e contratos explícitos entre módulos:

| Camada | Responsabilidade | Exemplos |
|--------|------------------|----------|
| **Ingress / Transport** | HTTP, CORS, auth de entrada, parse básico e enqueue | `api-funnel-ingress`, `api-hotmart-ingress`, `links-redirect` |
| **Application / Orchestration** | Resolve tenant/produto/evento, monta contexto, executa chain e coordena retries | `funnel-dispatcher`, `HandlerContext`, `createHandlers` |
| **Domain / Policy** | Regras puras de tenant, catálogo, payload mapping, dedupe keys, isolamento | `tenant-scope`, `catalog-adapter`, `payload-mapper` |
| **Infrastructure / Adapters** | Brevo, Hotmart, D1, KV, fetch externo, Cloudflare bindings | email sender, repositories, queue/KV/D1 adapters |
| **Configuration** | Catálogo declarativo, TOML, schemas SQL, templates e env var names | `config/products.catalog.json`, `wrangler.toml`, `config/d1/*` |

Padrões preferidos quando couberem:

- **Ports and Adapters:** domínio e orquestração dependem de interfaces; Workers/Brevo/D1/KV ficam como adapters.
- **Strategy / Registry:** handlers são estratégias registradas por nome; o catálogo escolhe a chain sem `if` por produto.
- **Factory:** criação de `HandlerContext`, serviços e clients por tenant deve ficar em factory pequena e testável.
- **Adapter:** catálogo legado/futuro e APIs externas são adaptados para contratos internos estáveis.
- **Policy Object:** regras como CORS por tenant, auth Hotmart e tenant scope devem ficar em funções/objetos pequenos, puros quando possível.

Critérios de qualidade por slice:

- separar parsing/transporte de regra de negócio;
- evitar estado global mutável, exceto caches explícitos e seguros;
- tipar contratos do catálogo em vez de propagar `unknown` até runtime;
- preferir funções puras para resolução de tenant, aliases, origins, payload mapping e key building;
- manter blast radius pequeno: um slice deve tocar o menor conjunto coerente de módulos.

#### Template obrigatório antes de implementar

Antes de editar código em qualquer slice, registrar no chat e depois persistir no plano ou em documento linkado:

```md
Slice:
Objetivo:
Escopo incluído:
Fora de escopo:
Camadas afetadas:
Padrão arquitetural aplicado:
Arquivos prováveis:
Contratos públicos afetados:
TDD Red:
Evidência Red esperada:
Riscos e rollback:
Catálogo/config: precisa mudar? por quê?
Critério de aceite:
```

#### Template obrigatório após implementar

Ao finalizar cada slice, registrar:

```md
Slice:
Escopo entregue:
Decisões arquiteturais:
Padrão arquitetural aplicado:
Testes Red/Green/Refactor:
Evidência Red observada:
Verificações executadas:
Revisão Kent Beck:
MUST-FIX abertos: 0
MUST-FIX corrigidos:
SHOULD-FIX pendentes:
NICE-TO-HAVE:
Catálogo/config: atualizado ou não aplicável:
Desdobramentos:
```

#### Registro desta atualização de processo — 2026-05-14

Escopo:
- protocolo obrigatório por slice com proposta prévia, TDD Red/Green/Refactor, revisão Kent Beck e registro permanente;
- arquitetura em camadas e padrões preferidos explicitados;
- slices 2.11 a 2.15 detalhados com camadas, TDD, refactor, revisão e desdobramentos;
- inconsistências antigas corrigidas: Slice 2.6 marcado como concluído/superseded por sub-slices, auth/CORS movidos para 2.11, Slice 2.8 alinhado a `tenant_id` em payload + hostname, repo DECOLE sem backend tratado como cleanup em publicação.

Revisão Kent Beck:
- MUST-FIX abertos: 0.
- MUST-FIX corrigidos: caminhos do clone arquivado deixaram de ser instrução operacional; status do repo DECOLE foi atualizado; template pós-slice ganhou `NICE-TO-HAVE` e gate `MUST-FIX abertos: 0`; Slice 2.6 ganhou fonte de verdade única; escopo 2.7 vs 2.11 foi separado; Slice 2.8 deixou de orientar tenant no path.
- SHOULD-FIX pendentes: consolidar convenção final de env vars no Slice 2.11 e manter registro de cada slice no plano ou doc linkado.

### Problema

Após o Plano 1, o dispatcher tem handlers produto-específicos. Além disso, existe uma necessidade concreta de multi-tenancy: a **SUPERARE** (segundo negócio de marketing digital) usará a mesma plataforma FunilMKT com seus próprios produtos, credenciais Hotmart e Brevo.

### Modelo multi-tenant

```
FunilMKT (Workers) — plataforma compartilhada, invisível
  │
  ├── api.decolesuacarreiraesg.com.br  ──┐
  ├── links.decolesuacarreiraesg.com.br ─┤→ Tenant: DECOLE
  ├── decolesuacarreiraesg.com.br (Pages)┘   Hotmart/Brevo credentials próprias
  │                                          Produtos: PLANOVOO, ESG_MENTORIA
  │
  ├── api.superare.com.br  ──────────────┐
  ├── links.superare.com.br ─────────────┤→ Tenant: SUPERARE
  └── superare.com.br (Pages) ───────────┘   Hotmart/Brevo credentials próprias
                                             Produtos: (a definir)
```

**Resolução de tenant por hostname:** Cada domínio de tenant está no Cloudflare (zona ativa). Worker routes mapeiam múltiplas zonas para o mesmo Worker. O Worker resolve `tenant_id` a partir de `request.url.hostname` cruzando com `tenants.{id}.domains[]` no catálogo.

**Plataforma invisível:** Não existe domínio `funilmkt.com`. Cada tenant vê apenas seu próprio domínio. Hotmart/parceiros veem URLs do tenant.

**Cada tenant tem sua própria app de produto** (Next.js/repo separado). O FunilMKT é a única peça compartilhada.

### Objetivo

1. Substituir handlers produto-específicos por **2 handlers genéricos** que leem do catálogo
2. Catálogo organizado por **tenant → produtos → eventos → actions**
3. Isolamento de dados por tenant (KV keys, D1 rows, credenciais)
4. Ingress resolve tenant a partir da URL do webhook

**Resultado:** Novo tenant ou produto = configuração JSON + configuração operacional obrigatória (env vars, routes/zona Cloudflare e validação). Zero código de Worker para casos cobertos pelo catálogo.

### Registro de execução — 2026-05-14 (corte 1: Slices 2.1–2.5)

Repo de trabalho histórico: `/Users/chicoria/git/decolesuacarreiraesg` (clone divergente arquivado depois do Slice 2.15). Repo canônico atual do tenant DECOLE: `/Users/chicoria/git/decole/decolesuacarreiraesg`.

Commit: `c01f371 feat: add generic dispatcher building blocks (Plan 2, Slices 2.1–2.5)`

Implementados os building blocks genéricos do dispatcher:

- `payload-mapper.ts` — `mapValue`, `mapPayload`, `interpolate`; filtros `first_name`, `lowercase`, `uppercase`.
- `tenant-resolver.ts` — `resolveTenantFromHostname`, `resolveTenantFromProductCode`, `getCredentials`.
- `handler-context.ts` — `HandlerContext` com `set/get`, `dedupeKey`, `kvKey`, credenciais por tenant.
- `call-product-api.ts` — handler genérico com HMAC-SHA256, `mapPayload`, armazena response no contexto.
- `send-template-email.ts` — handler genérico com `BrevoTransactionalEmailSender`, interpolação `{{response.token}}`.

Verificações: typecheck e testes unitários passaram.

---

### Registro de execução — 2026-05-14 (corte 2: Slices 2.6 + 2.6A + 2.6D)

Commit: `ecead33 feat: generic dispatcher handlers + catalog adapter + review fixes (Plan 2, Slices 2.6/2.6A)`

#### Escopo deste corte

- `DECOLE_PLANOVOO` passou a usar `call_product_api` + `send_template_email` nas chains de:
  - `PURCHASE_APPROVED`, `PURCHASE_CANCELED`, `PURCHASE_REFUNDED`, `PURCHASE_CHARGEBACK`, `PURCHASE_PROTEST`, `PURCHASE_EXPIRED`
- O catálogo recebeu `product_api` e `template_email` para esses eventos:
  - endpoint da API do Plano de Voo; `hmac_secret_env`; `request_mapping` com fallbacks `??`; `response_key: "token"` no fluxo de compra aprovada; emails transacionais Brevo `12`, `13` e `14`.
- `PayloadMapper` passou a suportar: fallback `??`; filtros `format_brl` e `date_br`; fallback de `event.payload` → `{ lead: event.lead }` (seguro, sem expor campos internos).
- `call_product_api`: `url_env + path` além de `url` direto; `skip_if_missing`; fallback de mapeamento limitado a `event.lead`.
- `send_template_email`: `BREVO_BASE_URL` e `BREVO_TIMEOUT_MS` configuráveis.
- Dispatcher: `setHandlerResult`/`getHandlerResult` persistem resultado de handler em `event.payload.__handler_results` para retry seguro (token recuperado sem chamar API novamente).
- `catalog-adapter.ts` (novo): resolve produto/evento do catálogo legado `products.*` ou futuro `tenants.*`; retorna `tenant_id` quando resolve via bloco `tenants`.
- `handlers/index.ts`: `getOrCreateContext` resolve credenciais reais do tenant via catálogo (`brevo_api_key_env`, `hotmart_token_env`); fallback para `env.BREVO_API_KEY` em catálogos legados.
- Templates de email adicionados: `purchase-refunded-v1.html`, `purchase-protest-v1.html`.
- Artefatos operacionais: `.github/workflows/deploy-funnel-dispatcher.yml`, `backend/cloudflare/package.json`, `check-pending-placeholders.sh`, `tail-workers.sh`, `cleanup-transaction.mjs`.
- `call-plano-voo-api.ts` e seus testes deletados (2.6D concluído): arquivo não estava registrado em `createHandlers()` nem referenciado por nenhuma chain do catálogo.

#### Revisão Kent Beck — corte 1 (anterior a este registro)

1. Retry quebrava `formUrl` após dedupe de `call_product_api`: corrigido persistindo response no dedupe KV.
2. Mappings genéricos perdiam payload flat Hotmart e `event.lead.email`: corrigido com `??` e fallback para `{ lead: event.lead }`.
3. Eventos terminais sem `transacao` bloqueavam email: corrigido com `skip_if_missing`.
4. `check-pending-placeholders.sh` tinha parsing frágil: corrigido.
5. `tail-workers.sh` quebrava pipe: corrigido.

#### Revisão Kent Beck — corte 2 (esta sessão)

O agente encontrou 3 MUST-FIX e 4 SHOULD-FIX. Os 3 bloqueadores foram corrigidos antes do commit:

1. **MUST-FIX #2** — `__handler_results` vazava no body do n8n (`buildN8nForwardPayload` fazia spread de `event.payload`). Corrigido: desestruturação remove a chave antes do spread.
2. **MUST-FIX #4** — `mapEventPayload` caía para raiz do `FunnelEvent`, podendo expor `event_id`, `source`, `tenant_id` na API. Corrigido: fallback limitado a `{ lead: ctx.event.lead }`.
3. **MUST-FIX #9** — `call-plano-voo-api.ts` existia mas não estava registrado em `createHandlers()` — qualquer chain com esse nome causaria `handler_not_implemented` em runtime. Corrigido: arquivo deletado.

SHOULD-FIX pendentes (não bloqueadores, follow-up):
- **#1** — `CatalogEventConfig` usa index signature `[key: string]: unknown`; adicionar campos tipados `product_api?` e `template_email?`.
- **#5** — Precedência `??`/`|`: `$.a ?? $.b | first_name` aplica filtro só no último fallback. Documentar ou corrigir o parser.
- **#8** — Gaps de cobertura: cenário de tenant desconhecido no integration test; `send_template_email` com `skip_if_missing` via catálogo.

#### Verificações deste corte

- `npm run typecheck` em `backend/cloudflare/workers/funnel-dispatcher` — passou.
- `npx vitest run workers/funnel-dispatcher/` — **134 testes passaram**.
- `git diff --check` — passou.

#### Pendências registradas após este corte

- Catálogo JSON ainda **não** migrado para `tenants.*` (2.6B pendente na época; concluído depois em 2026-05-14).
- `tenant_id` real por hostname nos ingress workers não implementado (2.6C/2.7 pendentes na época; concluído depois para DECOLE em 2026-05-14).
- Ingress workers multi-tenant e routes Cloudflare para SUPERARE não implementados (routes SUPERARE seguem como pendência operacional do Slice 2.12).
- SHOULD-FIX #1, #5, #8 da revisão (follow-up).
- 3 commits locais ainda não pusheados para origin.

---

### Auditoria de pendências — 2026-05-14

Repos verificados:
- Plataforma: `/Users/chicoria/git/funil-mkt-platform`
- Tenant DECOLE: `/Users/chicoria/git/decole/decolesuacarreiraesg`

Resultado geral:
- O backend evoluído está no `funil-mkt-platform`.
- O repo canônico do tenant DECOLE é `/Users/chicoria/git/decole/decolesuacarreiraesg`. O cleanup local do Slice 2.15 removeu `backend/cloudflare/` e workflows de backend; pendem commit/push e smoke operacional.
- O clone divergente `/Users/chicoria/git/decolesuacarreiraesg` foi arquivado com bundle/patches para consulta, não deve ser usado como repo de trabalho.
- O Plano 2 já tem catálogo `tenants.*`, handlers genéricos, adapter e `tenant_id` em dois ingress workers, mas ainda não está fechado para multi-tenant real com isolamento completo de dados, credenciais e routes.

#### Pendências no `funil-mkt-platform`

| Área | Pendência | Risco | Plano |
|------|-----------|-------|-------|
| D1 | Implementado no Slice 2.10: `identity_links` e `funnel_events` agora têm `tenant_id`, PK composta, rebuild de tabelas legadas e queries escopadas. | Risco residual operacional se staging/prod não acionar a migração runtime antes do tráfego multi-tenant. | Validar `__funilmkt_schema_migrations` em staging/prod após smoke event. |
| KV | Implementado no Slice 2.10: chaves de identidade, dedupe e recuperação foram prefixadas por `{tenant_id}:`, com fallback temporário para chaves DECOLE legadas. | Risco residual de lixo antigo em KV se houver chaves legadas não alcançadas por eventos terminais. | Monitorar invalidações DECOLE e planejar cleanup KV legado após janela de compatibilidade. |
| Brevo | Handlers legados (`send_brevo_doi`, `update_brevo_funnel`, `send_cart_abandonment_email`) ainda usam `env.BREVO_API_KEY` global. | SUPERARE poderia enviar ou atualizar contato no Brevo errado. | Slice 2.11: resolver credenciais por tenant para todos os handlers Brevo, não só `send_template_email`. |
| Hotmart auth | `api-hotmart-ingress` valida `HOTMART_WEBHOOK_TOKEN` global e mapeia slugs DECOLE hardcoded. | Webhook de tenant futuro pode ser aceito com token errado ou cair em tenant incorreto. | Slice 2.11: resolver tenant antes da validação, validar token via `tenants.{id}.credentials.hotmart_token_env`, e derivar produto/tenant pelo catálogo. |
| CORS | `api-funnel-ingress` usa `ALLOWED_ORIGINS` global e previews sem configuração aceitam qualquer origin. | Abertura excessiva em preview/staging e falta de política por tenant. | Slice 2.11: `allowedOrigins` por tenant no catálogo, fallback explícito por ambiente e documentação/gate para previews. |
| `links-redirect` | Emite `BEGIN_CHECKOUT` sem `tenant_id` e configura produtos via `LINKS_PRODUCTS` global. | Eventos de checkout ficam dependentes de fallback do dispatcher. | Slice 2.12: resolver tenant por hostname, incluir `tenant_id` no evento e mover configuração de links para catálogo por tenant/produto. |
| Routes | Routes SUPERARE existem só como comentário nos `wrangler.toml`. | Onboarding de novo tenant ainda exige alteração operacional manual não validada. | Slice 2.12: ativar routes quando a zona SUPERARE existir e adicionar teste de TOML/config. |
| Handler genérico de email | `send_template_email` ainda propaga erro da Brevo; o plano dizia non-fatal. | Falha transitória de email pode causar retry da queue depois de handlers anteriores. | Slice 2.13: envolver envio em try/catch, logar `handler_warn`, e testar que falha de Brevo não impede dedupe/chain posterior quando aplicável. |
| Tipagem do catálogo | Ainda há tipos permissivos e import estrutural do JSON bundled. | Erros de catálogo podem aparecer só em runtime. | Slice 2.13: tipar `product_api?`/`template_email?`, validar catálogo no boot/testes e documentar precedência `??`/`|` ou corrigir parser. |
| Typecheck | `api-funnel-ingress` falha no typecheck por casts dos mocks nos testes; alguns packages dependem de dev deps locais para typecheck dos testes. | CI pode passar testes mas falhar em validação TypeScript isolada. | Slice 2.14: corrigir tipos dos testes, padronizar `npm ci` por package ou workspace root, e garantir `npm run typecheck` em todos os workers. |

#### Status do cleanup no `decolesuacarreiraesg`

| Área | Status | Risco residual | Plano |
|------|-----------|-------|-------|
| Backend duplicado | Removido localmente do repo canônico DECOLE; `git ls-files 'backend/*'` deve retornar `0` após stage/commit. | Cleanup ainda precisa ser publicado para evitar que outro clone use o backend antigo. | Concluir commit/push do Slice 2.15 e manter backend apenas em `funil-mkt-platform`. |
| Workflows | Workflows de backend removidos localmente do DECOLE. | Até publicar, GitHub ainda pode expor workflows antigos no branch remoto. | Publicar cleanup e conferir Actions do repo DECOLE. |
| Instruções de agents | `AGENTS.MD` atualizado localmente para apontar para `funil-mkt-platform/config/products.catalog.json`. | Agents em clones remotos podem ler instrução antiga até merge. | Publicar cleanup e revisar instruções após merge. |
| Documentação operacional | `ACESSOS_AGENTES_AI.md` atualizado localmente para ponteiros FunilMKT. | Runbooks externos podem continuar apontando para paths antigos. | Fazer busca pós-merge por `backend/cloudflare` e atualizar docs externas se existirem. |
| LPs DECOLE | `site/index.html` e `site/planodevoo/index.html` receberam hidden input `tenant_id=decole` localmente. | Falta smoke POST após deploy de Pages. | Após publicação, smoke de precheckout e confirmação de payload enfileirado. |

#### Plano de execução recomendado

1. **Slice 2.10 — Isolamento de dados por tenant — implementado**
   - `tenant_id` em D1 (`identity_links`, `funnel_events`) com migrations compatíveis e rebuild de tabelas legadas.
   - Backfill lógico para registros existentes como `decole`.
   - KV (`identity`, `checkout_recovery`, índices e dedupe) prefixado por tenant.
   - Queries de enrich, steps, recovery e identity escopadas por tenant.
   - Testes cobrem colisão entre `decole` e tenant fake, queries tenant-scoped e recuperação KV legada.

2. **Slice 2.11 — Credenciais, auth e CORS por tenant**
   - Converter todos os handlers Brevo para usar credenciais resolvidas do tenant.
   - Validar Hotmart token por tenant antes de aceitar webhook.
   - Remover hardcode de slug/produto do `api-hotmart-ingress` quando o catálogo tiver aliases suficientes.
   - Declarar `allowedOrigins` por tenant no catálogo e aplicar no `api-funnel-ingress`.

3. **Slice 2.12 — Ingress completo e links multi-tenant**
   - `links-redirect` resolve tenant por hostname e inclui `tenant_id` em `BEGIN_CHECKOUT`.
   - Config de links passa a vir do catálogo por tenant/produto, mantendo `LINKS_PRODUCTS` só como fallback temporário.
   - Ativar routes SUPERARE apenas quando zona DNS estiver pronta.
   - Adicionar proteção contra host/path conflitante: webhook SUPERARE no host DECOLE não deve cair em `decole` silenciosamente.

4. **Slice 2.13 — Hardening dos handlers genéricos**
   - `send_template_email` non-fatal conforme desenho original.
   - Tipar `CatalogEventConfig.product_api` e `CatalogEventConfig.template_email`.
   - Resolver ou documentar precedência `??`/`|`.
   - Validar catálogo bundled em teste para falhar cedo.

5. **Slice 2.14 — CI e package hygiene**
   - Corrigir typecheck de `api-funnel-ingress` nos testes.
   - Padronizar instalação/test/typecheck por worker/package.
   - Atualizar workflows do `funil-mkt-platform` para cobrir dispatcher, ingress, links e shared.
   - Rodar `npx vitest run` completo e `npm run typecheck` por pacote.

6. **Slice 2.15 — Cleanup do repo DECOLE**
   - Publicar a remoção de `backend/cloudflare/` do repo canônico DECOLE.
   - Publicar a remoção dos workflows backend do DECOLE.
   - Publicar as atualizações de `AGENTS.MD`, `ACESSOS_AGENTES_AI.md` e docs que citavam `backend/cloudflare`.
   - Conferir LPs DECOLE com `tenant_id=decole` e validar que qualquer alteração de funil/produto passa pelo catálogo no `funil-mkt-platform`.

#### Plano operacional detalhado dos próximos slices

Os próximos slices, incluindo cleanup ainda não publicado, devem ser executados um por vez. Antes de cada implementação, apresentar a proposta curta do slice, aguardar alinhamento humano quando houver risco operacional, implementar via TDD e chamar o reviewer Kent Beck ao final.

##### Slice 2.11 — Credenciais e config multi-tenant (split em satélites)

**Status (2026-05-18):** escopo expandido — split em 4 planos operacionais no repo `funil-mkt-platform/plans/`.

A revisão profunda do escopo identificou que "credenciais, auth e CORS por tenant" é apenas uma das dimensões; sGTM compartilhado, dashboard-sync multi-tenant e links-redirect catalog-aware ganharam autonomia de plano próprio. **Comece sempre por `plans/PLANO-MASTER-MULTI-TENANT.md`** (overview + governance + guard rails para todos os 4 sub-slices).

- **Slice 2.11A — Secrets e credenciais por tenant** → `plans/PLANO-MULTI-TENANT-SECRETS-CONFIG.md`
  Cobre: rename de env vars para `{SECRET}_{TENANT}[_{PRODUCT}]`, Cloudflare Secrets Store account-level com helper wrapper, expansão de `tenants.{id}.credentials` no catálogo, nova seção `tenants.{id}.integrations` (n8n, Plano de Voo, Brevo) e `tenants.{id}.tracking` (sGTM endpoint, GA4 por tenant, Meta CAPI token), substituição de leituras `env.BREVO_API_KEY`/`env.HOTMART_WEBHOOK_TOKEN`/`env.N8N_WEBHOOK_URL`/`env.PLANOVOO_*` por leituras indiretas via catálogo, schema v5, ingress auth Hotmart por tenant (inverter ordem `isAuthorized` → `resolveTenant`), CORS por tenant, princípio operacional "workers agnostic" (grep critério), estratégia de testes (cross-tenant isolation + golden master), compatibilidade com staging.

- **Slice 2.11B — sGTM único da plataforma (Modelo B)** → `plans/PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md`
  Cobre: 1 container Cloud Run compartilhado por todos os tenants (`gcr.io/cloud-tagging-10302018/gtm-cloud-image`), custom domains por tenant (`sgtm.decolesuacarreiraesg.com.br`, futuramente `sgtm.superare.com.br`) preservando first-party cookies, lookup tables internas no workspace GTM (tenant_id do Host header → measurement_id/api_secret/capi_token; (tenant_id, produto) → pixel_id), runbook de onboarding, roadmap de backoffice automatizado via Cloud Run Admin API + Tag Manager API v2 + Cloudflare API (SA `acesso-api@gtm-k6q4h6br-ndq3n.iam.gserviceaccount.com` já existente).

- **Slice 2.11C — links-redirect multi-tenant** → `plans/PLANO-LINKS-REDIRECT-MULTI-TENANT.md`
  Cobre: remoção integral do hardcode do `links-redirect` (paths `decole-esg/checkout`, `plano-de-voo/checkout`, URLs Hotmart, número WhatsApp Elizete, mapa `LINKS_PRODUCTS`), nova estrutura `tenants.{id}.links.{linksDomain, routes[], contacts{slug}}` + `products.{code}.links.{checkoutBaseUrl, offerPathTemplate}` no catálogo v5, resolução de tenant via hostname, refactor para bundle catalog-aware.

- **Slice 2.11D — dashboard-sync multi-tenant** → `plans/PLANO-DASHBOARD-SYNC-MULTI-TENANT.md`
  Cobre: remoção do `productMap` hardcoded, descoberta de tenants/produtos via catálogo bundled, GA4 property POR TENANT, Meta Ad Account POR PRODUTO, secrets renomeados (`GA4_*_DECOLE`, `META_AD_ACCOUNT_ID_DECOLE_*`), D1 `tenant_id` em `ga4_daily_metrics` / `meta_daily_metrics`, modo cron multi-tenant, test harness completo (worker hoje não tem testes), princípio agnostic.

**Os critérios de aceite originais do antigo 2.11 (handlers Brevo sem `env.BREVO_API_KEY` global, Hotmart auth por tenant, CORS por tenant)** continuam válidos e estão **dentro de 2.11A**.

**Sequenciamento:** 2.11A, 2.11B, 2.11C, 2.11D são independentes entre si e podem rodar em paralelo a partir da Fase 0 do plano master. Onboarding completo de SUPERARE depende dos 4 estarem concluídos (validação cruzada em slice 2.11Z.1).

**A revisão Kent Beck** roda em cada satélite ao final de cada slice individual (template em `plans/SLICE-TEMPLATE.md`). Slices 2.12–2.15 continuam descritos abaixo e dependem do encerramento de 2.11A (não de 2.11B/C/D — esses podem rodar em paralelo a 2.12+).

##### Slice 2.12 — Ingress completo, links multi-tenant e routes

**Proposta prévia obrigatória:**
- declarar como `links-redirect` resolverá tenant por hostname;
- declarar como a config de links sai de `LINKS_PRODUCTS` para catálogo por tenant/produto;
- declarar se routes SUPERARE serão apenas documentadas ou ativadas.

**Camadas afetadas:**
- Ingress / Transport: `links-redirect` e routes.
- Domain / Policy: resolução de tenant/produto por hostname, path e aliases.
- Configuration: links no catálogo, TOML e eventual validação de routes.

**TDD Red:**
- `links.decolesuacarreiraesg.com.br/plano-de-voo/checkout` enfileira `BEGIN_CHECKOUT` com `tenant_id: "decole"`.
- host SUPERARE fake com catálogo de teste resolve `tenant_id: "superare"` sem alterar código.
- `LINKS_PRODUCTS` funciona apenas como fallback temporário e é coberto por teste de compatibilidade.
- path de produto de outro tenant no host DECOLE falha explicitamente ou retorna erro seguro.
- TOML/config tem teste ou script que detecta routes ausentes/quebradas quando ativadas.

**Green e Refactor:**
- extrair `LinkCatalogResolver`/policy pura para traduzir host+path em `{ tenant_id, product_code, checkoutUrl }`;
- deixar Worker como adapter fino: parse request, chamar resolver, enfileirar evento, redirecionar;
- manter fallback `LINKS_PRODUCTS` isolado em adapter de compatibilidade.

**Reviewer Kent Beck:**
- procurar acoplamento entre path DECOLE e código, duplicação de catálogo no TOML/env e ausência de teste para host conflitante.

**Desdobramentos esperados:**
- checklist operacional para ativar zona/routes SUPERARE;
- plano de remoção do fallback `LINKS_PRODUCTS` após janela de compatibilidade.

##### Slice 2.13 — Hardening dos handlers genéricos e catálogo

**Proposta prévia obrigatória:**
- declarar quais contratos do catálogo serão tipados e validados;
- decidir se a precedência `??`/`|` será corrigida ou documentada com teste de caracterização;
- declarar política final de erro para `send_template_email`.

**Camadas afetadas:**
- Domain / Policy: parser/mapping e tipos de catálogo.
- Application / Orchestration: semântica fatal/non-fatal da chain.
- Infrastructure / Adapters: Brevo adapter e logs de falha.
- Configuration: validação do catálogo bundled.

**TDD Red:**
- `send_template_email` loga warning e não quebra a chain quando Brevo falha de forma configurada como non-fatal.
- falha fatal continua fatal quando o catálogo/handler declarar comportamento fatal.
- `CatalogEventConfig` tipa `product_api?` e `template_email?`.
- catálogo bundled inválido falha cedo em teste.
- precedência `$.a ?? $.b | first_name` é coberta por teste explícito, com comportamento escolhido documentado.

**Green e Refactor:**
- criar schema/validator leve para catálogo sem transformar runtime em framework pesado;
- mover parsing de mapping para módulo puro com testes de caracterização;
- padronizar logs `handler_warn`/`handler_error` com tenant, product_code, event_type e handler.

**Reviewer Kent Beck:**
- procurar validação tardia demais, tipos permissivos, abstração excessiva e comportamento de erro surpreendente.

**Desdobramentos esperados:**
- matriz de handlers fatal vs non-fatal;
- documentação da mini-linguagem do PayloadMapper.

##### Slice 2.14 — CI e package hygiene

**Proposta prévia obrigatória:**
- declarar matriz de packages/workers e comandos por pacote;
- declarar se haverá workspace root ou execução independente por diretório;
- listar falhas conhecidas de typecheck antes do Red.

**Camadas afetadas:**
- Build / Tooling: package scripts, workflows e instalação.
- Tests: typecheck, unit, integration e validação de catálogo.
- Configuration: GitHub Actions do `funil-mkt-platform`.

**TDD Red:**
- reproduzir falha de typecheck do `api-funnel-ingress` em teste/mocks.
- workflow dry-run executa install, typecheck e testes nos workers críticos.
- comando documentado roda em máquina limpa com `npm ci`.
- validação falha se um package não tiver `test` ou `typecheck` esperado.

**Green e Refactor:**
- corrigir tipos dos mocks sem casts que escondam contrato quebrado;
- padronizar scripts `test`, `typecheck` e `verify` por package;
- reduzir duplicação dos workflows com passos claros, sem lógica shell frágil.

**Reviewer Kent Beck:**
- procurar CI que testa coisa diferente do dev local, comandos dependentes de estado local e mocks que deixam passar contrato errado.

**Desdobramentos esperados:**
- comando único de verificação pré-commit/manual;
- checklist para novo worker/package entrar na matriz de CI.

##### Slice 2.15 — Cleanup do repo DECOLE

**Proposta prévia obrigatória:**
- declarar estado do clone duplicado e estratégia de backup antes de remover;
- declarar arquivos rastreados a remover do repo DECOLE;
- declarar quais docs/LPs serão ajustadas e se catálogo FunilMKT precisa mudar.

**Camadas afetadas:**
- Tenant repo: site, documentação e workflows do DECOLE.
- Platform repo: apenas referência; não deve receber mudança se o catálogo já está correto.
- Configuration: `AGENTS.MD`, runbooks e referências ao catálogo.

**Teste de caracterização / Verificação de aceite:**
- antes do cleanup, `git ls-files 'backend/*'` caracteriza backend rastreado; depois do cleanup, deve retornar `0`.
- `.github/workflows/*` no DECOLE não deve deployar backend.
- `rg "backend/cloudflare|api-precheckout|api-events-consumer|api-hotmart-webhook"` deve retornar vazio.
- LPs DECOLE devem enviar `tenant_id=decole`.
- catálogo FunilMKT deve existir, validar como JSON e conter tenant/produtos DECOLE.

**Green e Refactor:**
- mover clone duplicado para archive com bundle/patches antes de removê-lo do caminho ativo;
- remover backend/workflows rastreados do repo DECOLE;
- atualizar docs para apontarem para `/Users/chicoria/git/funil-mkt-platform`;
- manter o repo DECOLE focado em site, tráfego e documentação do tenant.

**Reviewer Kent Beck:**
- procurar perda de histórico sem backup, documentação apontando para caminhos obsoletos e mudança indevida no catálogo.

**Desdobramentos esperados:**
- confirmar push/PR do cleanup;
- smoke manual do precheckout em staging/produção após deploy de Pages;
- remover archive local apenas quando o cleanup estiver publicado e validado.

#### Verificações da auditoria

- `npx vitest run workers/funnel-dispatcher/ workers/api-funnel-ingress/ workers/api-hotmart-ingress/ workers/links-redirect/ packages/shared/` em `funil-mkt-platform` — 206 testes passaram.
- `npm run typecheck` em `workers/funnel-dispatcher` — passou.
- `npm run typecheck` em `workers/api-hotmart-ingress` — passou após `npm ci --ignore-scripts`.
- `npm run typecheck` em `workers/api-funnel-ingress` — falhou por tipagem dos mocks nos testes (`send.mock.calls[0]?.[0]` inferido como tupla vazia), pendência do Slice 2.14.
- `git status --short` nos repos `funil-mkt-platform`, `/Users/chicoria/git/decole/decolesuacarreiraesg` e `decole-plano-de-voo-app` — limpo antes desta edição.

---

### Registro de execução — 2026-05-14 (Slice 2.10)

Repo de trabalho: `/Users/chicoria/git/funil-mkt-platform`

Status: implementado e revisado. Ainda não commitado.

#### Escopo entregue

- `tenant-scope.ts` centraliza `DEFAULT_TENANT_ID`, resolução de tenant por catálogo/evento e prefixo de chaves operacionais.
- Dedupe do dispatcher passou a usar chave `{tenant_id}:{product_code}:{event_id}:{handler}`.
- KV de identidade passou a usar:
  - `{tenant_id}:identity:anon:{anonymous_id}`
  - `{tenant_id}:identity:email:{email_hash}`
- KV de recuperação passou a usar:
  - `{tenant_id}:checkout_recovery:{recovery_id}`
  - `{tenant_id}:checkout_recovery_index:{kind}:{product}:{value}`
- Leitura compatível temporária para DECOLE:
  - identidade ainda lê `identity:*` legado se a chave nova não existir;
  - invalidação de recuperação apaga token/índice novo e também token/índice legado quando encontrado.
- D1 `identity_links` e `funnel_events` receberam `tenant_id`, PKs compostas e índices por tenant.
- Migração runtime idempotente via `__funilmkt_schema_migrations`:
  - adiciona `tenant_id DEFAULT 'decole'` quando necessário;
  - remove índices globais legados;
  - faz rebuild das tabelas para remover PKs globais antigas;
  - preserva linhas existentes como `tenant_id = 'decole'`.
- Queries de attribution, recovery e Brevo steps agora filtram por `tenant_id` + `profile_id`.
- `config/d1/identity_links.sql` e `config/d1/funnel_events.sql` foram atualizados para o schema alvo e removem índices legados quando aplicados por script.

#### TDD e revisão

- Red inicial cobriu colisão de identity entre tenants, chaves de recovery sem tenant e queries históricas sem escopo.
- Green implementou o isolamento e atualizou os testes existentes.
- Reviewer Kent Beck apontou:
  - **Blocker:** schema D1 novo não removia PKs/índices globais de bases existentes.
  - **High:** invalidação de recovery legado apagava o token antigo, mas deixava índice legado órfão.
  - **Medium:** testes não caracterizavam suficientemente migração/compatibilidade.
- Correções pós-review:
  - rebuild idempotente de `identity_links` e `funnel_events`;
  - `DROP INDEX IF EXISTS` para índices globais legados;
  - deleção de índices legados e scoped na invalidação de recovery DECOLE;
  - teste explícito para migração emitida, teste de recovery legado e teste de caracterização com SQLite real partindo do schema antigo.

#### Verificações

- `npx vitest run workers/funnel-dispatcher/test/unit/index.test.ts` — 24 testes passaram.
- `npx vitest run workers/funnel-dispatcher/test/unit/d1-migration.node.test.mts workers/funnel-dispatcher/test/unit/index.test.ts` — 25 testes passaram.
- `npx vitest run workers/funnel-dispatcher/` — 143 testes passaram.
- `npm run typecheck` em `workers/funnel-dispatcher` — passou.
- `npx vitest run workers/funnel-dispatcher/ workers/api-funnel-ingress/ workers/api-hotmart-ingress/ workers/links-redirect/ packages/shared/` — 210 testes passaram.
- `git diff --check` — passou.

#### Desdobramentos para o próximo slice

- Slice 2.11 deve eliminar os usos restantes de `env.BREVO_API_KEY` global nos handlers Brevo legados e resolver credenciais via tenant.
- Slice 2.11 também deve mover validação Hotmart e CORS para políticas por tenant antes de avançar para routes/links multi-tenant.
- Antes de promover para produção, executar `scripts/apply-d1-schema.sh`, disparar um smoke event em staging para acionar a migração runtime e validar que `__funilmkt_schema_migrations` contém:
  - `2026-05-14_identity_links_tenant_pk`
  - `2026-05-14_funnel_events_tenant_pk`

---

### Registro operacional — 2026-05-15/16 (E2E emails transacionais Plano de Voo)

Repos envolvidos:
- Plataforma: `/Users/chicoria/git/funil-mkt-platform`
- App Plano de Voo: `/Users/chicoria/git/decole-plano-de-voo-app`
- Tenant DECOLE/env local: `/Users/chicoria/git/decole/decolesuacarreiraesg`

#### Estado anterior encontrado

- `PURCHASE_APPROVED`, `PURCHASE_PROTEST` e `PURCHASE_REFUNDED` do `DECOLE_PLANOVOO` já estavam no catálogo com `call_product_api` + `send_template_email`.
- O handler genérico `call_product_api` exige `ctx.env[product_api.hmac_secret_env]` e envia `x-signature: sha256=<hmac>`.
- O catálogo usa:
  - `PLANOVOO_API_BASE_URL`
  - `PLANOVOO_HOOK_SECRET`
- Em produção, esses valores ainda não estavam provisionados no Worker `decole-funnel-dispatcher`.
- No app Plano de Voo, os hooks `/api/hooks/purchase`, `/api/hooks/refund` e `/api/hooks/protest` já exigiam `process.env.PLANOVOO_HOOK_SECRET`, mas o container `nextjs` em produção não recebia essa env var.
- A imagem do app em produção era antiga e não continha ainda as rotas `/api/hooks/*`; smoke inicial retornou `404`.

Conclusão do diagnóstico: antes desta correção, `PURCHASE_APPROVED` podia entrar no funil e gravar D1, mas não conseguia criar token no Plano de Voo nem montar email confiável com `{{response.token}}`.

#### Provisionamento realizado

- Gerado novo `PLANOVOO_HOOK_SECRET` compartilhado Worker → App.
- Cloudflare Worker `decole-funnel-dispatcher`:
  - `PLANOVOO_HOOK_SECRET` criado como secret via Wrangler.
  - `PLANOVOO_API_BASE_URL = "https://plano.decolesuacarreiraesg.com.br"` adicionado em `workers/funnel-dispatcher/wrangler.toml`.
  - Worker publicado; deploy confirmou binding `env.PLANOVOO_API_BASE_URL`.
- VPS/app Plano de Voo:
  - `PLANOVOO_HOOK_SECRET` adicionado ao `.env` real da VPS.
  - `infra/docker-compose.yml` passou a injetar `PLANOVOO_HOOK_SECRET` no serviço `nextjs`.
  - `infra/.env.template` passou a declarar `PLANOVOO_HOOK_SECRET`.
  - Container `nextjs` recriado e confirmado com `PLANOVOO_HOOK_SECRET=present`.

Observação de segurança: o valor do secret não foi documentado no repo. Após a execução, o arquivo temporário local usado para provisionamento foi removido. O valor não é recuperável pelo Cloudflare; se precisar de cópia local para testes, armazenar fora do repo, preferencialmente em arquivo de secrets no `$HOME`, não em arquivo versionável.

#### Deploy do app Plano de Voo

- O deploy local via `./deploy.sh latest` falhou porque o Docker daemon local não estava rodando.
- A VPS tinha Docker disponível, mas o checkout `/opt/decole-plano-de-voo-app` estava desatualizado e com alterações manuais; não foi feito `git pull` para evitar sobrescrever trabalho local.
- Foi enviado um build context temporário do repo local para `/tmp/decole-plano-de-voo-app-build` na VPS e buildada a imagem `decole/plano-de-voo-app:latest` diretamente lá.
- Build inicial falhou por incompatibilidade TypeScript do Next 16: `revalidateTag(tag)` passou a exigir segundo argumento.
- Correção aplicada no app:
  - `lib/hooks/token-service.ts`: `revalidateTag(\`plano-${token}\`, 'max')`.
  - `lib/hooks/__tests__/token-service.test.ts`: expectativas atualizadas para o segundo argumento.
- Nova imagem buildada com sucesso e container `nextjs` recriado.
- Smoke direto com HMAC em `POST https://plano.decolesuacarreiraesg.com.br/api/hooks/purchase` retornou `201` e `{ token }`.

Pendência operacional: o checkout Git na VPS continua desatualizado/sujo e não deve ser usado como fonte de verdade. A fonte de verdade é o repo local/remoto do app. Quando houver janela segura, revisar o fluxo de deploy para evitar build por tarball temporário e publicar via pipeline normal.

#### Cenários E2E criados/ajustados

No `funil-mkt-platform`:
- `tests/lib/purchase-email-scenario.mjs`
- `tests/scenarios/10-purchase-approved-email.mjs`
- `tests/scenarios/11-purchase-protest-email.mjs`
- `tests/scenarios/12-purchase-refunded-email.mjs`
- `tests/SCENARIO_GUARDRAILS.md`

Guard rails relevantes:
- Cenários que chamam sistemas externos usam tag `external`.
- `--include-external` é obrigatório para rodar 10–12.
- Exigem `HOTMART_INGRESS_URL`, `PLANOVOO_API_BASE_URL`, `event_id` `e2e-*`, transação `HP-E2E-*` e email descartável.
- Cleanup remove dados por IDs E2E, não por email genérico.
- Brevo é filtrado por janela temporal (`since`) para evitar falso positivo por email antigo.

#### Testes e validações executados

Funil E2E não externo:
- `tests/run-scenarios.sh --all --skip-sgtm --env-file ../decole/decolesuacarreiraesg/.env.local`
- Resultado: cenários `01` a `09` passaram.
- `09-cart-abandonment-recovery` validou Brevo template `11`, link `rid` renderizado e redirect Hotmart com parâmetros recuperados.

Funil E2E externo:
- `tests/run-scenarios.sh --scenario 10,11,12 --include-external --skip-sgtm ...`
- Resultado final:
  - `10-purchase-approved-email`: passou após alinhar o texto esperado ao template Brevo real.
  - `11-purchase-protest-email`: passou.
  - `12-purchase-refunded-email`: passou.
- O cenário 10 validou webhook → dispatcher → API Plano de Voo → token → Brevo template `12` → link `/formulario/{token}` no conteúdo renderizado.
- Os cenários 11 e 12 validaram templates Brevo `14` e `13` com conteúdo renderizado esperado.

Unitários/Build:
- `workers/funnel-dispatcher`: `npm test` → 142 testes passaram.
- `workers/api-hotmart-ingress`: `npm test` → 9 testes passaram.
- `workers/links-redirect`: `npm test` → 17 testes passaram.
- App Plano de Voo:
  - `npm run test:unit` → 53 testes passaram.
  - `npm run build` → passou e listou `/api/hooks/purchase`, `/api/hooks/protest`, `/api/hooks/refund`.

Checks auxiliares:
- `bash -n tests/run-scenarios.sh`
- `node --check` nos helpers/cenários alterados
- `git diff --check`

#### Resultado atual

- `PURCHASE_APPROVED` do Plano de Voo está funcional ponta a ponta em produção para:
  - criar token no app Plano de Voo;
  - interpolar `{{response.token}}`;
  - enviar template Brevo `12`;
  - renderizar link `/formulario/{token}`.
- `PURCHASE_PROTEST` e `PURCHASE_REFUNDED` estão funcionais ponta a ponta para templates `14` e `13`.
- Tokens `HP-E2E-*` criados durante a validação foram removidos do Postgres; consulta final direta não retornou resíduos `HP-E2E-*` em `plano_voo_tokens`.

#### Pendências e cuidados para próximos agentes

- O secret real `PLANOVOO_HOOK_SECRET` não deve ser commitado. Se for necessário para testes locais, criar um arquivo de secrets fora dos repos, por exemplo em `$HOME`, e carregar via `--env-file`.
- O pedido posterior foi mover/centralizar o `.env.local` do repo DECOLE para uma pasta do usuário (`~/`) para reduzir risco de secret em workspace Git. Ainda precisa ser executado/documentado como tarefa separada.
- `config/PLANO-STAGING-FUNIL-LANDING-PLANOVOO.md` apareceu como arquivo não rastreado no `funil-mkt-platform`; não foi incluído nas alterações.
- Durante a limpeza, SSH na VPS passou a recusar conexões na porta `22`, mas HTTPS e Postgres direto estavam acessíveis. A aplicação ficou respondendo `200`. Se SSH continuar recusando, investigar `sshd`/firewall antes de novo deploy operacional.
- As mudanças ainda estavam sem commit no momento deste registro.

---

## Decisões Arquiteturais

### 1. Catálogo multi-tenant declarativo

Estrutura alvo: `tenants → tenant → credentials + products → product → events → actions`. A convenção final de nomes de env vars por tenant deve ser fechada no Slice 2.11; o exemplo abaixo mostra o formato desejado.

```jsonc
{
  "tenants": {
    "decole": {
      "name": "DECOLE sua Carreira ESG",
      "domains": [
        "api.decolesuacarreiraesg.com.br",
        "links.decolesuacarreiraesg.com.br",
        "decolesuacarreiraesg.com.br"
      ],
      "credentials": {
        "brevo_api_key_env": "BREVO_API_KEY_DECOLE",
        "hotmart_token_env": "HOTMART_TOKEN_DECOLE",
        "replyToEmail": "contato@decolesuacarreiraesg.com.br"
      },
      "products": {
        "PLANOVOO": {
          "name": "Plano de Voo",
          "events": {
            "PURCHASE_APPROVED": {
              "chain": ["resolve_identity", "upsert_event_store", "enrich_attribution",
                        "update_brevo_funnel", "emit_tracking",
                        "call_product_api", "send_template_email"],
              "product_api": {
                "url": "https://app.decole.../api/hooks/purchase",
                "method": "POST",
                "hmac_secret_env": "PLANOVOO_HOOK_SECRET",
                "request_mapping": {
                  "email":     "$.buyer.email",
                  "nome":      "$.buyer.name",
                  "transacao": "$.purchase.transaction",
                  "produto":   "$.product.name",
                  "valor":     "$.purchase.price.value",
                  "pagamento": "$.purchase.payment.type"
                },
                "response_key": "token"
              },
              "template_email": {
                "templateId": 12,
                "to_email":   "$.buyer.email",
                "params_mapping": {
                  "primeiroNome": "$.buyer.name | first_name",
                  "produto":      "$.product.name",
                  "formUrl":      "https://app.decole.../formulario/{{response.token}}",
                  "transacao":    "$.purchase.transaction"
                }
              }
            }
          }
        },
        "ESG_MENTORIA": {
          "name": "Mentoria ESG",
          "events": {
            "PURCHASE_APPROVED": {
              "chain": ["resolve_identity", "upsert_event_store",
                        "update_brevo_funnel", "emit_tracking",
                        "send_template_email"],
              "template_email": {
                "templateId": 78,
                "to_email": "$.buyer.email",
                "params_mapping": {
                  "primeiroNome": "$.buyer.name | first_name",
                  "linkAcesso": "https://mentoria.decole.../acesso"
                }
              }
            }
          }
        }
      }
    },
    "superare": {
      "name": "SUPERARE",
      "domains": [
        "api.superare.com.br",
        "links.superare.com.br",
        "superare.com.br"
      ],
      "credentials": {
        "brevo_api_key_env": "BREVO_API_KEY_SUPERARE",
        "hotmart_token_env": "HOTMART_TOKEN_SUPERARE",
        "replyToEmail": "contato@superare.com.br"
      },
      "products": {
        // produtos da SUPERARE — a definir
      }
    }
  }
}
```

### 2. PayloadMapper — paths simples, não JSONPath completo

Suporta:
- Paths diretos: `$.buyer.email` → navega no objeto
- Pipe filters: `$.buyer.name | first_name` → split(" ")[0]
- Fallbacks: `$.data.buyer.email ?? $.buyer.email ?? $.lead.email`
- Filtros de apresentação: `format_brl`, `date_br`
- Template interpolation: `"url/{{response.token}}"` → substitui com valores do response
- Fallback null para paths inexistentes

**Não suporta** (YAGNI): arrays, wildcards, regex, expressões complexas.

### 3. Handler genérico é skip-safe

Se `product_api` não está configurado para o evento, `call_product_api` faz skip silencioso. Idem para `send_template_email` sem `template_email`. Isso permite usar os handlers genéricos na chain default sem quebrar produtos que não precisam deles.

### 4. Response da API disponível para email

O handler `call_product_api` armazena o response no `HandlerContext` (novo conceito). O handler `send_template_email` pode referenciar `{{response.token}}` nos params.

**Atualização de execução:** além do `HandlerContext` em memória, o corte de 2026-05-14 passou a persistir o response relevante no valor de dedupe do handler. Isso evita perder `response.token` quando a API já foi chamada com sucesso e apenas o email falha/retrya depois.

---

## Implementação em Thin Slices

### Slice 2.0 — Extrair FunilMKT para repo próprio

Registro histórico do corte de extração: o FunilMKT vivia dentro do repo `decolesuacarreiraesg` (repo do tenant DECOLE). Como plataforma multi-tenant, foi extraído para repo próprio.

**Novo repo:** `funil-mkt-platform`

**O que move:**
```
decolesuacarreiraesg/backend/cloudflare/
  ├── workers/         → funil-mkt-platform/workers/
  ├── packages/shared/ → funil-mkt-platform/packages/shared/
  ├── packages/email/  → funil-mkt-platform/packages/email/
  ├── config/          → funil-mkt-platform/config/
  ├── scripts/         → funil-mkt-platform/scripts/
  └── .github/         → funil-mkt-platform/.github/
```

**O que NÃO move (fica em decolesuacarreiraesg):**
```
decolesuacarreiraesg/
  ├── site/            ← LP DECOLE (Pages, domínio próprio)
  ├── marketing/
  ├── curso/
  └── ...
```

**O que remove (já feito no Plano 1):**
- `packages/planovoo/` — não existe mais neste ponto

#### 🔴 TDD Red

```
- funil-mkt-platform/ compila independente (npm install + npm run build)
- funil-mkt-platform/ testes passam (npm test)
- CI/CD workflows funcionam no novo repo
- wrangler deploy funciona a partir do novo repo
- decolesuacarreiraesg/ não contém mais backend/cloudflare/
```

#### Passos históricos

1. Criar repo `funil-mkt-platform`
2. Copiar workers + packages + config + scripts + CI workflows
3. Atualizar imports e paths relativos
4. Verificar que compila e testes passam
5. Deploy de staging a partir do novo repo
6. Remover `backend/cloudflare/` do repo `decolesuacarreiraesg`

**Nota:** Manter git history com `git filter-branch` ou `git subtree split` se o histórico for importante. Caso contrário, fresh start é mais simples.

---

### Slice 2.1 — PayloadMapper

**Arquivos:**
```
workers/funnel-dispatcher/src/
  payload-mapper.ts
  test/unit/
    payload-mapper.test.ts
```

#### 🔴 TDD Red

```
mapValue(event, "$.buyer.email"):
- Retorna "user@email.com" para evento com buyer.email
- Retorna null para path inexistente
- Retorna null para evento vazio

mapValue(event, "$.purchase.price.value"):
- Navega nested objects corretamente
- Retorna 197.0 (number preservado)

mapValue(event, "$.buyer.name | first_name"):
- "João Silva" → "João"
- "" → ""
- null → null

mapPayload(event, mapping):
- { email: "$.buyer.email", nome: "$.buyer.name" }
  → { email: "user@email.com", nome: "João Silva" }
- Omite chaves com valor null

interpolate(template, context):
- "url/{{response.token}}" + { response: { token: "abc" } }
  → "url/abc"
- "{{response.missing}}" → "" (graceful)

mapPayload com data wrapper:
- Suporta payload com wrapper { data: { buyer, purchase } }
- Suporta payload legado flat { buyer, purchase }
```

#### 🟢 Green

Implementar mapper com:
- `mapValue(obj, path)` — resolve `$.a.b.c`
- `applyFilter(value, filter)` — `first_name` etc.
- `mapPayload(obj, mapping)` — aplica mapValue a cada campo
- `interpolate(template, context)` — `{{key}}` replacement

#### ♻️ Refactor

Extrair filters como registry extensível.

---

### Slice 2.2 — Tenant Resolution (multi-tenancy)

**Arquivos:**
```
workers/funnel-dispatcher/src/
  tenant-resolver.ts
  test/unit/
    tenant-resolver.test.ts
```

O FunnelEvent hoje carrega `product_code: "DECOLE_PLANOVOO"`. Com multi-tenant, o ingress precisa resolver o tenant e o catálogo precisa ser navegado por `tenants.{tenant_id}.products.{product_code}`.

#### 🔴 TDD Red

```
resolveTenantFromHostname(hostname, catalog):
- "api.decolesuacarreiraesg.com.br" → { tenant_id: "decole", ... }
- "api.superare.com.br" → { tenant_id: "superare", ... }
- "links.decolesuacarreiraesg.com.br" → { tenant_id: "decole", ... }
- Hostname desconhecido → throw

resolveTenantFromProductCode(product_code, catalog):
- "DECOLE_PLANOVOO" → { tenant_id: "decole", product_code: "PLANOVOO" }
- Fallback para backward compat (eventos sem tenant_id)

getCredentials(tenant_id, catalog, env):
- Retorna { brevoApiKey, hotmartToken, replyToEmail } para o tenant
- Resolve env var names do catálogo (brevo_api_key_env → valor real do env)
```

#### 🟢 Green

Implementar resolver que navega catálogo multi-tenant.

**Impacto no FunnelEvent:** Adicionar campo `tenant_id` (opcional para backward compat). Ingress workers populam a partir da URL do webhook.

---

### Slice 2.3 — HandlerContext + tenant isolation (propagação de dados entre handlers)

**Arquivos:**
```
workers/funnel-dispatcher/src/
  handler-context.ts
  test/unit/
    handler-context.test.ts
```

Hoje os handlers recebem `(event, env)`. Para o handler de email acessar o response da API, precisamos de um contexto compartilhado.

#### 🔴 TDD Red

```
HandlerContext:
- new HandlerContext(event, env, tenantInfo) cria contexto com tenant
- ctx.tenant_id retorna "decole"
- ctx.credentials retorna { brevoApiKey, replyToEmail } do tenant
- ctx.set("api_response", { token: "abc" }) armazena dados
- ctx.get("api_response") retorna dados armazenados
- ctx.get("inexistente") retorna undefined
- ctx.event retorna o FunnelEvent original
- ctx.env retorna o DispatcherEnv
- ctx.dedupeKey("handler_name") retorna "decole:event_id:handler_name" (tenant-prefixed)
- ctx.kvKey("email_hash:xxx") retorna "decole:email_hash:xxx" (tenant-prefixed)
```

#### 🟢 Green

Classe simples com Map interno.

**Impacto:** `HandlerFn` muda de `(event, env) => Promise<void>` para `(ctx: HandlerContext) => Promise<void>`. Refactor compatível nos handlers existentes.

---

### Slice 2.4 — Handler genérico `call_product_api`

**Arquivos:**
```
workers/funnel-dispatcher/src/handlers/
  call-product-api.ts
  test/unit/
    call-product-api.test.ts
```

#### 🔴 TDD Red

```
- Lê event_config.product_api do catálogo
- Se product_api não configurado → skip (log, não erro)
- Mapeia payload do evento → request body via PayloadMapper
- POST para url com HMAC-SHA256 (secret do env via hmac_secret_env)
- Armazena response JSON inteiro no HandlerContext como "api_response"
- Se response_key configurado, extrai campo específico
- Se API retorna 4xx → throw (fatal, queue retry)
- Se API retorna 5xx → throw (fatal, queue retry)
- Timeout de 30s
```

#### 🟢 Green

Implementar handler que lê config do catálogo, mapeia payload, chama API, armazena response.

---

### Slice 2.5 — Handler genérico `send_template_email`

**Arquivos:**
```
workers/funnel-dispatcher/src/handlers/
  send-template-email.ts
  test/unit/
    send-template-email.test.ts
```

#### 🔴 TDD Red

```
- Lê event_config.template_email do catálogo
- Se template_email não configurado → skip
- Resolve to_email via mapValue do evento
- Mapeia params via PayloadMapper
- Interpola {{response.X}} nos params usando HandlerContext.get("api_response")
- Envia via BrevoTransactionalEmailSender (já existe em shared/)
- Handler é non-fatal (try/catch, log warning)
```

#### 🟢 Green

Implementar handler que lê config, mapeia params, interpola response, envia email.

---

### Slice 2.6 — Migrar catálogo para multi-tenant

**Arquivos modificados:**
```
config/products.catalog.json
workers/funnel-dispatcher/src/handlers/index.ts
```

**O que muda no catálogo:**

| Evento | Antes | Depois |
|--------|-------|--------|
| PURCHASE_APPROVED | `send_plano_voo_purchase_email` | `call_product_api, send_template_email` |
| PURCHASE_REFUNDED | `send_plano_voo_refunded_email` | `call_product_api, send_template_email` |
| PURCHASE_PROTEST | `send_plano_voo_protest_email` | `call_product_api, send_template_email` |

**O que remove do código:**
- `call_plano_voo_purchase`, `call_plano_voo_refund`, `call_plano_voo_protest` (do Plano 1)
- Qualquer handler com "plano_voo" no nome

#### 🔴 TDD Red

```
- Catálogo DECOLE_PLANOVOO.PURCHASE_APPROVED.chain contém call_product_api
- Catálogo DECOLE_PLANOVOO.PURCHASE_APPROVED.product_api tem url e request_mapping
- Nenhum handler com "plano_voo" no nome existe no código
- Deploy compila sem erros
```

#### Status em 2026-05-14

Status final: concluído em sub-slices. Os primeiros cortes foram executados no clone histórico `/Users/chicoria/git/decolesuacarreiraesg`, depois consolidado no repo de plataforma `/Users/chicoria/git/funil-mkt-platform`. O clone histórico foi arquivado após o cleanup do Slice 2.15 e não deve ser usado como repo operacional.

Concluído nos cortes 2.6A a 2.6D:
- `DECOLE_PLANOVOO.PURCHASE_APPROVED.chain` contém `call_product_api` e `send_template_email`.
- Eventos terminais do Plano de Voo também usam `call_product_api` e `send_template_email`.
- `product_api` e `template_email` foram declarados no catálogo.
- Dedup KV funciona com os novos handlers, incluindo hidratação do response para retries.
- Testes unitários e integração do dispatcher passam.
- Handlers legados com `plano_voo` no nome foram removidos no 2.6D.
- Catálogo foi migrado para `tenants.decole.products` no 2.6B.

Escopos movidos para slices posteriores:
- Tenant real por hostname nos ingress workers ficou no Slice 2.7.
- Auth Hotmart e CORS por tenant ficaram no Slice 2.11.
- Routes SUPERARE e links multi-tenant ficaram no Slice 2.12.

#### Sub-slices de migração do Slice 2.6

Para reduzir risco, o Slice 2.6 foi dividido em cortes menores:

| Sub-slice | Escopo | Status |
|-----------|--------|--------|
| 2.6A | Catalog Adapter: runtime lê `products` legado e `tenants.*` futuro | ✅ Concluído em 2026-05-14 |
| 2.6B | Migrar `products.catalog.json` para `tenants.decole.products` mantendo aliases | ✅ Concluído em 2026-05-14 |
| 2.6C | Runtime cria `HandlerContext` com tenant/credenciais reais e fallback compatível | ✅ Concluído em 2026-05-14 (parte do 2.6A) |
| 2.6D | Remover handlers/testes legados `call_plano_voo_*` | ✅ Concluído em 2026-05-14 |

##### 2.6A + 2.6C + 2.6D — Concluídos em 2026-05-14

Ver "Registro de execução — 2026-05-14 (corte 2)" acima para detalhes completos.

##### 2.10 — Isolamento de dados por tenant (2026-05-14, corte 6)

Repo: `funil-mkt-platform` · Commit: `7a72762 feat: isolate dispatcher data by tenant`

**Implementação:**
- `workers/funnel-dispatcher/src/tenant-scope.ts` — módulo com `resolveEventTenantId(event, catalog)` e `tenantScopedKey(tenantId, suffix)`. Toda KV key passa a ter prefixo `{tenant_id}:`, prevenindo colisão de dados entre tenants.
- `config/d1/identity_links.sql` — schema migrado: coluna `tenant_id TEXT NOT NULL DEFAULT 'decole'`; PK alterada para `(tenant_id, profile_id)`; índices únicos passam a incluir `tenant_id`.
- `config/d1/funnel_events.sql` — mesma migração: `tenant_id` + PK `(tenant_id, event_id)`.
- `workers/funnel-dispatcher/src/handlers/index.ts` — todos os upserts e lookups de D1 (`identity_links`, `funnel_events`) passam a incluir `tenant_id` nas queries e nos inserts.
- `workers/funnel-dispatcher/test/unit/d1-migration.node.test.mts` — teste usando `node:sqlite` (`DatabaseSync`) que valida DDL + queries de migração dos dois schemas (legado sem `tenant_id` e novo com `tenant_id` na PK). Garante que a migração não quebra instâncias já provisionadas.

**Verificações:**
- `npx vitest run` em `funil-mkt-platform/` — **210 testes passaram** (15 arquivos).
- `npm run typecheck` em `workers/funnel-dispatcher` — passou.
- Repo limpo, pushed para origin.

---

##### 2.0 — Extrair repo FunilMKT (2026-05-14, corte 0)

Repo: `funil-mkt-platform` · Commit: `41ccc5c chore: standalone funil-mkt-platform repo (Slice 2.0)`

`backend/cloudflare/` de `decolesuacarreiraesg` extraído via `git subtree split` para repo independente `funil-mkt-platform`. Paths e scripts actualizados para raiz do repo. CI workflows e README adicionados. `.gitignore` exclui `node_modules` e artefactos de build.

O repo `decole/decolesuacarreiraesg` **não tem `backend/`** — directório já inexistente, cleanup completo.

---

##### 2.9 — Remover packages/planovoo (verificado 2026-05-14)

Auditoria de 8 pontos confirmou zero resíduos em `funil-mkt-platform`:
- Sem directório `packages/planovoo/`
- Sem imports `from.*packages/planovoo`
- Sem binding `PLANOVOO_DB` em qualquer `wrangler.toml`
- Sem binding Hyperdrive
- Sem classes `PlanoVoo*`
- Sem handlers `call_plano_voo*` / `send_plano_voo*`
- Sem dependência `pg` no dispatcher

O pacote nunca foi copiado para o repo novo — cleanup implícito no Slice 2.0.

---

##### 2.8 — LPs passam tenant_id (2026-05-14, corte 5)

**Implementação:**
- `site/index.html` (DECOLE_ESG_MENTORIA) e `site/planodevoo/index.html` (DECOLE_PLANOVOO): adicionado `<input type="hidden" name="tenant_id" value="decole">` no form de precheckout (defesa em profundidade + visibilidade do contrato em DOM/network).
- `packages/shared/src/tenant-from-hostname.ts`: novo `tryResolveTenantIdFromHostname()` que retorna `string | undefined` (sem fallback). `resolveTenantIdFromHostname` delega para ele.
- `workers/api-funnel-ingress/src/index.ts`: prioridade de resolução agora é (1) hostname conhecido → (2) `payload.tenant_id` **validado contra `Object.keys(catalog.tenants)`** → (3) `env.DEFAULT_TENANT_ID` → (4) `"decole"`. Assinatura `withTenantId` ganhou `payload`.
- `workers/api-hotmart-ingress/src/index.ts`: comentário explicativo de que Hotmart **não** honra payload.tenant_id (S2S com HMAC; divergência intencional do funnel-ingress).
- 5 testes novos: prioridade hostname sobre payload, payload válido aceito quando hostname unknown, payload `evil-tenant` rejeitado (cai no DEFAULT), `/funnel/event` também protegido, helper `tryResolveTenantIdFromHostname` (3 testes).

**Revisão Kent Beck — fixes aplicados:**
- SHOULD-FIX #1: validação de `payload.tenant_id` contra `KNOWN_TENANT_IDS` (rejeita strings arbitrárias).
- SHOULD-FIX #3: teste de regressão para `/funnel/event` com payload spoofed.
- SHOULD-FIX #4: comentário no hotmart-ingress explicando divergência.

**SHOULD-FIX pendentes:**
- #2 do agente: previews sem `ALLOWED_ORIGINS` aceitam qualquer origin (precondição independente do 2.8). Documentar requisito de `ALLOWED_ORIGINS` em previews ou gate Cloudflare Access.

**Verificações:**
- `npx vitest run` em `backend/cloudflare/` — **206 testes passaram** (14 arquivos).
- `npm run typecheck` em `funnel-dispatcher` — passou.

---

##### 2.7 — Ingress multi-tenant (2026-05-14, corte 4)

Ambos workers de ingress (`api-hotmart-ingress`, `api-funnel-ingress`) passaram a resolver `tenant_id` a partir do hostname e a popular o campo no `FunnelEvent` antes do enqueue.

**Implementação:**
- Novo `packages/shared/src/tenant-from-hostname.ts` com `resolveTenantIdFromHostname(hostname, catalog, fallback)` — função pura, case-insensitive, defensiva (7 testes unitários).
- `api-hotmart-ingress`: popula `normalized.tenant_id` antes do `queue.send()`; loga `hostname` e `tenant_id`.
- `api-funnel-ingress`: helper `withTenantId()` aplicado nos 3 endpoints (`/funnel/precheckout`, `/funnel/event`, `/webhooks/v1/planovoo/app/event`); log inclui `tenant_id`.
- `tsconfig.json` dos 2 ingress recebeu `"resolveJsonModule": true` (necessário para importar o catálogo bundled).
- `wrangler.toml` dos 2 ingress: nova `[vars] DEFAULT_TENANT_ID = "decole"`; routes da SUPERARE documentadas como comentário (ativar quando zona DNS estiver pronta).
- 6 testes novos nos ingress: hostname conhecido → `tenant_id`, fallback `DEFAULT_TENANT_ID`, fallback default `"decole"`.

**Revisão Kent Beck — fixes aplicados:**
- SHOULD-FIX #4/#5: `DEFAULT_TENANT_ID` declarado em `[vars]` dos 2 wrangler.toml.
- SHOULD-FIX #6: teste do fallback default sem `DEFAULT_TENANT_ID` adicionado.
- SHOULD-FIX #7: logs de `api-funnel-ingress` incluem `tenant_id`.

**SHOULD-FIX pendentes (follow-up para entrada do SUPERARE):**
- Hostname fragilidade: se Hotmart configurar webhook do SUPERARE para `api.decolesuacarreiraesg.com.br/webhooks/v1/superare-*`, resolver retorna `"decole"` (cross-tenant leakage). Solução: derivar `tenant_id` também do path slug ou do `product_code`.
- Tipagem do bundled catalog importado: estrutural, sem cast explícito. Aceitar enquanto há só 1 tenant; reforçar com validador runtime no boot quando SUPERARE entrar.

**Verificações:**
- `npx vitest run` em `backend/cloudflare/` — **199 testes passaram** (14 arquivos).
- `npm run typecheck` em `workers/funnel-dispatcher` — passou.
- `tsc --noEmit` standalone nos 2 ingress — passou.
- TOML parse dos 2 `wrangler.toml` — passou.

---

##### 2.6B — Migração JSON para multi-tenant (2026-05-14, corte 3)

`backend/cloudflare/config/products.catalog.json` foi migrado da estrutura legada `products.*` para `tenants.decole.products.*`:

- `schemaVersion` bumpado para `4`.
- `tenants.decole` declara `name`, `domains` (3 hostnames), `credentials` (`brevo_api_key_env: "BREVO_API_KEY"` legado temporário, `hotmart_token_env: "HOTMART_WEBHOOK_TOKEN"`, `replyToEmail`) e `products`.
- Códigos de produto **preservados** (`DECOLE_PLANOVOO`, `DECOLE_ESG_MENTORIA`) e aliases mantidos para backward compat — eventos sem `tenant_id` continuam resolvendo via alias fallback do adapter.
- Sem `products.*` top-level remanescente.
- 5 testes novos em `catalog-adapter.test.ts` validando o shape do catálogo bundled.

**Revisão Kent Beck — 1 MUST-FIX corrigido:**
- `backend/cloudflare/scripts/replay-emit-tracking.mjs:155` lia `catalog.products` direto e quebraria silenciosamente. Corrigido para iterar `catalog.tenants.*.products` também (mantém compat com catálogos legados).

**SHOULD-FIX pendentes (follow-up):**
- Risco de cross-contamination de tenant: quando `tenant_id` não é informado e múltiplos tenants têm produto com mesmo alias, vence o primeiro em ordem de inserção do JSON. Ainda inofensivo com tenant único; resolver antes do SUPERARE entrar.
- Naming de credenciais: catálogo usa `BREVO_API_KEY` legado temporário, mas o alvo multi-tenant é env var por tenant. Decidir a convenção antes do Red no Slice 2.11.

**Verificações:**
- `npm run typecheck` — passou.
- `npx vitest run workers/funnel-dispatcher/` — **139 testes passaram**.

#### Verificação

- Webhook PURCHASE_APPROVED → call_product_api → API Plano de Voo → send_template_email → email com link
- Webhook PURCHASE_REFUNDED → call_product_api → API Plano de Voo → send_template_email → email
- Dedup KV funciona com novos handler names

---

### Slice 2.7 — Ingress multi-tenant

**Arquivos modificados:**
```
workers/api-hotmart-ingress/src/index.ts
workers/api-funnel-ingress/src/index.ts
workers/api-hotmart-ingress/wrangler.toml    (novas routes)
workers/api-funnel-ingress/wrangler.toml     (novas routes)
test/unit/
  ingress-tenant.test.ts
```

Os 2 ingress workers precisam resolver o tenant_id a partir da URL e populá-lo no FunnelEvent antes de enfileirar.

#### Routes multi-domínio (Opção C: domínio do tenant)

```toml
# api-hotmart-ingress/wrangler.toml
routes = [
  # DECOLE
  { pattern = "api.decolesuacarreiraesg.com.br/webhooks/v1/*/hotmart/*", zone_name = "decolesuacarreiraesg.com.br" },
  # SUPERARE
  { pattern = "api.superare.com.br/webhooks/v1/*/hotmart/*", zone_name = "superare.com.br" },
]

# api-funnel-ingress/wrangler.toml
routes = [
  { pattern = "api.decolesuacarreiraesg.com.br/funnel/*", zone_name = "decolesuacarreiraesg.com.br" },
  { pattern = "api.superare.com.br/funnel/*", zone_name = "superare.com.br" },
]

# links-redirect/wrangler.toml
routes = [
  { pattern = "links.decolesuacarreiraesg.com.br/*", zone_name = "decolesuacarreiraesg.com.br" },
  { pattern = "links.superare.com.br/*", zone_name = "superare.com.br" },
]
```

**Requisito:** Cada domínio de tenant precisa ser uma zona ativa no Cloudflare.

#### 🔴 TDD Red

```
resolveTenantFromHostname("api.decolesuacarreiraesg.com.br") → "decole"
resolveTenantFromHostname("api.superare.com.br") → "superare"
resolveTenantFromHostname("links.decolesuacarreiraesg.com.br") → "decole"

Evento enfileirado contém tenant_id no FunnelEvent
Escopo não inclui auth Hotmart nem CORS por tenant; esses critérios pertencem ao Slice 2.11.
```

#### 🟢 Green

Worker extrai `hostname` do `request.url`, cruza com `tenants.{id}.domains[]` no catálogo, popula `event.tenant_id`.

---

### Slice 2.8 — Landing Pages passam tenant_id

**Arquivos modificados:**
```
site/index.html                    (ou JS de tracking inline)
site/planodevoo/index.html
```

As LPs enviam eventos para `api-funnel-ingress` (precheckout forms, browser tracking). Cada LP precisa incluir `tenant_id` no payload como defesa em profundidade, enquanto o ingress continua resolvendo o tenant primário por hostname.

**Abordagem:** Cada projeto Pages usa seu próprio domínio de tenant e envia `tenant_id` no form/payload. O hostname vence o payload quando o host é conhecido; payload só é aceito quando validado contra `catalog.tenants`.

```javascript
// LP DECOLE
const FUNNEL_ENDPOINT = "https://api.decolesuacarreiraesg.com.br/funnel/precheckout"
const TENANT_ID = "decole"

// LP SUPERARE (futuro)
const FUNNEL_ENDPOINT = "https://api.superare.com.br/funnel/precheckout"
const TENANT_ID = "superare"
```

#### 🔴 TDD Red

```
- LP DECOLE envia eventos com hidden input/payload `tenant_id=decole`
- Evento recebido pelo ingress contém tenant_id: "decole"
- CORS permite origin do tenant correto
```

#### 🟢 Green

Adicionar `tenant_id` nas LPs existentes e validar payload contra tenants conhecidos. Configurar CORS por tenant no Slice 2.11.

**Nota:** SUPERARE terá seu próprio projeto Cloudflare Pages com domínio próprio. As LPs da SUPERARE serão criadas quando o tenant for onboardado.

---

### Slice 2.9 — Remover packages/planovoo

**Arquivos removidos:**
```
packages/planovoo/              # todo o diretório
  src/PlanoVooRepository.ts
  src/PlanoVooService.ts
  src/PlanoVooNotificationService.ts
  src/factory.ts
  src/handlers.ts
  src/types.ts
  test/unit/*.test.ts
```

#### Verificação

- `npm run build` no workspace compila sem erros
- `npm test` passa sem referências a packages/planovoo
- Dispatcher funciona em staging sem packages/planovoo

---

## Resumo dos Slices

| # | Slice | Escopo | Risco | Status |
|---|-------|--------|-------|--------|
| 2.0 | **Extrair repo FunilMKT** | Repo próprio (`funil-mkt-platform`) via `git subtree split` | Médio | ✅ |
| 2.1 | PayloadMapper | Utility pura | Zero | ✅ |
| 2.2 | Tenant Resolution | Multi-tenancy | Baixo | ✅ |
| 2.3 | HandlerContext + tenant isolation | Propagação + KV/D1 prefix | Baixo | ✅ |
| 2.4 | call_product_api | Handler genérico | Baixo | ✅ |
| 2.5 | send_template_email | Handler genérico (Brevo por tenant) | Baixo | ✅ |
| 2.6 | Migrar catálogo multi-tenant | Restructure `tenants.*` | **Alto** | ✅ |
| 2.7 | Ingress multi-tenant | Routes + tenant extraction | Médio | ✅ |
| 2.8 | LPs passam tenant_id | Hidden input/payload validado + hostname como fonte primária | Baixo | ✅ |
| 2.9 | Remover packages/planovoo | Cleanup | Baixo | ✅ (nunca existiu no repo novo) |
| 2.10 | Isolamento de dados por tenant | D1 + KV prefixados por tenant | **Alto** | ✅ |
| 2.11 | Credenciais, auth e CORS por tenant | Brevo/Hotmart/origins por catálogo | **Alto** | Pendente |
| 2.12 | Links e routes multi-tenant | `links-redirect` + routes SUPERARE | Médio | Pendente |
| 2.13 | Hardening genérico | Email non-fatal + tipagem/validação catálogo | Médio | Pendente |
| 2.14 | CI e package hygiene | Typecheck e workflows por package | Médio | Pendente |
| 2.15 | Cleanup repo DECOLE | Publicar remoção do backend duplicado e docs/workflows antigos | Médio | Pendente |

---

## Isolamento de dados por tenant

| Recurso | Estratégia |
|---------|-----------|
| **KV keys** | Prefixo `{tenant_id}:` em todas as chaves (dedup, identity, recovery) |
| **D1 rows** | Coluna `tenant_id` em IDENTITY_DB e EVENT_STORE_DB |
| **Credenciais** | Env var nomeadas por tenant (`BREVO_API_KEY_DECOLE`, `BREVO_API_KEY_SUPERARE`) |
| **Webhook routing** | Hostname do tenant + path de produto/evento; payload/path não podem sobrescrever hostname conhecido |
| **Email sender** | Brevo API key e replyTo resolvidos do catálogo por tenant |

---

## Benefícios

### Novo produto — só JSON

Mentoria DECOLE: adicionar ao catálogo em `tenants.decole.products.DECOLE_ESG_MENTORIA`. Zero código de Worker.

### Novo tenant — só JSON + env vars

SUPERARE: adicionar bloco `tenants.superare` com credentials + products. Configurar env vars, zona/routes Cloudflare e smoke operacional. Zero código de Worker para casos cobertos pelo catálogo.

### Ingress webhook routing

```
POST https://api.decolesuacarreiraesg.com.br/webhooks/v1/planovoo/hotmart/* → tenant_id: "decole"
POST https://api.superare.com.br/webhooks/v1/{produto}/hotmart/*             → tenant_id: "superare"
```

O ingress resolve o tenant a partir do hostname e valida path/produto contra o catálogo antes de enfileirar.
