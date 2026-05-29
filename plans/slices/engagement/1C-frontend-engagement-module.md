# Slice 1C — Frontend `site/src/engagement/` (core puro + dom + entry)

> Satélite: engagement · Repo: `decole/decolesuacarreiraesg` (frontend; sem backend CF)
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

Módulo TS modular e config-driven que acumula engajamento de sessão (LP + VSL + CTA), no padrão `meta-am.ts`/`precheckout.ts` (esbuild IIFE, `--global-name`, config por `data-*`/`window.*`). SoC: domínio puro (`core.ts`) separado de IO (`dom.ts`/`index.ts`). Genérico — reutilizável entre páginas e tenants.

## Pré-requisitos

- [ ] 1B DONE (mapa de seções no catálogo, consumido como config)

## Mudança

### Arquivos a criar/modificar (repo decole)

| Arquivo | Ação | Descrição |
|---|---|---|
| `site/src/engagement/core.ts` | CREATE | puro: `resolveVslSection`, `SessionAccumulator`, serialização snapshot |
| `site/src/engagement/dom.ts` | CREATE | IntersectionObserver, YouTube IFrame API, hook CTA |
| `site/src/engagement/index.ts` | CREATE | entry IIFE: lê `EngagementConfig`, `dataLayer.push` + `sendBeacon` |
| `site/package.json` | EDIT | `build:engagement` (esbuild IIFE) em `build`/`build:prod`/`watch` |
| `site/test/unit/engagement-core.test.ts` | CREATE | unit do core |

## Testes

### Unit (TDD Red primeiro)

- [ ] `resolveVslSection(timeSec, map)`: limites SRT (início/fim de cada seção, gaps)
- [ ] `SessionAccumulator`: section_view/engaged dedup, vsl watched_sec, cta counts, max_scroll
- [ ] serialização do snapshot estável (ordem determinística)

## Validação executável

```bash
cd site && npm run build:check   # typecheck + build + vitest
ls assets/engagement.js          # bundle gerado
```

## Rollback

```bash
git checkout -- site/src/engagement site/package.json
# bundle não referenciado em HTML ainda (1D), então sem efeito em produção
```

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova. Planning Review obrigatório (módulo novo).

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- `core.ts` 100% puro (sem DOM/rede)? TS strict, sem `any`/`!` injustificado?
- nada hardcoded de tenant/produto (tudo de `EngagementConfig`)?
- happy+edge no core?

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
