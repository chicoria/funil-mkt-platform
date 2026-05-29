# STATUS — Engagement / Funil completo + jornada

> Source of truth de progresso do `PLANO-ENGAGEMENT-FUNIL-COMPLETO.md`.
> Atualizado a cada slice pelo **Slice Validator** (não pelo implementador).
> Última atualização: 2026-05-29 (1FG criado após auditoria 1F/1G).

## Recovery point (ordem de leitura obrigatória)

1. `PLANO-ENGAGEMENT-FUNIL-COMPLETO.md` — design (o quê e por quê).
2. Este arquivo — onde estamos.
3. `slices/engagement/{N}-*.md` do slice em foco — detalhe executável + Execução append-only.
4. Estudos preliminares: `decole/decolesuacarreiraesg/trafego/*.md`.

## Máquina de estados estrita

```
NOT_STARTED → PLAN_REVIEW → APROVADO_BUILD → IN_PROGRESS → CODE_REVIEW → DONE   (⟂ BLOCKED)
```

Regras: `MUST-FIX` impede `DONE`; `REPROVADO` (Code Quality) volta para `IN_PROGRESS`; não entra em `APROVADO_BUILD` com Planning Review `BLOQUEADO`; **toda transição exige evidência registrada** (saída de comando, teste verde, caminho de arquivo, DebugView). Implementador **não autoaprova**.

> Nota: os slice files usam o vocabulário da `SLICE-TEMPLATE.md` (`TODO|IN_PROGRESS|DONE|BLOCKED|ROLLED_BACK`). Mapeamento: `NOT_STARTED≈TODO`. Este ledger mantém os estados estritos da governança.

## Ledger

| Slice | Critério de aceite objetivo (o "proposto") | Evidência exigida | Status |
|---|---|---|---|
| 0-disc | Relatório do estado live (dimensões GA4, tags/vars GTM Web+Server, pixels/eventos Meta) + deriva catálogo↔env resolvida | doc de descoberta + nomes confirmados que os workers leem | **DONE** ✓ |
| 1A | Tabela+índices `session_engagement` criados; merge puro passa unit (happy+edge) | `wrangler d1` local + vitest verde em `packages/shared/test` | **DONE** ✓ |
| 1B | Catálogo com `engagement` dos 2 produtos (ESG 18+VSL; PLANOVOO 9 sem VSL) + eventos `engagement_rollup`; `updatedAt` | JSON válido + diff do catálogo | **DONE** ✓ |
| 1C | `site/src/engagement/` (core+dom+entry) compila e core passa unit | `npm run build:check` verde | **DONE** ✓ |
| 1D | `index.html` e `planodevoo/index.html` emitem eventos+beacon; VSL mapeia seção↔tempo | Playwright e2e verde + Network mostra `ENGAGEMENT_SNAPSHOT` | **DONE** ✓ |
| 1E | 1 linha/sessão em `session_engagement` com merge correto; stitching propaga lead/compra | integração dispatcher verde | **DONE** ✓ |
| 1F | Funil unificado + coorte + retenção VSL renderizam de D1; reconcilia com GA4 | unit `lib/d1.test.ts` + `next dev` observado | **DONE** ✓ |
| 1G | Jornada unificada (anon+profile), `UserBehaviorSummary`, `UserList` navegável | unit queries + navegação observada | **DONE** ✓ |
| 1FG | Remediar achados da auditoria 1F/1G: funil primário `session_engagement`, VSL por seção×coorte, lista agregada por identidade, summary completo e status consistente | `npx vitest run` + `npm run build` + smoke `/dashboard` e `/dashboard/user` + Slice Validator sem MUST-FIX | **DONE** ✓ |
| 1H | Vars/triggers/tags GA4 dos eventos no GTM Web; export commitado | GA4 DebugView + `engagement-web-import.json` | **DONE** ✓ |
| 1I | Dimensões customizadas registradas; `ga4.ts` lê novos eventos | GA4 Data API mostra dimensões + unit do report | **DONE** ✓ |
| 1J | Eventos Meta alta-intenção via Pixel+CAPI sob flag `metaForward` | Meta Test Events (`META_TEST_EVENT_CODE_*`) | **DONE** ✓ |
| 2 | Eventos crus no Analytics Engine + drill-down VSL ao segundo | unit escritor/consulta AE + query observada | **DONE** ✓ |
| G1 | Camada de governança reutilizável no `workspace-agent-guidelines` (`slice-validation.md` + ledger template + edições) | arquivos + `README` atualizado + `git diff --check` limpo | **DONE** ✓ |

## Ordem de execução

`0-disc → 1A → 1B → 1C → 1D → 1H → 1I → 1J → 1E → 1F → 1G`. **2** e **G1** independentes (G1 pode ir a qualquer momento; 2 é fase posterior).

## Pré-requisitos transversais

- Base legal LGPD / Consent Mode v2 confirmada antes de 1D (stitching anônimo→identidade).
- 0-disc resolve a deriva de nomes de credenciais antes de 1H/1I/1J.
- Catálogo é fonte única: 1B precede o wiring do site (1C/1D) e a config GA4/Meta.

## Log de mudanças do STATUS

- **2026-05-29:** criação do plano, ledger e 13 slice files (todos NOT_STARTED). Nenhum slice iniciado.
- **2026-05-29:** G1 → DONE (commits `80e429e`, `4ebf852`, `73f39cd`, `fef0c1d`; aprovado pelo usuário como Slice Validator). 0-disc → IN_PROGRESS → CODE_REVIEW (relatório `0-disc-relatorio-descoberta.md` produzido; aguarda Slice Validator).
- **2026-05-29:** 0-disc → DONE (Slice Validator independente: relatório cobre GA4/GTM/sGTM v19/Meta, deriva catálogo↔env resolvida — APROVADO sem MUST-FIX).
- **2026-05-29:** 1A → DONE (TDD Red→Green: 80/80 testes verdes; `mergeSnapshot` puro; migration `session_engagement_v1_2026_05_29` idempotente em `dashboard-sync`; `git diff --check` limpo; 0 hardcode de tenant/produto).
- **2026-05-29:** 1B → DONE (engagement.vsl 12 seções + engagement.landing 18 seções em ESG; engagement.landing 9 seções sem vsl em PLANOVOO; 5+3 eventos engagement_rollup; JSON válido; updatedAt 2026-05-29).
- **2026-05-29:** 1E → DONE (TDD Red→Green: 7 novos testes + 190 total verdes; handler `upsert_session_engagement` em `createHandlers()` com mergeSnapshot puro + stitching became_lead/purchased; chain engagement_rollup adicionado no catálogo ESG+PLANOVOO; git diff --check limpo).
- **2026-05-29:** 1FG criado a partir de auditoria de conformidade dos slices 1F/1G. Achados: 1F/1G têm entrega parcial em `mkt-dashboard@0a954f0`, mas ainda exigem remediação antes de DONE real pelos critérios do plano.
