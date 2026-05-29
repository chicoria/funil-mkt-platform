# STATUS — Engagement / Funil completo + jornada

> Source of truth de progresso do `PLANO-ENGAGEMENT-FUNIL-COMPLETO.md`.
> Atualizado a cada slice pelo **Slice Validator** (não pelo implementador).
> Última atualização: 2026-05-29 (criação).

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
| 0-disc | Relatório do estado live (dimensões GA4, tags/vars GTM Web+Server, pixels/eventos Meta) + deriva catálogo↔env resolvida | doc de descoberta + nomes confirmados que os workers leem | NOT_STARTED |
| 1A | Tabela+índices `session_engagement` criados; merge puro passa unit (happy+edge) | `wrangler d1` local + vitest verde em `packages/shared/test` | NOT_STARTED |
| 1B | Catálogo com `engagement` dos 2 produtos (ESG 18+VSL; PLANOVOO 9 sem VSL) + eventos `engagement_rollup`; `updatedAt` | JSON válido + diff do catálogo | NOT_STARTED |
| 1C | `site/src/engagement/` (core+dom+entry) compila e core passa unit | `npm run build:check` verde | NOT_STARTED |
| 1D | `index.html` e `planodevoo/index.html` emitem eventos+beacon; VSL mapeia seção↔tempo | Playwright e2e verde + Network mostra `ENGAGEMENT_SNAPSHOT` | NOT_STARTED |
| 1E | 1 linha/sessão em `session_engagement` com merge correto; stitching propaga lead/compra | integração dispatcher verde | NOT_STARTED |
| 1F | Funil unificado + coorte + retenção VSL renderizam de D1; reconcilia com GA4 | unit `lib/d1.test.ts` + `next dev` observado | NOT_STARTED |
| 1G | Jornada unificada (anon+profile), `UserBehaviorSummary`, `UserList` navegável | unit queries + navegação observada | NOT_STARTED |
| 1H | Vars/triggers/tags GA4 dos eventos no GTM Web; export commitado | GA4 DebugView + `engagement-web-import.json` | NOT_STARTED |
| 1I | Dimensões customizadas registradas; `ga4.ts` lê novos eventos | GA4 Data API mostra dimensões + unit do report | NOT_STARTED |
| 1J | Eventos Meta alta-intenção via Pixel+CAPI sob flag `metaForward` | Meta Test Events (`META_TEST_EVENT_CODE_*`) | NOT_STARTED |
| 2 | Eventos crus no Analytics Engine + drill-down VSL ao segundo | unit escritor/consulta AE + query observada | NOT_STARTED |
| G1 | Camada de governança reutilizável no `workspace-agent-guidelines` (`slice-validation.md` + ledger template + edições) | arquivos + `README` atualizado + `git diff --check` limpo | NOT_STARTED |

## Ordem de execução

`0-disc → 1A → 1B → 1C → 1D → 1H → 1I → 1J → 1E → 1F → 1G`. **2** e **G1** independentes (G1 pode ir a qualquer momento; 2 é fase posterior).

## Pré-requisitos transversais

- Base legal LGPD / Consent Mode v2 confirmada antes de 1D (stitching anônimo→identidade).
- 0-disc resolve a deriva de nomes de credenciais antes de 1H/1I/1J.
- Catálogo é fonte única: 1B precede o wiring do site (1C/1D) e a config GA4/Meta.

## Log de mudanças do STATUS

- **2026-05-29:** criação do plano, ledger e 13 slice files (todos NOT_STARTED). Nenhum slice iniciado.
