# AGENTS - FunilMKT Platform

## Workspace Agent Guideline

Este repo segue a guideline unificada do workspace:

`/Users/chicoria/git/workspace-agent-guidelines/guidelines/change-workflow.md`

Para revisoes especializadas, use tambem:

`/Users/chicoria/git/workspace-agent-guidelines/guidelines/review-agents.md`

Para validacao de slices (Slice Validator, status estrito, ledger):

`/Users/chicoria/git/workspace-agent-guidelines/guidelines/slice-validation.md`

Regras locais deste `AGENTS.md` continuam validas. Em caso de conflito, a regra mais especifica do repo vence, desde que nao enfraqueca seguranca, privacidade, protecao de secrets ou validacao minima.

## Regras Locais

- Este repo e a fonte do backend compartilhado Cloudflare para funis, workers, D1, KV, Queues, scripts operacionais, catalogo e workflows.
- Antes de concluir qualquer alteracao em produtos, checkout, Hotmart, Brevo, DOI, listas, segmentos, emails, automacoes, tracking, workers, filas, KV, D1, env vars ou paginas publicas relacionadas, verifique se `config/products.catalog.json` precisa ser atualizado.
- Quando o catalogo mudar, atualize `updatedAt` e siga `config/README.md`.
- Se o catalogo nao precisar mudar, registre isso no resumo final.
- Nao commitar `.env.local`, tokens, chaves privadas, cookies ou valores reais de secrets.
- Para mudancas nao triviais, trabalhar por slice e aplicar Planning Review + Code Quality Review.
- Implementador nao autoaprova o proprio slice — lancar Slice Validator separado antes de transitar para DONE (ver `slice-validation.md`).
- Planos ativos de engajamento: ler `plans/STATUS-ENGAGEMENT.md` antes de iniciar qualquer slice.
- Ao aceder ou configurar GTM Web ou sGTM via API: ler `/Users/chicoria/git/workspace-agent-guidelines/guidelines/gtm-api-guardrails.md` antes de qualquer accao. Regra critica: **`versions:live` para producao, nunca o workspace**.
