# Slice 2.11A.3 — Refactor tracking config por tenant

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 15:41 WEST por Codex |
| Completed | 2026-05-18 15:51 WEST por Codex |
| Commit final | `22a8853` |
| PR | — |
| Janela de smoke | N/A — Fase 2 sem deploy |

## Contexto

`emit_tracking` ainda resolve sGTM e GA4 a partir de `products.{code}.tracking` e env vars globais/por produto. O schema v5 move sGTM, GA4 e Meta CAPI para `tenants.{id}.tracking`; Meta Pixel permanece por produto. Este slice faz o refactor sem deploy disruptivo e preserva payloads existentes para DECOLE.

## Pré-requisitos

- [x] 2.11A.0 DONE — Secrets Store wrapper
- [x] 2.11A.1 DONE — catálogo v5 aditivo
- [x] 2.11T.3 DONE — cross-tenant-isolation baseline
- [x] 2.11T.4 DONE — golden master `emit_tracking`
- [x] 2.11A.2 DONE — secrets `_DECOLE` populados e bindings criados
- [x] Validação humana para iniciar Fase 2 — 2026-05-18, solicitada por chicoria

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `workers/funnel-dispatcher/src/handlers/index.ts` | EDIT | `resolveTrackingConfig` lê sGTM/GA4 de `tenants.{id}.tracking`; Meta Pixel segue por produto |
| `workers/funnel-dispatcher/test/unit/index.test.ts` | EDIT | Ajustar teste de tracking para tenant-level v5 |
| `workers/funnel-dispatcher/test/unit/cross-tenant-isolation.test.ts` | EDIT | Garantir isolamento com `tenants.{id}.tracking` |
| `workers/funnel-dispatcher/test/snapshot/emit-tracking-payload.test.ts` | EDIT | Preservar golden master usando config v5 |
| `plans/STATUS-2.11.md` | EDIT | Registrar slice em progresso/concluído |

### Diff conceitual

```typescript
// Antes
const tracking = product?.tracking;
const sgtmEndpointUrl = envString(env, tracking?.sgtm?.endpointEnvVar) || env.SGTM_ENDPOINT_URL;
const ga4MeasurementId = envString(env, tracking?.ga4?.measurementIdEnvVar) || env.GA4_MEASUREMENT_ID;

// Depois
const tenantTracking = catalog.tenants?.[tenantId]?.tracking;
const productTracking = product?.tracking;
const sgtmEndpointUrl = envString(env, tenantTracking?.sgtm?.endpointEnvVar) || v4Fallback;
const ga4MeasurementId = envString(env, tenantTracking?.ga4?.measurementIdEnvVar) || tenantTracking?.ga4?.measurementId || v4Fallback;
```

### Mudanças no catálogo

Nenhuma mudança esperada. O catálogo v5 já contém `tenants.decole.tracking`.

## Testes

### Unit

- [x] `workers/funnel-dispatcher/test/unit/index.test.ts`: `emit_tracking` usa sGTM/GA4 do tenant e preserva `produto` por produto
- [x] `workers/funnel-dispatcher/test/unit/index.test.ts`: `emit_tracking` lê bindings `env.X.get()` do Secrets Store
- [x] `workers/funnel-dispatcher/test/unit/cross-tenant-isolation.test.ts`: tenants distintos usam endpoints/measurement IDs distintos em `tenants.{id}.tracking`
- [x] `workers/funnel-dispatcher/test/snapshot/emit-tracking-payload.test.ts`: golden master de payload preservado

### E2E

N/A — Fase 2 não faz deploy nem smoke externo.

### Mocks/fixtures necessários

- Mocks inline de catálogo v5 com `tenants.decole.tracking` e `tenants.superare.tracking`.

## Validação executável

```bash
cd workers/funnel-dispatcher && npx vitest run test/unit/index.test.ts test/unit/cross-tenant-isolation.test.ts test/snapshot/emit-tracking-payload.test.ts
# 2026-05-18: 43 passed, 0 failed

cd workers/funnel-dispatcher && npm run typecheck
# 2026-05-18: 0 erros TypeScript

cd workers/funnel-dispatcher && npx vitest run
# 2026-05-18: 169 passed, 0 failed
```

## Smoke checklist

N/A — sem deploy neste slice.

## Rollback

```bash
git revert <commit_hash>
```

Validação pós-rollback: testes do dispatcher voltam ao estado anterior; nenhuma mudança externa foi aplicada.

## Revisão G.12 (Code + Architecture + Tests) — preenchido pelo revisor antes de DONE

