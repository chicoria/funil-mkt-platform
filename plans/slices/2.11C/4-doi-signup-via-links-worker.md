# Slice 2.11C.4 — DOI signup via links worker

> Satélite: 2.11C ([`../../PLANO-LINKS-REDIRECT-MULTI-TENANT.md`](../../PLANO-LINKS-REDIRECT-MULTI-TENANT.md))
> Estimativa: 1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | IN_PROGRESS |
| Started | 2026-05-19 por Codex (GPT-5) |
| Completed | — |
| Commit final | — |
| PR | — |
| Janela de smoke | — |

## Contexto

Hoje o DOI do produto DECOLE redireciona para `https://decolesuacarreiraesg.com.br/confirmacao.html` e o `SIGN_UP` depende de script client-side da página. Este slice move a confirmação para uma URL do `links-redirect`, permitindo recuperar dados do lead e emitir `SIGN_UP` server-side (agnóstico por tenant/produto via catálogo), reduzindo perda por bloqueio de JS/adblock.

## Pré-requisitos

- [x] 2.11C.1 DONE (worker links-redirect catalog-driven)
- [x] 2.11C.2 DONE (deploy links-redirect em produção)
- [x] 2.11C.3 DONE (cleanup env vars legadas)
- [ ] Definir contrato final da URL de confirmação (`rid` e/ou token assinado)

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição curta |
|---|---|---|
| `workers/links-redirect/src/index.ts` | EDIT | Adicionar rota de confirmação DOI e emissão de evento `SIGN_UP` |
| `workers/links-redirect/test/unit/index.test.ts` | EDIT | Cobertura de redirect + enqueue `SIGN_UP` + idempotência |
| `config/products.catalog.json` | EDIT | Declarar rota de confirmação no bloco `tenants.{id}.links.routes` e DOI redirect URL |
| `workers/funnel-dispatcher/test/unit/index.test.ts` | EDIT | Garantir compatibilidade do evento `SIGN_UP` emitido pelo links worker |

### Diff conceitual

```typescript
// Antes
// DOI -> redirectionUrl = site/confirmacao.html (evento disparado no browser)

// Depois
// DOI -> redirectionUrl = https://links.<tenant>/signup?... 
// links-worker resolve tenant/produto, consulta IDENTITY_KV por rid,
// enfileira SIGN_UP no FUNNEL_EVENTS e redireciona para página final.
```

### Mudanças no catálogo (se aplicável)

```jsonc
{
  "tenants": {
    "decole": {
      "links": {
        "routes": [
          {
            "path": "/signup",
            "type": "doi_confirmation",
            "productCode": "DECOLE_ESG"
          }
        ]
      }
    }
  }
}
```

## Testes

### Unit

- [ ] `workers/links-redirect/test/unit/index.test.ts`: rota `/signup` resolve tenant e redireciona 302
- [ ] `workers/links-redirect/test/unit/index.test.ts`: com `rid` válido, enfileira `SIGN_UP` com `tenant_id`/`product_code`
- [ ] `workers/links-redirect/test/unit/index.test.ts`: sem `rid`, não quebra fluxo e não gera evento inválido
- [ ] `workers/links-redirect/test/unit/index.test.ts`: hostname/tenant inválido falha fast (404)

### E2E (se aplicável)

- [ ] smoke manual em prod após deploy (URL de confirmação real)

### Mocks/fixtures necessários

- `workers/links-redirect/test/fixtures/doi-confirmation.json`: payload mínimo de lead recuperado por `rid`

## Validação executável

```bash
# 1. Testes unitários links-worker
cd workers/links-redirect && npx vitest run
# Esperado: testes verdes sem regressão

# 2. Regressão dispatcher (SIGN_UP chain)
cd workers/funnel-dispatcher && npx vitest run test/unit/index.test.ts
# Esperado: SIGN_UP mantém handlers esperados

# 3. Catálogo válido
node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8'))"
# Esperado: sem erro

# 4. Hygiene
git diff --check
# Esperado: sem whitespace errors
```

## Smoke checklist (se aplicável)

- [ ] DOI e-mail abre URL de links worker (`/signup`) e retorna 302 para página final
- [ ] Evento `SIGN_UP` aparece no fluxo esperado (queue/dispatcher)
- [ ] Sem warning de `unknown_tenant`/`unknown_route` para tráfego válido

## Rollback

```bash
git revert <commit_slice_2_11C_4>
# opcional: restaurar redirectionUrl antigo no catálogo e redeploy do worker correspondente
```

Validação pós-rollback: DOI volta a redirecionar diretamente para `confirmacao.html` legado sem passar pelo links worker.

## Revisão G.12 (Code + Architecture + Tests) — preenchido pelo revisor antes de DONE

> ⛔ **GUARD RAIL:** agente implementador NÃO pode auto-aprovar este bloco (Fase 0.5 em diante).
> Revisão obrigatória por agente separado/humano antes de marcar `DONE`.

## Execução (append-only — preenchido AO LONGO da execução)

### 2026-05-19 por Codex (GPT-5)

- O que foi tentado: criação do slice file para formalizar implementação DOI->links-worker.
- O que funcionou: escopo fechado com critérios de aceite, testes e rollback definidos.
- O que falhou: nada nesta etapa de planejamento.
- Próximo passo planejado: implementar rota `/signup` no worker + testes Red/Green.

### 2026-05-19 por Codex (GPT-5)

- O que foi tentado: remover emissão client-side de `sign_up` nas páginas HTML de confirmação (repo DECOLE) após migração para emissão server-side via links worker.
- O que funcionou: blocos `dataLayer.push({ event: "sign_up", ... })` removidos de `site/confirmacao.html` e `site/planodevoo/confirmacao.html`; grep final sem matches de `sign_up` nessas páginas.
- O que falhou: nenhum erro técnico.
- Próximo passo planejado: manter monitoramento de duplicidade de `SIGN_UP` em produção para confirmar redução de eventos duplicados.

## Gotchas / lições aprendidas

- Definir idempotência do `SIGN_UP` é importante para evitar duplicidade em refresh/retry da URL de confirmação.
- A URL de confirmação precisa manter contrato compatível com links atuais do DOI (query params existentes).

## Decisões tomadas (delta vs plano original)

- Decisão: tratar esta demanda como extensão incremental em `2.11C.4` (pós 38/38), sem reabrir slices já concluídos.
- Motivo: mudança nova de produto/fluxo, não correção de pendência do plano base.
- Plano/satélite atualizado: `STATUS-2.11.md` e `PLANO-MASTER-MULTI-TENANT.md` (cabeçalhos e próxima ação).
