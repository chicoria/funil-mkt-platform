# Slice 1B — Config de seções no catálogo (DECOLE_ESG + DECOLE_PLANOVOO)

> Satélite: engagement
> Estimativa: 0,5 dia

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-29 |
| Completed | 2026-05-29 |
| Commit final | — |
| PR | — |

## Contexto

O catálogo é fonte única. Adicionar o bloco `engagement` aos dois produtos e os novos eventos `engagement_rollup`, para que site, worker e dashboard leiam o mesmo mapa de seções. Precede o wiring do site e a config GA4/Meta.

## Pré-requisitos

- [ ] Mapa de seções ESG (12 VSL + 18 LP) e PLANOVOO (9 LP, sem VSL) — já definidos no PLANO

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição |
|---|---|---|
| `config/products.catalog.json` | EDIT | `engagement` em `DECOLE_ESG_MENTORIA` (vsl v1 + 18 LP) e `DECOLE_PLANOVOO` (9 LP, sem vsl, `sectionSelector` próprio); eventos `engagement_rollup`; **`updatedAt`** |
| `config/README.md` | EDIT (se aplicável) | nota sobre o bloco `engagement` |

### Conteúdo

Ver `PLANO-ENGAGEMENT-FUNIL-COMPLETO.md` (blocos `engagement` reais dos 2 produtos + lista de eventos). DECOLE_PLANOVOO **sem** bloco `vsl`.

## Testes

- [ ] Validação JSON/schema do catálogo (parse OK, schemaVersion mantido)
- [ ] `updatedAt` atualizado
- [ ] Os 18 `lp-secao-*` (ESG) e 9 ids (PLANOVOO) batem com os HTMLs reais

## Validação executável

```bash
node -e "JSON.parse(require('fs').readFileSync('config/products.catalog.json','utf8')); console.log('json ok')"
# checagem de coerência se houver
bash scripts/check-master-coherence.sh 2>/dev/null || true
git diff --stat config/products.catalog.json
```

## Rollback

```bash
git checkout -- config/products.catalog.json
```

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova.

**Resultado:** APROVADO
- `updatedAt` → `2026-05-29` ✓
- PLANOVOO sem bloco `vsl` ✓
- 18 ids `lp-secao-*` (ESG) e 9 ids explícitos (PLANOVOO) conforme especificação ✓
- 5 eventos ESG (inclui VSL_SECTION_START/END) + 3 eventos PV (sem VSL) ✓
- JSON válido (node parse OK) ✓

## Execução (append-only)

**2026-05-29** — Implementado por agente autónomo.

1. `updatedAt` actualizado para `2026-05-29`.
2. `DECOLE_ESG_MENTORIA.funnelEventArchitecture.events`: adicionados 5 eventos `engagement_rollup` (SECTION_VIEW, SECTION_ENGAGED, VSL_SECTION_START, VSL_SECTION_END, ENGAGEMENT_SNAPSHOT).
3. `DECOLE_ESG_MENTORIA.engagement`: adicionado bloco com `vsl` (12 seções SRT, videoId GXfMV8KxUsA, v1, 1612.7s) e `landing` (18 seções `lp-secao-*`).
4. `DECOLE_PLANOVOO.funnelEventArchitecture.events`: adicionados 3 eventos `engagement_rollup` (SECTION_VIEW, SECTION_ENGAGED, ENGAGEMENT_SNAPSHOT — sem VSL).
5. `DECOLE_PLANOVOO.engagement`: adicionado bloco com `landing` (9 seções, `sectionSelector` por id explícito, sem `vsl`).
6. Validação node.js: JSON OK; 12 VSL sections, 18 ESG LP sections, 9 PV LP sections; 5+3 eventos rollup.

## Gotchas / lições aprendidas

- _(a preencher)_
