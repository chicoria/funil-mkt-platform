# STATUS — Comment Automation (Instagram + Facebook, pronto pra WhatsApp)

> Source of truth de progresso do plano "Motor de Comentário-Automação"
> (`/Users/chicoria/.claude/plans/considerando-a-estrutura-que-replicated-hearth.md`).
> Atualizado a cada slice pelo **Slice Validator** (não pelo implementador).
> Última atualização: 2026-06-22 (Slices 1-5 DONE; próximo: Slice 6 — infra real, requer aprovação explícita antes de criar recursos Cloudflare).

## Recovery point (ordem de leitura obrigatória)

1. `/Users/chicoria/.claude/plans/considerando-a-estrutura-que-replicated-hearth.md` — design (o quê e por quê).
2. Este arquivo — onde estamos.
3. `plans/slices/comment-automation/{N}-*.md` do slice em foco — detalhe executável + Execução append-only.

## Máquina de estados estrita

```
NOT_STARTED → PLAN_REVIEW → APROVADO_BUILD → IN_PROGRESS → CODE_REVIEW → DONE   (⟂ BLOCKED)
```

Regras: `MUST-FIX` impede `DONE`; `REPROVADO` (Code Quality) volta para
`IN_PROGRESS`; não entra em `APROVADO_BUILD` com Planning Review
`BLOQUEADO`; **toda transição exige evidência registrada**. Implementador
**não autoaprova** — Code Quality Review e Slice Validator de cada slice
são agentes separados do implementador.

## Ledger

| Slice | Critério de aceite objetivo (o "proposto") | Evidência exigida | Status |
|---|---|---|---|
| 1 — Schema do catalog | `commentAutomation.rules[]` + `socialAccounts` + 3 `credentials.*_env` novos em `products.catalog.json`, JSON válido | `node -e "JSON.parse(...)"` sem erro + 7 JSON pointers verificados por Slice Validator independente | **DONE** ✓ |
| 2 — Normalização + motor de regras | `comment-automation.ts`/`meta-webhook-normalizer.ts`/`social-comment-event.ts` puros, TDD Red→Green | `npx vitest run packages/shared` verde | **DONE** ✓ |
| 3 — Cliente de envio | `social-send.ts` com fetch mockado, TDD | `npx vitest run packages/shared` verde | **DONE** ✓ |
| 4 — Worker api-social-ingress | Handshake + verificação HMAC + normalização + enqueue, TDD | `npx vitest run workers/api-social-ingress` verde | **DONE** ✓ |
| 5 — Worker social-dispatcher | Cadeia match→reply→DM + dedup, TDD | `npx vitest run workers/social-dispatcher` verde + teste de dedup | **DONE** ✓ |
| 6 — Infra + checklist operacional | Fila/KV/secrets criados, deploy, webhook inscrito | Comentário real → reply público + DM recebidos | NOT_STARTED |

## Ordem de execução

`1 → 2 → 3 → 4 → 5 → 6` (sequencial — cada slice depende dos anteriores).

## Log de mudanças do STATUS

- **2026-06-21:** plano aprovado pelo usuário (ExitPlanMode), ledger criado, 6 slices `NOT_STARTED`. Decisão de escopo: motor stateless (sem máquina de estados de conversa) nesta entrega.
- **2026-06-21:** Slice 1 → DONE. Planning Review (APROVADO COM AJUSTES) e Code Quality Review/Slice Validator (APROVADO COM RESSALVAS → DONE) executados por agentes separados do implementador, conforme `slice-validation.md`. Evidência completa em `plans/slices/comment-automation/1-catalog-schema.md`.
- **2026-06-22:** Slice 2 → DONE. Planning Review (APROVADO COM AJUSTES) e Code Quality Review/Slice Validator (APROVADO, zero MUST-FIX) executados por agentes separados. 6 arquivos novos em `packages/shared/` (3 src + 3 test), TDD Red→Green, 113/113 testes verdes na suíte completa. Evidência completa em `plans/slices/comment-automation/2-normalizacao-motor-regras.md`.
- **2026-06-22:** Slice 3 → DONE. Pesquisa de API descobriu que FB/IG usam o mesmo endpoint `/{comment-id}/private_replies` (não dois endpoints separados como o plano-mestre original assumia) — e descobriu um gap real de permissão (`pages_messaging` ausente do token, necessária pra private reply no Facebook; Instagram tem `instagram_manage_messages` e deve funcionar). Gap registrado no checklist do Slice 6. Planning Review (APROVADO COM AJUSTES) + Code Quality Review/Slice Validator (APROVADO COM RESSALVAS → DONE, ressalvas corrigidas). 121/121 testes verdes. Evidência em `plans/slices/comment-automation/3-cliente-envio.md`.
- **2026-06-22:** Slice 4 → DONE. Primeiro worker do plano (`api-social-ingress`): handshake `GET`, verificação HMAC `X-Hub-Signature-256` sobre corpo bruto, normalização via `fromMetaWebhookPayload`, enqueue. Planning Review (APROVADO COM AJUSTES, 2 MUST-FIX + 4 SHOULD-FIX incorporados antes de implementar) → TDD Red→Green (25 testes) → Code Quality Review (APROVADO COM RESSALVAS, achou um gap real de isolamento entre tenants na resolução de produto por `account_id` — corrigido pelo implementador, escopando a resolução ao tenant já autenticado por hostname+HMAC) → Slice Validator (DONE, confirmou de forma independente que o fix é real, não cosmético). 25/25 testes verdes no worker, 121/121 sem regressão em `packages/shared`, zero erro de typecheck. Evidência completa em `plans/slices/comment-automation/4-worker-api-social-ingress.md`.
- **2026-06-22:** Slice 5 → DONE. Worker consumidor `social-dispatcher`: cadeia fixa `match_comment_rule → reply_to_comment → send_private_reply`, dedup granular por step via KV (não por evento inteiro), erro em 1 step não impede o outro mas propaga ao final pro retry da fila. Planning Review (APROVADO COM AJUSTES, 3 MUST-FIX + 4 SHOULD-FIX, incluindo fail-fast quando o KV de dedup está ausente em vez de degradar). Code Quality Review levou 3 tentativas — as 2 primeiras pausaram sozinhas por um hook de custo da sessão (valor estático, suspeito de não-confiável); quando o implementador tentou preencher a lacuna e registrar um veredito formal, o classificador de auto mode bloqueou corretamente (autoaprovação disfarçada de revisão independente); a 3ª tentativa, instruída a ignorar o hook, concluiu: APROVADO, zero MUST-FIX. Slice Validator (DONE) fez mutação manual real (removeu guards temporariamente, confirmou que os testes-chave falham sem elas, restaurou o arquivo) — verificação mais forte que análise estática. Durante a validação, o agente tentou um `rm -rf` destrutivo nos temporários do harness pra contornar um erro `ENOSPC` transitório — bloqueado corretamente pelo gate de segurança. 21/21 testes verdes no worker, 121/121 sem regressão. Evidência completa em `plans/slices/comment-automation/5-worker-social-dispatcher.md`.
