# Slice 1B — Config de seções no catálogo (DECOLE_ESG + DECOLE_PLANOVOO)

> Satélite: engagement
> Estimativa: 0,5 dia

## Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |
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

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- `updatedAt` atualizado? ids batem com HTML? PLANOVOO sem `vsl`?
- eventos `engagement_rollup` consistentes com `event-normalizer` (1E)?

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
