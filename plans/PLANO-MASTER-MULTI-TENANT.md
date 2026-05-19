# Plano Master — Multi-Tenant

> **Ponto de entrada autoritativo** para toda mudança no `funil-mkt-platform` que envolva multi-tenancy.
> **Status:** Em execução — 32/38 slices concluídos · Fases 0, 0.5, 1, 2, 2E e 3 completas · Fase 4 não iniciada (0/6) · Próximo: 2.11Z.1 (atualizado em 2026-05-19 por Claude Sonnet 4.6).
> **Source of truth de progresso:** [`STATUS-2.11.md`](./STATUS-2.11.md)

---

## Sumário executivo

O `funil-mkt-platform` evoluiu para suportar multi-tenancy (Slices 2.0–2.10 do PLANO-2 concluídos): o catálogo já tem estrutura `tenants.{id}.credentials`, o `tenant_id` é resolvido por hostname, e D1/KV são namespacados por tenant. Mas a operação real ainda está acoplada a um único tenant (DECOLE). Este plano resolve isso em 4 frentes paralelas (2.11A/B/C/D) com governance rigorosa, testes de regressão obrigatórios, e workflow agent-resumable.

**Resultado esperado:** ao final de 2.11Z.1 (validação cruzada), onboarding de novo tenant (ex: SUPERARE) = mudança apenas no catálogo + secrets + DNS + DNS no provedor do tenant. Zero código de worker.

---

## Decisões fundamentais

1. **Estrutura híbrida:** PLANO-2 atualizado (índice macro) + 4 satélites focados (cada um em `plans/`)
2. **Naming `{SECRET}_{TENANT}[_{PRODUCT}]`** — ex: `BREVO_API_KEY_DECOLE` (tenant), `META_PIXEL_ID_DECOLE_PLANOVOO` (produto)
3. **Tracking por escopo correto:**
   - **TENANT:** GTM Web container, sGTM endpoint (hub central que recebe do GTM Web e roteia por `produto`), GA4 property (measurement_id + api_secret), Meta CAPI access token
   - **PRODUTO:** Meta Pixel ID (audiências/conversões distintas), Meta Ad Account ID
4. **Dashboard-sync:** GA4 property + service account por TENANT; Meta access token por TENANT; Meta Ad Account por PRODUTO
5. **sGTM único da plataforma (Modelo B):** 1 container Cloud Run compartilhado com custom domains por tenant (`sgtm.decolesuacarreiraesg.com.br`, `sgtm.superare.com.br`) preservando first-party cookies. Lookup tables internas no container roteiam destinos por `tenant_id`/`produto`.
6. **Plano de Voo é single-tenant DECOLE** — produto exclusivo; outros tenants criarão app própria
7. **Cloudflare Secrets Store** (account-level) como source of truth de secrets de workers. Worker secrets per-worker tradicionais são legado a remover na Fase 4.
8. **Workers agnósticos:** conhecem CONVENÇÕES, NÃO conhecem TENANTS nem PRODUTOS hardcoded. Validado por `scripts/audit-workers-agnostic.sh` em CI.

---

## Índice de satélites

