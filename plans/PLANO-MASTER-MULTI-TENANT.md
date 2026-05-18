# Plano Master — Multi-Tenant

> **Ponto de entrada autoritativo** para toda mudança no `funil-mkt-platform` que envolva multi-tenancy.
> **Status:** Em execução — 12/32 slices concluídos · Fases 0, 0.5 e 1 completas · Fase 2 aguardando validação humana (atualizado em 2026-05-18 ~15:35 WEST).
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

- **Red:** cada slice começa com teste falhando documentando o comportamento desejado.
- **Green:** implementação mínima para passar.
- **Refactor:** simplificar/melhorar com teste ainda verde.
- **Review (G.12):** agente especialista revisa código, arquitetura e testes **antes de marcar slice como DONE**. Bloqueante — slice não fecha sem aprovação do revisor.
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
```

### FASE 4 — Validação cruzada + limpeza (após Fase 3 estável por 72h)

```
[Z] 2.11Z.1  Smoke E2E cross-slice com tenant fake superare-test
[A] 2.11A.9  audit-secrets em CI + remover worker secrets antigos +
             remover fallbacks + validar grep workers agnostic
[B] 2.11B.5  Documentar runbook onboarding tenant em RUNBOOK-ONBOARDING-TENANT.md
[C] 2.11C.3  links-redirect remove env vars antigas + validar grep
[D] 2.11D.4  dashboard-sync remove fallbacks + secrets antigos
```

### Resumo de dependências

```
Fase 0 ─┬─ [A: Store + catálogo v5] ─┐
        ├─ [B: auditar sGTM]         │
        └─ [D: migration D1]         │
                                     ▼
Fase 0.5 ── [T: testes de regressão] ── GATE (não passa sem testes verdes)
                                     ▼
Fase 1 ── [A: popular secrets + bindings]
                                     ▼
Fase 2 ─┬─ [A: refactors dispatcher/ingress] ──┐
        ├─ [B: refatorar GTM preview]          │
        ├─ [C: refatorar links-redirect]       │
        └─ [D: refactor runSync]               │
                                               ▼
Fase 3 ── deploys disruptivos
                                               ▼
Fase 4 ── validação cruzada + limpeza
```

**Critical path:** ~3.5-4 semanas com paralelismo. Fase 0.5 adiciona ~3-5 dias bloqueante.

**Bloqueador para SUPERARE:** Fase 4 (2.11Z.1) verde.

---

## Próxima ação concreta

Para o primeiro agente a executar este plano:

1. **Confirmar com humano** que execução pode iniciar (validação humana — G.10)
2. **Ler** `STATUS-2.11.md` para confirmar estado atual (deve estar "Pré-execução, nenhum slice iniciado")
3. **Criar slice files da Fase 0** (4 arquivos) seguindo template `SLICE-TEMPLATE.md`:
   - `slices/2.11A/0-secrets-store-setup.md` (exemplo modelado no satélite 1)
   - `slices/2.11A/1-catalog-v5-additive.md`
   - `slices/2.11B/1-audit-sgtm-current.md`
   - `slices/2.11D/1-d1-migration-tenant-id.md`
4. **Atualizar STATUS-2.11.md** para refletir slices criados
5. **Confirmar com humano** qual slice começar primeiro (recomendado: 2.11A.0)
6. **Pegar slice** (mudar status para IN_PROGRESS, registrar Started + agent ID)
7. **Executar conforme slice file**
8. **Ao final:** atualizar slice (DONE + commit + execução) + STATUS (progresso + próximo) + estado externo se aplicável

---

## Histórico

- **2026-05-18:** Plano master criado. Aprovação inicial pelo humano. Pré-execução.
