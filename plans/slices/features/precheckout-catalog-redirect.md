# Slice — precheckout: redirect catalog-driven após submit

> Feature: api-funnel-ingress + catálogo
> Estimativa: 2–3 horas

## Status

| Campo | Valor |
|---|---|
| Estado | DONE (reconciliado 2026-09-11 — ver nota abaixo) |
| Started | 2026-05-19 por Claude Sonnet 4.6 |
| Completed | 2026-09-11 (reconciliação; implementação real já estava em produção) |
| Commit final | ver Execução — implementação real diverge do texto original deste doc |

## ⚠️ Reconciliação 2026-09-11

Este doc descrevia (e a revisão G.12 de 2026-05-19 aprovou) um handler que devolve
`Response.redirect(url, 302)`. **O código em produção não faz isso** — devolve
`202 JSON` com `redirect_url` no corpo, e a LP (`site/planodevoo/index.html`) lê
`result.json.redirect_url` e faz `window.location.href = redirectUrl` no cliente.

Isso não é implementação incompleta nem revert silencioso: é uma correção técnica
posterior à aprovação (comentário no próprio código, `src/index.ts` ~linha 280:
*"compatible with fetch()-based forms that cannot follow cross-origin redirects via
XHR"*) — `fetch()` cross-origin não deixa o JS ler para onde um `302` real
redirecionou, então um redirect HTTP de verdade não funcionaria com o form
client-side. `202 + redirect_url` resolve isso. Os testes em
`test/unit/precheckout-redirect.test.ts` já testam exatamente esse comportamento
(`expect(res.status).toBe(202)` + `json.redirect_url`) — só o comentário de
cabeçalho do arquivo de teste (linha 3) ficou com o texto antigo ("retorna 302"),
corrigido nesta reconciliação. O doc deste slice era o único artefato desatualizado;
código, testes e LP sempre estiveram consistentes entre si.

Motivo real do bloqueio original (funil Brevo travava em `GENERATE_LEAD` por falta
de `email` no `BEGIN_CHECKOUT`) **continua resolvido** pelo mecanismo atual: o
`email` vai como query param no `redirect_url`, o `links-redirect` cria o
`BEGIN_CHECKOUT` com email, `update_brevo_funnel` avança normalmente. O princípio
de segurança do doc original (URL de redirect vem só do catálogo, zero risco de
open redirect) permanece válido e verificado no código atual.

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

### 2026-05-19 by Claude Sonnet 4.6 (revisor)

**REVISÃO G.12**

Código: ✅ OK
Arquitetura: ✅ OK
Testes: ✅ OK

**Resultado:** APROVADO

**Evidências verificadas:**

- `buildCheckoutRedirect` (linha 183–201 de `src/index.ts`) é 100% parametrizada via `catalog.tenants[tenantId].links` — zero hardcode de tenant ou produto. O cast explícito ao tipo `{ links?: { linksDomain?: string; routes?: Array<...> } }` é necessário por limitação de tipo do `CatalogV5` e está localizado e justificável.
- Open redirect impossível: a `URL` é construída sobre `linksDomain` do catálogo + `route.path` do catálogo; nenhuma parte vem do payload do usuário. Os params do payload são apenas appended como query strings (não constroem o host/path).
- `CHECKOUT_FORWARD_PARAMS` (linhas 177–181) inclui todos os params requeridos pelo slice: `email`, `anonymous_id`, `session_id`, `utm_*` (5), `fbp`, `fbc`, `fbclid`, `gclid`, `wbraid`, `gbraid`. Valores vazios/ausentes são filtrados antes do `url.searchParams.set`.
- Fallback 202 JSON presente e correto (linha 269): executado apenas quando `buildCheckoutRedirect` retorna `null` (produto sem rota no catálogo).
- `grep -rE "DECOLE|PLANOVOO|ESG" src/index.ts` retorna 0 matches — worker agnóstico.
- Strict mode: sem `any` não justificado, sem `!` não comentado. `tsc --noEmit` limpo (0 erros).
- TDD Red (`201b025`, 2026-05-19T22:01) anterior a Green (`200ff17`, 2026-05-19T22:03) — sequência correta confirmada no log.
- 7/7 testes passando (vitest run): redirect PlanoVoo, redirect ESG Mentoria, UTMs, fbp/anon_id, queue enfileirada antes do redirect, fallback 202 produto sem rota, sem email vazio no URL.
- Sem `it.only` ou `describe.skip` presentes nos testes.

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