### 2026-05-18 15:51 WEST by Codex — auto-revisão

**Código TypeScript**
- [x] Strict mode respeitado; `npm run typecheck` verde
- [x] `resolveSecret()` usado para env vars de tracking, suportando Secrets Store binding e string legada
- [x] Erros de Secrets Store geram `handler_warn` com `secret_name`, `tenant_id`, `product_code` e campo afetado
- [x] Nenhum hardcode novo de tenant/produto no código de produção

**Arquitetura**
- [x] sGTM endpoint e GA4 measurement/api secret vêm primeiro de `tenants.{id}.tracking`
- [x] Fallback v4 continua apenas durante coexistência e exige produto resolvido em catálogo multi-tenant
- [x] Tenant desconhecido não cai para config DECOLE; teste de isolamento cobre este caso
- [x] Meta CAPI token permanece tenant-level no catálogo, mas não é enviado pelo dispatcher; roteamento/token CAPI é responsabilidade do sGTM no slice 2.11B

**Testes**
- [x] Red verificado: testes v5 falharam antes do refactor com `missing_product_tracking_config`
- [x] Happy path DECOLE e SUPERARE, tenant desconhecido, golden master e Secrets Store binding cobertos
- [x] Sem `it.only`/`describe.skip`

**Slice file**
- [x] Execução append-only preenchida
- [x] Decisões/gotchas registrados

**Resultado:** APROVADO COM RESSALVAS

Ressalvas:
- `scripts/audit-workers-agnostic.sh` ainda não existe e o CI mantém o audit em `continue-on-error` até 2.11A.9. Hardcodes preexistentes em outros pontos do dispatcher continuam para slices seguintes.

---

## Execução (append-only — preenchido AO LONGO da execução)

### 2026-05-18 15:41 WEST by Codex

- O que foi tentado: recovery point confirmado em `main`, worktree limpa, commits recentes coerentes com `STATUS-2.11.md`.
- O que funcionou: slice criado e escopo fechado para `resolveTrackingConfig`.
- O que falhou: nada até agora.
- Próximo passo planejado: atualizar `STATUS-2.11.md`, escrever/ajustar testes de tracking por tenant e implementar o refactor.

### 2026-05-18 15:44 WEST by Codex — Red

- O que foi tentado: testes de tracking migrados para catálogo v5 com `tenants.{id}.tracking`.
- O que falhou como esperado: `emit_tracking` não chamava sGTM e logava `missing_product_tracking_config`, porque o código ainda lia sGTM/GA4 do produto.
- Resultado: Red confirmado em `index.test.ts`, `cross-tenant-isolation.test.ts` e golden master.

### 2026-05-18 15:51 WEST by Codex — Green + review

- O que funcionou: `resolveTrackingConfig` passou a resolver tenant/produto pelo catálogo, ler sGTM/GA4 de `tenants.{id}.tracking` e usar `resolveSecret()` para string legada ou Secrets Store binding.
- Validação executada:
  - `cd workers/funnel-dispatcher && npm run typecheck` — 0 erros
  - `cd workers/funnel-dispatcher && npx vitest run test/unit/index.test.ts test/unit/cross-tenant-isolation.test.ts test/snapshot/emit-tracking-payload.test.ts` — 43 passed
  - `cd workers/funnel-dispatcher && npx vitest run` — 169 passed
- Commit de implementação: `22a8853`.

## Gotchas / lições aprendidas

- A Fase 2 ainda mantém fallback v4 durante coexistência. Remoção de fallbacks antigos fica para 2.11A.9.
- Quando sGTM passa a ser tenant-level, testes que buscam URL por produto precisam limpar `fetchMock.mock.calls` entre eventos, porque dois produtos do mesmo tenant usam o mesmo endpoint.
- O dispatcher não deve enviar `META_CAPI_ACCESS_TOKEN` no payload; esse segredo pertence ao container sGTM/lookup tables (slice 2.11B).

## Decisões tomadas (delta vs plano original)

- **Meta CAPI no dispatcher:** não resolver nem enviar `META_CAPI_ACCESS_TOKEN` em `emit_tracking`. O catálogo já declara `tenants.{id}.tracking.metaCapi`, mas o handler envia apenas GA4 Measurement Protocol ao sGTM. Token/Pixel CAPI são roteados no sGTM compartilhado (2.11B).
- **Catálogo:** nenhuma alteração em `config/products.catalog.json`; o schema v5 e os campos `tenants.decole.tracking` já existiam.
