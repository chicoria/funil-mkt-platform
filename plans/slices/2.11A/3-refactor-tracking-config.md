# Slice 2.11A.3 — Refactor tracking config por tenant

> Satélite: 2.11A ([`../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md`](../../PLANO-MULTI-TENANT-SECRETS-CONFIG.md))
> Estimativa: 1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | IN_PROGRESS |
| Started | 2026-05-18 15:41 WEST por Codex |
| Completed | — |
| Commit final | — |
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
| `workers/funnel-dispatcher/src/handlers/index.ts` | EDIT | `resolveTrackingConfig` lê sGTM/GA4/Meta CAPI de `tenants.{id}.tracking`; Meta Pixel segue por produto |
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

- [ ] `workers/funnel-dispatcher/test/unit/index.test.ts`: `emit_tracking` usa sGTM/GA4 do tenant e preserva `produto` por produto
- [ ] `workers/funnel-dispatcher/test/unit/cross-tenant-isolation.test.ts`: tenants distintos usam endpoints/measurement IDs distintos em `tenants.{id}.tracking`
- [ ] `workers/funnel-dispatcher/test/snapshot/emit-tracking-payload.test.ts`: golden master de payload preservado

### E2E

N/A — Fase 2 não faz deploy nem smoke externo.

### Mocks/fixtures necessários

- Mocks inline de catálogo v5 com `tenants.decole.tracking` e `tenants.superare.tracking`.

## Validação executável

```bash
cd workers/funnel-dispatcher && npx vitest run test/unit/index.test.ts test/unit/cross-tenant-isolation.test.ts test/snapshot/emit-tracking-payload.test.ts
# Esperado: testes verdes, 0 failed

cd workers/funnel-dispatcher && npm run typecheck
# Esperado: 0 erros TypeScript
```

## Smoke checklist

N/A — sem deploy neste slice.

## Rollback

```bash
git revert <commit_hash>
```

Validação pós-rollback: testes do dispatcher voltam ao estado anterior; nenhuma mudança externa foi aplicada.

## Revisão G.12 (Code + Architecture + Tests) — preenchido pelo revisor antes de DONE

### Pendente

**Resultado:** PENDENTE

Ressalvas / Bloqueios:
- —

---

## Execução (append-only — preenchido AO LONGO da execução)

### 2026-05-18 15:41 WEST by Codex

- O que foi tentado: recovery point confirmado em `main`, worktree limpa, commits recentes coerentes com `STATUS-2.11.md`.
- O que funcionou: slice criado e escopo fechado para `resolveTrackingConfig`.
- O que falhou: nada até agora.
- Próximo passo planejado: atualizar `STATUS-2.11.md`, escrever/ajustar testes de tracking por tenant e implementar o refactor.

## Gotchas / lições aprendidas

- A Fase 2 ainda mantém fallback v4 durante coexistência. Remoção de fallbacks antigos fica para 2.11A.9.

## Decisões tomadas (delta vs plano original)

- Nenhum desvio até agora.
