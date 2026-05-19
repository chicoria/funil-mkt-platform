# Slice — precheckout: redirect catalog-driven após submit

> Feature: api-funnel-ingress + catálogo
> Estimativa: 2–3 horas

## Status

| Campo | Valor |
|---|---|
| Estado | IN_PROGRESS |
| Started | 2026-05-19 por Claude Sonnet 4.6 |
| Completed | — |
| Commit final | — |

## Contexto

`BEGIN_CHECKOUT` events criados pelo `links-redirect` não têm `event.lead.email` porque o form de inscrição usa client-side redirect (JavaScript lê `data-redirect-url`). Sem email, `update_brevo_funnel` salta e o funil Brevo não avança além de `GENERATE_LEAD`.

**Solução:** o handler `/funnel/precheckout` retorna `302 redirect` para o URL de checkout do catálogo em vez de `202 JSON`. O email é propagado via query param. O `links-redirect` cria o `BEGIN_CHECKOUT` com email → `update_brevo_funnel` atualiza Brevo.

**Princípio:** URL de redirect vem do catálogo (`tenants.{id}.links.routes`) — zero risco de open redirect, sem hidden inputs nos forms, multi-tenant by design.

## Mudança

### Arquivo principal
`workers/api-funnel-ingress/src/index.ts` — após `queue.send(event)`:
1. Procurar rota de checkout do produto no catálogo
2. Construir URL de redirect com email + attribution params
3. Retornar `Response.redirect(url, 302)` em vez de `jsonResponse(202)`
4. Fallback: 202 JSON se produto não tem rota configurada

### Params propagados no redirect
`email`, `anonymous_id`, `session_id`, `utm_source/medium/campaign/content/term`, `fbp`, `fbc`, `fbclid`, `gclid`, `wbraid`, `gbraid`

## Testes (TDD Red primeiro)
`workers/api-funnel-ingress/test/unit/precheckout-redirect.test.ts`

## Revisão G.12
> ⛔ GUARD RAIL: agente separado obrigatório antes de DONE.

---

## Execução (append-only)

### 2026-05-19 por Claude Sonnet 4.6
- Causa raiz confirmada: handler salta em `!email` (linha 1642 do funnel-dispatcher)
- Catálogo já tem `tenants.decole.links.routes` com paths por produto
- Design: redirect catalog-driven, sem params no form, fallback 202

## Gotchas / lições aprendidas
(a preencher)

## Decisões tomadas
- URL do redirect vem do catálogo (não do form) — evita open redirect
- Fallback para 202 JSON quando produto sem rota configurada (backward compat)
- Form HTML simplifica: remove `data-redirect-url` e `data-redirect-with-form`