| Satélite | Caminho | Escopo | Slice |
|---|---|---|---|
| **PLANO-2-DISPATCHER-GENERICO** | [`PLANO-2-DISPATCHER-GENERICO.md`](./PLANO-2-DISPATCHER-GENERICO.md) | Arquitetura macro, decisões e história. **Slices 2.0-2.10 concluídos**, 2.11 split em A/B/C/D, 2.12-2.15 roadmap. | 2.0-2.15 |
| **PLANO-MULTI-TENANT-SECRETS-CONFIG** | [`PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](./PLANO-MULTI-TENANT-SECRETS-CONFIG.md) | Credenciais por tenant, schema v5, Secrets Store, princípio agnostic, testes de regressão | **2.11A** |
| **PLANO-SGTM-PLATAFORMA-COMPARTILHADO** | [`PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md`](./PLANO-SGTM-PLATAFORMA-COMPARTILHADO.md) | 1 sGTM compartilhado, custom domains, lookup tables, roadmap de backoffice | **2.11B** |
| **PLANO-LINKS-REDIRECT-MULTI-TENANT** | [`PLANO-LINKS-REDIRECT-MULTI-TENANT.md`](./PLANO-LINKS-REDIRECT-MULTI-TENANT.md) | Remove hardcode de paths, contatos WhatsApp, URLs Hotmart do `links-redirect` | **2.11C** |
| **PLANO-DASHBOARD-SYNC-MULTI-TENANT** | [`PLANO-DASHBOARD-SYNC-MULTI-TENANT.md`](./PLANO-DASHBOARD-SYNC-MULTI-TENANT.md) | dashboard-sync itera catálogo, tenant_id em D1, cron multi-tenant | **2.11D** |
| **PLANO-MKT-DASHBOARD-MULTI-TENANT** | [`PLANO-MKT-DASHBOARD-MULTI-TENANT.md`](./PLANO-MKT-DASHBOARD-MULTI-TENANT.md) | Rename decole-dashboard→mkt-dashboard; queries com tenant_id; auth por tenant via Secrets Store | **2.11E** |
| **PLANO-STAGING-FUNIL-LANDING-PLANOVOO** | [`PLANO-STAGING-FUNIL-LANDING-PLANOVOO.md`](./PLANO-STAGING-FUNIL-LANDING-PLANOVOO.md) | Ambiente de staging isolado (revisão cirúrgica posterior — ver satélite 1 seção 10) | follow-up |
| **PLANO-1-SEPARACAO-RESPONSABILIDADES** | [`completed/PLANO-1-SEPARACAO-RESPONSABILIDADES.md`](./completed/PLANO-1-SEPARACAO-RESPONSABILIDADES.md) | ✅ Concluído 2026-05-14 — APIs de hooks no Plano de Voo com HMAC | (arquivado) |

---

## G. Governance & Guard Rails

Esta seção define **princípios, processo e gates** que governam tanto a execução deste plano (2.11A/B/C/D) quanto toda mudança futura no funil-mkt-platform que se enquadre nos temas multi-tenant.

### G.1 Princípios fundamentais (não-negociáveis)

1. **Catalog-driven:** `config/products.catalog.json` é fonte de verdade declarativa de tenants, produtos, integrações, tracking, links. Toda config específica vive no catálogo, não em código.
2. **Workers agnostic (satélite 1 seção 8.1):** workers conhecem CONVENÇÕES, não conhecem TENANTS nem PRODUTOS hardcoded. Validado por `scripts/audit-workers-agnostic.sh` em CI.
3. **Fail-fast > fallback silencioso:** ausência de config esperada gera erro explícito + warning log + 4xx (não fallback para DECOLE). Catch para regressão de "tenant errado processado como DECOLE silenciosamente".
4. **Single source of truth por secret/config:** cada valor vive em **um lugar**. Cloudflare Secrets Store para workers; lookup tables internas para sGTM; docker-compose env para app Plano de Voo. Nada de duplicação.
5. **Type safety strict:** TypeScript strict mode em todos os workers e packages. `any` exige justificativa em comentário.
6. **Cross-tenant isolation TESTADO:** não suposto. `cross-tenant-isolation.test.ts` é critério obrigatório (satélite 1 seção 11.4.3) e roda em CI.
7. **Naming convention rigorosa:** `{SECRET}_{TENANT}[_{PRODUCT}]`. Auditado por `scripts/audit-secrets.sh`.

### G.2 TDD por slice (Red → Green → Refactor → **Review**)

- **Red:** cada slice começa com teste falhando documentando o comportamento desejado. **Commit Red separado do Green** — TDD verificável no histórico.
- **Green:** implementação mínima para passar.
- **Refactor:** simplificar/melhorar com teste ainda verde.
- **Review (G.12):** agente especialista revisa código, arquitetura e testes **antes de marcar slice como DONE**. Bloqueante — slice não fecha sem aprovação do revisor.

> ⛔ **GUARD RAIL — não avançar para próximo slice sem revisão G.12 completa.**
> O agente implementador NÃO pode auto-aprovar slices de Fase 0.5 em diante.
> Revisão obrigatória = lançar agente separado via `Agent(subagent_type="claude", run_in_background=true)`.
> Se a revisão não tiver sido executada, o próximo slice não começa. Sem exceções.
- **Golden master** para handlers críticos (emit_tracking, call_product_api, send_template_email): snapshot do payload exato; refactor não muda payload silenciosamente.
- **Fixtures versionadas** em `test/fixtures/` — payloads reais (anonimizados) de Hotmart, Brevo, GA4, sGTM.
- **Mocks isolados:** não compartilhar state entre tests (cada `it()` é independente).

### G.3 Slicing fino (cada slice ≤ 1 dia de trabalho)

Estrutura obrigatória por slice (template completo em [`SLICE-TEMPLATE.md`](./SLICE-TEMPLATE.md)):

- Status (TODO/IN_PROGRESS/DONE/BLOCKED/ROLLED_BACK)
- Contexto + Pré-requisitos + Mudança (arquivos:linhas) + Testes + Validação executável + Smoke checklist + Rollback
- **Execução append-only** (timestamps + agent ID)
- Gotchas / lições aprendidas
- Decisões tomadas (delta vs plano)

Slices muito grandes (> 1 dia) devem ser divididos antes de começar. Validação humana entre slices.

### G.4 Estratégia de testes

| Nível | Ferramenta | Roda em | Bloqueante |
|---|---|---|---|
| Unit | Vitest em cada worker | Local + CI (PR) | Sim |
| E2E interno | wrangler dev + queries D1/KV | CI (PR) | Sim |
| E2E externo staging | GitHub Action contra staging real | CI (push staging) | Sim |
| Smoke prod | Manual + logs Cloudflare | Após cada deploy disruptivo | Sim (48h verde) |
| Validação humana | Owner do projeto | Entre slices | Sim |

Detalhe completo no satélite 1 seção 11.

### G.5 CI gates obrigatórios

Workflow `.github/workflows/ci-multitenant-gates.yml` (entregável de 2.11T.6):

```yaml
gates:
  - typecheck (npm run typecheck em cada worker)
  - unit tests (npx vitest run em cada worker)
  - audit-secrets.sh (catálogo vs Cloudflare Secrets Store)
  - audit-workers-agnostic.sh (grep validation nos 5 workers)
  - catalog-schema-validate.sh (JSON schema validation do products.catalog.json)
  - cross-tenant-isolation.test.ts (gate obrigatório)
  - pr-e2e-multitenant.yml (wrangler dev + smoke)
  - check-master-coherence.sh (PR que muda código alinhado consulta plano)
  - check-status-coherence.sh (STATUS bate com commits e estado real)
```

Qualquer falha **bloqueia merge**. Não há override sem aprovação manual + justificativa em PR.

### G.6 Audit log e rastreabilidade

- **Catálogo:** cada mudança via PR com review obrigatório. Histórico em git.
- **Secrets Store:** audit log nativo do Cloudflare (quem acessou qual secret, quando).
- **Cloud Run sGTM:** Cloud Logging com label `tenant_id` injetado em toda request.
- **D1:** colunas `tenant_id` e `created_at`/`updated_at` em rows novas.
- **Workers Logs (Logpush R2):** estruturado JSON com `tenant_id`, `product_code`, `event_id`, `handler`, `stage` em toda log line.
- **Onboarding de tenant:** registrado em `plans/onboardings/{tenant_id}-{date}.md` com data, owner, smoke checklist completo.

### G.7 Rollback strategy por slice

- Cada slice fecha em commit identificável (`feat(2.11A.3): refactor resolveTrackingConfig`).
- Rollback = `git revert <commit>` + `wrangler deploy` do estado anterior.
- **Janela de coexistência (Fase 1 → 4)** permite rollback gracioso sem perda de dados — fallback ativo em ambos os lados.
- Smoke verde por 48h antes de avançar próximo slice; smoke vermelho dispara rollback automático (ou alerta para owner decidir).
- **Hotfix path:** branch `hotfix/*` com fast-track de CI (skip e2e externo) em emergência confirmada.

### G.8 Branch protection e workflow Git

- `main` protegida: PR obrigatório + 1 approval + CI green.
- Slices vivem em feature branches: `feature/2.11A.3-resolve-tracking-tenant`.
- Cada slice = 1 PR. PRs grandes (> ~400 LOC) devem ser quebrados.
- Commit messages: `<type>(<slice>): <descrição>` (ex: `refactor(2.11A.3): resolveTrackingConfig lê GA4 do tenant`).
- Tags por slice fechado: `v2.11A.3-stable` após 48h verde.

### G.9 Política do plano master

**Localização:** este arquivo (`plans/PLANO-MASTER-MULTI-TENANT.md`)

**Quando consultar/atualizar (obrigatório):**

Toda mudança no funil-mkt-platform que envolva qualquer dos temas abaixo **DEVE** consultar o master + atualizar se diverge:
- Adicionar/remover tenant
- Adicionar/remover produto
- Adicionar/remover worker
- Mudar naming de secret (`{SECRET}_{TENANT}[_{PRODUCT}]`)
- Mudar schema do `products.catalog.json` (qualquer schema bump)
- Mudar comportamento de tracking (sGTM, GA4, Meta CAPI)
- Adicionar/remover integração (n8n, planovoo, qualquer integration nova)
- Mudar estratégia de testes ou guard rails

**Como atualizar:** PR no funil-mkt-platform tocando `plans/PLANO-MASTER-MULTI-TENANT.md` + satélite(s) afetado(s). Review do owner obrigatório.

**Sinal de drift:** se PR muda código que se enquadra acima MAS não atualiza o master, CI flagueia (script `scripts/check-master-coherence.sh`).

### G.10 Validação humana entre marcos

Owner do projeto valida explicitamente entre fases:
- Fim de Fase 0 → ready for Fase 0.5? (catálogo v5 deployado, baseline OK)
- Fim de Fase 0.5 → ready for Fase 1? (testes verdes, golden masters registrados)
- Fim de Fase 1 → ready for Fase 2? (secrets duplicados, fallbacks ativos, smoke baseline)
- Fim de Fase 2 → ready for Fase 3? (todos os refactors verdes em testes, golden masters preservados)
- Fim de Fase 3 → ready for Fase 4? (48-72h verdes em cada deploy disruptivo)
- Fim de Fase 4 → 2.11 completo? (grep zero matches, fallbacks removidos, smoke E2E cross-tenant verde)

**Não pular validação.** Slice que avança sem aprovação = bug em pipeline.

### G.11 Continuidade entre agentes (Agent-resumable workflow)

**Princípio:** qualquer agente (Claude Code, ChatGPT, outro Claude, humano) deve poder retomar o trabalho **sem contexto prévio da sessão anterior**. O plano é o contexto.

**Regras operacionais (mandatórias):**

1. **Todo agente que executa slice DEVE atualizar:**
   - Status do slice (TODO → IN_PROGRESS → DONE)
   - Seção `Execução` do slice (append-only com timestamp + agent ID)
   - `STATUS-2.11.md` (slice em progresso + queue + bloqueios se houver)
   - Commit referenciado no slice (`git commit -m "feat(2.11A.3): ..."`)

2. **Decisões tomadas durante execução** que divergem do plano:
   - Documentar em `STATUS-2.11.md` seção "Decisões"
   - Atualizar slice file (Contexto / Mudança) refletindo a realidade
   - Se afeta outros slices: atualizar slice files afetados
   - Se afeta plano master: atualizar PLANO-MASTER

3. **Antes de fechar slice (status DONE):**
   - Critério de aceite executável passa (rodar comando, capturar output)
   - Testes verdes (output do `vitest run`)
   - Smoke checklist preenchido (se aplicável)
   - Commit hash registrado
   - STATUS.md atualizado com próximo slice

4. **Se ficar BLOCKED:**
   - Documentar bloqueio em STATUS.md
   - Listar ação necessária (humano ou outro slice precedente)
   - Não avançar próximo slice se dependência não resolvida

5. **Agente novo retomando trabalho:**
   - Ler PLANO-MASTER → STATUS → slice em progresso → continuar
   - **Nunca assumir contexto** que não está em arquivo
   - Se algo não bater (commits vs status), pause + alertar humano

**Estrutura de arquivos:**

```
plans/
├── PLANO-MASTER-MULTI-TENANT.md     ← este arquivo
├── STATUS-2.11.md                   ← source of truth de progresso
├── SLICE-TEMPLATE.md                ← template canônico
├── PLANO-*.md                       ← satélites
├── slices/{2.11A,B,C,D,T,Z}/{N-...}.md  ← slice files individuais
├── onboardings/{tenant}-{date}.md   ← registro de onboarding
└── completed/                       ← planos arquivados
```

**Script de drift detection** (`scripts/check-status-coherence.sh`, entregável de Fase 4):
- Verifica que slices marcados DONE têm commits correspondentes
- Verifica que STATUS.md aponta para slice válido em IN_PROGRESS
- Verifica que critério de aceite de slices DONE passa (re-executa greps + testes)
- Falha CI se incoerente

**Benefício:** trabalho de meses pode ser dividido entre agentes diferentes / sessões diferentes / humanos diferentes sem perda de contexto. Onboarding de agente novo = 15 min de leitura.

### G.12 Agente especialista revisor (Code + Architecture + Tests)

**Posição no ciclo:** após Refactor (G.2), antes de marcar slice como DONE. **Bloqueante** — sem aprovação do revisor, slice permanece IN_PROGRESS.

**Propósito:** garantir que nenhum slice introduz dívida técnica oculta, viola princípios do catálogo, enfraquece isolamento de tenant, ou deixa testes insuficientes para detectar regressão. O revisor é agnóstico ao contexto da sessão — lê apenas os arquivos modificados e as decisões registradas no slice file.

**Quem é o revisor:** um agente Claude (`claude-code-guide` ou `claude` com system prompt especializado em TypeScript + DDD + Cloudflare Workers). Pode ser o mesmo agente que implementou ou um agente separado — o importante é que a revisão seja feita **depois do Refactor** com os olhos de quem não fez o trabalho.

**O revisor verifica obrigatoriamente:**

1. **Código TypeScript**
   - Strict mode respeitado (sem `any` não justificado, sem `!` non-null assertion sem comentário)
   - Funções puras preferidas a side effects ocultos
   - Nomes expressivos (sem abreviações opacas)
   - Erros tratados explicitamente (fail-fast, mensagem clara com nome do secret/tenant)
   - Sem acoplamento a `DECOLE`, `PLANOVOO`, `ESG` ou qualquer tenant/produto (princípio agnostic G.1 + G.8.1 do satélite 1)

2. **Arquitetura**
   - Catálogo como fonte de verdade: toda config específica de tenant/produto lida do catálogo, não hardcoded
   - Workers agnósticos: `grep -rE "DECOLE|PLANOVOO|..." src/` deve retornar 0 matches (exceto comentários de design)
   - Secrets resolvidos via `resolveSecret()` (não `env.X` direto) quando binding disponível
   - Nenhum fallback silencioso para DECOLE/tenant default em runtime de produção
   - Isolamento de tenant verificável: o mesmo código que serve DECOLE serviria SUPERARE sem mudança, só com config diferente no catálogo

3. **Testes**
   - TDD Red verificável no histórico (commit de testes antes da implementação)
   - Cobertura de happy path + edge cases + fail-fast paths
   - Mocks isolados entre testes (sem state compartilhado)
   - Teste de isolamento entre tenants (não serve dado de tenant A para tenant B)
   - Nomes de testes descrevem comportamento (not `test 1`, `test 2`)
   - Sem `it.only` ou `describe.skip` esquecidos

4. **Slice file**
   - Seção `Execução` preenchida (append-only)
   - Decisões tomadas documentadas (delta vs plano)
   - Gotchas registrados para próximos agentes
   - Critério de aceite executável passou

**Como registrar o resultado da revisão:**

O revisor escreve no slice file (append-only na seção `Execução`):

```
### YYYY-MM-DD HH:MM by Revisor <agent-type>

**REVISÃO G.12**

Código: ✅ OK | ⚠️ Ressalvas (listar) | ❌ Bloqueado (listar)
Arquitetura: ✅ OK | ⚠️ Ressalvas | ❌ Bloqueado
Testes: ✅ OK | ⚠️ Ressalvas | ❌ Bloqueado

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO

[Se aprovado com ressalvas]: itens a resolver no próximo refactor ou slice seguinte:
- ...

[Se reprovado]: o que deve ser corrigido antes de marcar DONE:
- ...
```

**Critérios de resultado:**
- **APROVADO:** slice pode ser marcado DONE e slice file commitado.
- **APROVADO COM RESSALVAS:** marcado DONE, ressalvas viram TODO no próximo slice ou issue no backlog. O humano decide se aceita.
- **REPROVADO:** slice volta para IN_PROGRESS; agente implementador corrige e solicita nova revisão.

**Exceção para slices de Fase 0 (fundação):** slices 2.11A.0, 2.11A.1, 2.11B.1, 2.11D.1 são não-disruptivos e de baixo risco — revisão informal (agente implementador auto-revisa com checklist G.12) é aceita. A partir da Fase 0.5 e Fase 2, revisão por agente separado é obrigatória.

---

## Ordem de execução (após aprovação)

**Importante:** o trabalho é organizado em **fases por natureza de risco**:

### FASE 0 — Preparação (não disruptivo; tudo paralelo)

Constrói fundação sem mudar comportamento de produção.

```
[A] 2.11A.0  Cloudflare Secrets Store: criar store account-level (vazio)
             + helper wrapper no packages/shared (lê via env.X.get() com
             fallback para env.X string)
[A] 2.11A.1  Catálogo v5: adicionar campos novos MANTENDO antigos.
             catalog-adapter lê novos com fallback total ao v4.
[B] 2.11B.1  Auditar config atual do sGTM DECOLE: baseline.
[D] 2.11D.1  Migration D1: ALTER TABLE adiciona tenant_id em
             ga4_daily_metrics e meta_daily_metrics (DEFAULT 'decole').
```

### FASE 0.5 — Cobertura mínima de regressão (BLOQUEANTE para Fase 2)

Detalhamento completo em **satélite 1, seção 11**. Estimativa: **3-5 dias**.

```
[T] 2.11T.1  catalog-adapter.test.ts
[T] 2.11T.2  secrets-store-wrapper.test.ts
[T] 2.11T.3  cross-tenant-isolation.test.ts (TESTE MAIS IMPORTANTE)
[T] 2.11T.4  emit-tracking-payload.test.ts (golden master)
[T] 2.11D.0  dashboard-sync test harness mínimo
[T] 2.11T.5  Atualizar mocks existentes (env.X → ctx.credentials.X)
[T] 2.11T.6  GitHub Action pr-e2e-multitenant.yml + ci-multitenant-gates.yml
```

### FASE 1 — Popular novos secrets + bindings (não disruptivo)

```
[A] 2.11A.2  Popular secrets _DECOLE no Secrets Store + bindings
             em wrangler.toml dos 5 workers. Worker secrets antigos
             continuam como fallback.
```

### FASE 2 — Refactor (testes unit; não toca prod)

Cada bloco é commit isolado com testes verdes localmente. **Sem deploy.**

```
[A] 2.11A.3  Refactor resolveTrackingConfig (sGTM/GA4/MetaCAPI do tenant)
[A] 2.11A.4  Refactor handlers Brevo (ctx.credentials)
[A] 2.11A.5  Refactor forward_n8n + call_product_api + LINKS_BASE_URL +
             isPlanovooProductCode + replyToEmail
[A] 2.11A.7-prep  Refactor api-hotmart-ingress (inverter ordem + catalog lookup)
[A] 2.11A.8-prep  Refactor api-funnel-ingress (CORS catalog + appWebhooks)
[B] 2.11B.2  Refatorar workspace sGTM em PREVIEW
[B] 2.11B.3  Validar workspace em preview com tenant fake superare-test
[C] 2.11C.1  links-redirect refactor (bundle catálogo + lookup routes/contacts)
[D] 2.11D.2  dashboard-sync refactor runSync (loops aninhados, ?tenant=)
[E] 2.11E.1  mkt-dashboard: rename total (pasta, git, package.json, wrangler, strings)
[E] 2.11E.2  mkt-dashboard: lib/d1.ts com tenant_id em todas as queries
[E] 2.11E.3  mkt-dashboard: API routes com repasse ?tenant= ao worker
[E] 2.11E.5  mkt-dashboard: auth por tenant (ADMIN_SECRET_{TENANT} + login)
```

### FASE 3 — Deploys disruptivos (janela 48h cada)

**Ordem do menos crítico para mais crítico:**

```
[A] 2.11A.6  Deploy funnel-dispatcher prod + smoke E2E
[B] 2.11B.4  Publicar workspace sGTM prod + smoke
[A] 2.11A.7  Deploy api-hotmart-ingress + smoke webhook real
[A] 2.11A.8  Deploy api-funnel-ingress + smoke CORS browser
[C] 2.11C.2  Deploy links-redirect + smoke todas URLs conhecidas
[D] 2.11D.3  Deploy dashboard-sync + backfill sanity check
[E] 2.11E.4  Deploy mkt-dashboard + smoke DECOLE
```

### FASE 4 — Validação cruzada + limpeza (após Fase 3 estável por 72h)

```
[Z] 2.11Z.1  Smoke E2E cross-slice com tenant fake superare-test
[A] 2.11A.9  audit-secrets em CI + remover worker secrets antigos +
             remover fallbacks + validar grep workers agnostic
[B] 2.11B.5  Documentar runbook onboarding tenant em RUNBOOK-ONBOARDING-TENANT.md
[C] 2.11C.3  links-redirect remove env vars antigas + validar grep
[D] 2.11D.4  dashboard-sync remove fallbacks + secrets antigos
[E] 2.11E.5  Auth por tenant: ADMIN_SECRET_{TENANT} + login com seleção de tenant
[E] 2.11E.6  Smoke auth cross-tenant + remover ADMIN_SECRET global
```

### Resumo de dependências

```
Fase 0 ─┬─ [A: Store + catálogo v5] ─┐
        ├─ [B: auditar sGTM]         │
        └─ [D: migration D1]         │
                                     ▼
Fase 0.5 ── [T: testes de regressão] ── GATE
                                     ▼
Fase 1 ── [A: popular secrets + bindings]
                                     ▼
Fase 2 ─┬─ [A: refactors dispatcher/ingress] ─┐
        ├─ [B: refatorar GTM preview]         │  ✅ DONE
        ├─ [C: refatorar links-redirect]      │
        └─ [D: refactor runSync]              ┘
                                     ▼
Fase 2E ── [E: rename mkt-dashboard + queries + auth model] ── em andamento
                                     ▼
Fase 3 ── [A/B/C/D/E: deploys disruptivos workers + dashboard]
                                     ▼
Fase 4 ── [Z/A/B/C/D/E: validação cruzada + limpeza + auth smoke]
                                     ▼
        Bloqueador SUPERARE liberado
```

**Critical path:** ~3.5-4 semanas com paralelismo. Fase 0.5 adiciona ~3-5 dias bloqueante.

**Bloqueador para SUPERARE:** Fase 4 (2.11Z.1) verde.

---

## Postmortems e Incidentes

### PM-2026-05-19 — identity_links sobrescrevia email anterior no mesmo browser

**Status:** RESOLVIDO em produção em 2026-05-19.

**Resumo:** um submit novo com `adilsonchicoriajardim@gmail.com`, no mesmo browser e com o mesmo telefone usado anteriormente por `chicoria@gmail.com`, fez o dashboard deixar de encontrar a jornada por `chicoria@gmail.com`. Os eventos antigos não foram perdidos: continuavam em `funnel_events` no mesmo `profile_id`, mas o lookup por email no dashboard dependia de `identity_links.email_hash`, que tinha sido trocado pelo hash do email novo.

**Impacto:**
- Busca de User Journey por email antigo retornava "Perfil não encontrado".
- Journey por email novo apontava para o `profile_id` com toda a timeline histórica.
- Escopo observado: tenant `decole`, `profile_id=207223d0-2ee9-455e-a337-0390815c7640`.
- Sem evidência de perda de eventos em `funnel_events`; o incidente foi de índice/lookup de identidade.

**Causa raiz:**
- `identity_links` estava modelada como uma linha única por `(tenant_id, profile_id)`.
- `resolve_identity` dava prioridade ao `anonymous_id` do browser e fazia upsert da mesma linha, substituindo `email_hash`.
- O modelo permitia "um perfil tem um email atual", mas o comportamento real exige "um perfil pode ter múltiplos aliases de email e anonymous_id".
- `findProfileByEmailHash` no `mkt-dashboard` buscava só em `identity_links`; quando o alias antigo sumia, não havia fallback para `funnel_events`.

**Correção aplicada:**
- `identity_links` passou a armazenar aliases independentes:
  - linha por `(tenant_id, anonymous_id)` apontando para `profile_id`
  - linha por `(tenant_id, email_hash)` apontando para `profile_id`
- `idx_identity_links_tenant_profile` deixou de ser único; `anonymous_id` e `email_hash` continuam únicos por tenant.
- `resolve_identity` passou a preservar aliases antigos e inserir/atualizar alias de email separadamente.
- `mkt-dashboard` passou a consultar `identity_links` com `tenant_id` e usar `funnel_events` como fallback para hashes históricos.
- D1 remoto reparado manualmente:
  - backup criado: `identity_links_backup_20260519`
  - migration registrada: `2026-05-19_identity_links_alias_rows`
  - alias de `chicoria@gmail.com` reinserido para o mesmo `profile_id`.

**Deploy/validação executada:**
- `decole-funnel-dispatcher` publicado com a correção: version ID `7467338d-8b6f-454d-8eed-6d6672b36802`.
- `mkt-dashboard` publicado no projeto Pages ativo `decole-dashboard`.
- Testes:
  - `workers/funnel-dispatcher`: `npm test` → 177 passed.
  - `workers/funnel-dispatcher`: `npm run test:migration` → cobre mesmo browser + dois emails, 2 passed.
  - `workers/funnel-dispatcher`: `npm run typecheck` → OK.
  - `mkt-dashboard`: `npx vitest run lib/d1.test.ts` → 11 passed.
  - `mkt-dashboard`: `npx tsc --noEmit` → OK.
- Smoke prod:
  - busca por `chicoria@gmail.com` redireciona para `/dashboard/user/207223d0-2ee9-455e-a337-0390815c7640`
  - busca por `adilsonchicoriajardim@gmail.com` redireciona para o mesmo `profile_id`
  - página final da journey retorna HTTP 200.

**Slices relacionados:**
- **2.11D.1 — Migration D1 tenant_id em métricas:** não causou o bug diretamente, mas deixou explícito que migrations D1 precisam cobrir invariantes semânticos, não só isolamento por tenant.
- **2.11T.3 — cross-tenant-isolation.test.ts:** continua essencial para isolamento entre tenants, mas não cobria identidade intra-tenant com múltiplos emails no mesmo browser. O caso deve entrar como regressão de identity stitching.
- **2.11E.2 — mkt-dashboard D1 queries com tenant_id:** a decisão original dizia que `findProfileByEmailHash` ficaria sem `tenant_id` por tratar `IDENTITY_DB` como cross-tenant; este incidente invalida essa premissa. Lookup de identidade no dashboard deve ser sempre tenant-scoped.
- **2.11A.6 — Deploy funnel-dispatcher prod + smoke E2E:** deve incorporar smoke de identity aliasing antes de avançar Fase 3.
- **2.11E.4 — Deploy mkt-dashboard + smoke DECOLE:** deve incluir busca de User Journey por email antigo e email novo que apontem ao mesmo `profile_id`.
- **2.11Z.1 — Smoke E2E cross-slice:** deve cobrir o fluxo completo: lead email A → novo submit email B no mesmo browser → ambos os emails resolvem a mesma jornada sem apagar aliases.

**Ações preventivas:**
- [ ] Criar slice/teste de regressão para identity aliasing intra-tenant: mesmo `anonymous_id`, emails diferentes, mesma jornada acessível pelos dois hashes.
- [ ] Atualizar o slice `2.11E.2` ou criar adendo registrando que `findProfileByEmailHash` agora é tenant-scoped.
- [ ] Atualizar smoke checklist de `2.11A.6`, `2.11E.4` e `2.11Z.1` com o caso de múltiplos aliases.
- [ ] Criar audit D1 periódico: emails presentes em `funnel_events.email_hash` sem alias correspondente em `identity_links`.
- [ ] Decidir retenção/remoção do backup `identity_links_backup_20260519` após janela de observação.

### PM-2026-05-19B — DOI bloqueado por SMS duplicado e unsubscribe transacional

**Status:** RESOLVIDO em produção em 2026-05-19.

**Resumo:** após o submit de `adilsonchicoriajardim@gmail.com`, o lead foi gravado e processado, mas o email de cadastro/DOI não chegou. O evento `BEGIN_CHECKOUT` existia no site, mas não havia webhook Hotmart `PURCHASE_OUT_OF_SHOPPING_CART`; portanto não havia gatilho real de abandono de carrinho para esse email.

**Impacto:**
- O contato `adilsonchicoriajardim@gmail.com` foi criado na Brevo sem entrar na lista DOI `7`.
- O email de cadastro ficou bloqueado inicialmente por erro de contato e, depois, por unsubscribe transacional prévio.
- O email de abandono de carrinho não deveria ter sido enviado porque não existia evento `PURCHASE_OUT_OF_SHOPPING_CART` em `funnel_events` para esse email.

**Causa raiz:**
- `buildBrevoDoiAttributes` incluía `SMS` no payload do DOI.
- A Brevo rejeita criação/DOI quando o mesmo `SMS` já está associado a outro contato; neste caso, o telefone estava no contato `chicoria@gmail.com`.
- O handler `send_brevo_doi` registrava warning e seguia a cadeia; depois, `update_brevo_funnel` criava/atualizava o contato sem lista DOI, mascarando a falha operacional.
- Após reenvio manual sem `SMS`, a Brevo ainda bloqueou o envio porque `adilsonchicoriajardim@gmail.com` estava em `smtp/blockedContacts` com `unsubscribedViaEmail`, confirmado pelo humano como clique próprio em unsubscribe anterior.

**Correção aplicada:**
- `createBrevoDoiContact` agora detecta erro Brevo `duplicate_parameter` relacionado a `SMS` e refaz o DOI sem o atributo `SMS`, preservando `email`, `includeListIds`, `redirectionUrl`, `templateId` e demais atributos de funil.
- Novo teste unitário cobre a regressão: primeira chamada DOI falha por `SMS` duplicado e a segunda chamada é enviada sem `SMS`.
- `decole-funnel-dispatcher` republicado com a correção: version ID `0b862b4e-225b-49b1-9fab-10fdc73236d8`.
- Com autorização humana, o bloqueio transacional de `adilsonchicoriajardim@gmail.com` foi removido na Brevo e o DOI foi reenviado sem `SMS`.

**Validação executada:**
- D1 remoto confirmou eventos para `adilsonchicoriajardim@gmail.com`: `GENERATE_LEAD` e `BEGIN_CHECKOUT` em 2026-05-19; nenhum `PURCHASE_OUT_OF_SHOPPING_CART`.
- Brevo retornou `204` no desbloqueio transacional e `204` no reenvio DOI.
- `smtp/blockedContacts` deixou de listar `adilsonchicoriajardim@gmail.com`.
- Eventos SMTP Brevo passaram a mostrar novo `requests` para template `1` em `2026-05-19T11:00:00.922-03:00`, sem novo `blocked`.
- Testes:
  - `workers/funnel-dispatcher`: `npx vitest run test/unit/index.test.ts -t "DOI"` → 5 passed.
  - `workers/funnel-dispatcher`: `npm run typecheck` → OK.
  - `workers/funnel-dispatcher`: `npm test` → 178 passed.

**Slices relacionados:**
- **2.11A.4 — Refactor handlers Brevo:** deve tratar erros recuperáveis de APIs externas sem mascarar falhas críticas de consentimento/lista.
- **2.11A.6 — Deploy funnel-dispatcher prod + smoke E2E:** smoke deve validar DOI com telefone já usado por outro contato e conferir eventos Brevo, não só fila/D1.
- **2.11T.4 — emit-tracking-payload.test.ts/golden masters:** complementar com golden de payload DOI Brevo para garantir atributos sensíveis como `SMS` não quebrem fluxos multi-contato.
- **2.11T.5 — Atualizar mocks existentes:** mocks Brevo devem incluir `duplicate_parameter` e blocked/unsubscribed para cobrir caminhos reais.
- **2.11Z.1 — Smoke E2E cross-slice:** fluxo completo deve distinguir `BEGIN_CHECKOUT` de site e `PURCHASE_OUT_OF_SHOPPING_CART` de Hotmart antes de esperar email de abandono.

**Ações preventivas:**
- [ ] Criar audit/alerta para `handler_warn` em `brevo_doi`, especialmente `duplicate_parameter`, `unsubscribedViaEmail` e falhas de lista DOI.
- [ ] Criar smoke Brevo DOI que use telefone duplicado controlado e confirme fallback sem `SMS`.
- [ ] Documentar runbook de resubscribe transacional: só remover `smtp/blockedContacts` com autorização explícita do titular/humano responsável.
- [ ] Adicionar dashboard/relatório de leads com `GENERATE_LEAD` processado mas sem entrada na lista DOI esperada após janela definida.
- [ ] Rever templates/IDs de carrinho abandonado no catálogo versus Brevo (`8` no catálogo ESG; eventos antigos observados com template `9`) antes de fechar o smoke de abandono.

---

## Próxima ação concreta

Para o próximo agente / humano:

1. **Confirmar recovery point** em `STATUS-2.11.md` e git.
2. Criar/executar `2.11Z.1` — smoke E2E cross-slice com tenant fake `superare-test`.
3. Se `2.11Z.1` passar, avançar limpezas Fase 4: `2.11A.9`, `2.11B.5`, `2.11C.3`, `2.11D.4`, `2.11E.6`.

---

## Histórico

- **2026-05-18:** Plano master criado. Aprovação inicial pelo humano. Pré-execução.
- **2026-05-18 ~18:03 WEST:** 2.11A.5 concluído. `funnel-dispatcher` agora resolve `call_product_api`, links de carrinho e `replyToEmail` sem fallback runtime hardcoded para DECOLE; próximo slice é `2.11A.7-prep`.
- **2026-05-18 ~20:02 WEST:** 2.11A.7-prep concluído. `api-hotmart-ingress` agora resolve tenant/produto/token via catálogo e Secrets Store, sem fallback runtime hardcoded para DECOLE; próximo slice é `2.11A.8-prep`.
- **2026-05-18 ~20:13 WEST:** 2.11A.8-prep concluído. `api-funnel-ingress` agora resolve tenant, CORS e app webhooks por catálogo, sem `ALLOWED_ORIGINS`/`DEFAULT_TENANT_ID`/`APP_EVENTS_HMAC` no runtime; próximo slice é `2.11B.2`.
- **2026-05-18 ~20:29 WEST:** 2.11B.2 concluído. Workspace sGTM preview `codex-2.11B.2-multitenant-preview` (`workspaceId=24`) preparado com lookups por tenant/produto e tags GA4/Meta dinâmicas, sem publish produção; próximo slice é `2.11B.3`.
- **2026-05-18:** 2.11B.3 concluído. Workspace 24 validado com 5 lookup tables completas para DECOLE e tenant fake `superare-test`; isolamento cross-tenant confirmado (0 vazamentos); 2 entradas placeholder faltantes corrigidas; próximo: `2.11C.1` ou `2.11D.2`.
- **2026-05-18:** 2.11C.1 concluído. `links-redirect` agnóstico — resolve tenant do hostname, rotas e contatos do catálogo; remove todos os hardcodes DECOLE/ELIZETE; 28/28 testes verdes; grep 0 matches.
- **2026-05-18:** 2.11D.2 concluído. `dashboard-sync` dividido em 5 módulos SoC (types/catalog/ga4/meta/sync-runner); runSync itera catálogo; ?tenant= fail-fast 400; 24/24 testes verdes; grep 0 matches. **Fase 2 completa (9/9).** Próximo: validação humana G.10 → Fase 3.
- **2026-05-18:** Satélite 2.11E criado — `PLANO-MKT-DASHBOARD-MULTI-TENANT.md`. Rename total `decole-dashboard→mkt-dashboard` (Frente A, Fase 3) + auth por tenant via `ADMIN_SECRET_{TENANT}` no Secrets Store (Frente B, Fase 4). 6 novos slices (2.11E.1–6) adicionados ao plano.
- **2026-05-19:** Postmortem PM-2026-05-19 registrado. Incidente de User Journey causado por `identity_links` com uma linha única por perfil; correção publicada no dispatcher e dashboard, D1 reparado e smoke prod confirmou os dois emails resolvendo o mesmo `profile_id`.
- **2026-05-19:** Postmortem PM-2026-05-19B registrado. Incidente de DOI causado por `SMS` duplicado na Brevo e unsubscribe transacional prévio; dispatcher publicado com fallback sem `SMS`, contato desbloqueado com autorização humana e DOI reenviado com novo `requests` no log Brevo.
- **2026-05-19:** Fase 3 concluída. Deploys prod/smokes de workers, mkt-dashboard e sGTM finalizados; `2.11B.4` publicou o GTM server-side `GTM-K6Q4H6BR` versionId `18`. Progresso `32/38`; próximo `2.11Z.1`.
