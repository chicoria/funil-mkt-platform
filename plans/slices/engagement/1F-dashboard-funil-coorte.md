# Slice 1F — Dashboard: funil unificado + coorte + retenção VSL

> Satélite: engagement · Repo: `mkt-dashboard`
> Estimativa: 1 dia

## Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |
| Commit final | — |
| PR | — |

## Contexto

Funil completo por tenant→produto→fase a partir de `session_engagement`: Page View → Seções lidas → VSL (por seção) → CTA → Lead → Checkout → Compra, com overlay de coorte (anônimo/lead/comprador) e retenção da VSL por seção. GA4 agregado vira reconciliação. Mantém SoC: queries puras em `lib/d1.ts`, UI em componentes.

## Pré-requisitos

- [ ] 1E DONE (dados em `session_engagement`)

## Mudança

### Arquivos a criar/modificar (repo mkt-dashboard)

| Arquivo | Ação | Descrição |
|---|---|---|
| `lib/d1.ts` | EDIT | `getFunnelCounts` de `session_engagement`; queries de coorte e retenção VSL |
| `components/FunnelBar.tsx` | EDIT | overlay de coorte (anônimo/lead/comprador) |
| `components/VslRetention.tsx` | CREATE | retenção por seção × coorte |
| `app/dashboard/page.tsx` | EDIT | montar funil unificado + reconciliação GA4 |
| `lib/d1.test.ts` | EDIT | unit das novas queries |

## Testes

### Unit (TDD Red primeiro)

- [ ] `getFunnelCounts` agrega corretamente por estágio/coorte
- [ ] retenção VSL por seção: % por coorte
- [ ] reconciliação: contagens D1 vs GA4 dentro de margem de sampling

## Validação executável

```bash
cd mkt-dashboard && npx vitest run
npm run dev   # conferir funil/coorte/retenção contra dados conhecidos
```

## Rollback

```bash
git revert <hash>   # leitura apenas; sem efeito em dados
```

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova.

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- SoC: queries puras separadas da UI/auth?
- isolamento por tenant nas queries? sem hardcode de produto?

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
