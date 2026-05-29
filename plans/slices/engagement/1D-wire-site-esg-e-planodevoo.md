# Slice 1D — Wire do engagement em `index.html` e `planodevoo/index.html`

> Satélite: engagement · Repo: `decole/decolesuacarreiraesg`
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

Ativar o módulo 1C nas duas páginas. ESG tem VSL (YouTube `GXfMV8KxUsA`) — exige `enablejsapi=1` + IFrame API. Plano de Voo não tem VSL (só observers/CTA). Bloqueante LGPD: stitching anônimo→identidade só sob Consent Mode v2.

## Pré-requisitos

- [ ] 1C DONE (bundle `assets/engagement.js`)
- [ ] 1B DONE (config de seções)
- [ ] Base legal LGPD / Consent Mode v2 confirmada

## Mudança

### Arquivos a criar/modificar (repo decole)

| Arquivo | Ação | Descrição |
|---|---|---|
| `site/index.html` | EDIT | `<script>` engagement + `EngagementConfig` (ESG); VSL iframe → `enablejsapi=1&origin=...` (linha ~5511) |
| `site/planodevoo/index.html` | EDIT | `<script>` engagement + `EngagementConfig` (PLANOVOO, sem vsl) |
| `site/test/e2e/engagement.spec.ts` | CREATE | Playwright: disparo de section/vsl/beacon nas 2 páginas |

## Testes

### E2E (estende commit `bd63542`)

- [ ] ESG: section_view/engaged disparam; play VSL mapeia seção↔tempo; `ENGAGEMENT_SNAPSHOT` enviado em beforeunload
- [ ] PLANOVOO: section_view/engaged + CTA; sem chamadas de VSL
- [ ] beacon chega ao `api-funnel-ingress` (Network)

## Validação executável

```bash
cd site && npm run test:e2e
# GA4 DebugView: eventos section_*/vsl_section_* com parâmetros
# DevTools Network: POST ENGAGEMENT_SNAPSHOT para api-funnel-ingress
```

## Rollback

```bash
# remover <script> do engagement das 2 páginas
git checkout -- site/index.html site/planodevoo/index.html
```

GA4 e funil server-side seguem intactos (perna analytics e D1 independentes do wiring).

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova. Planning Review obrigatório (dados pessoais/LGPD).

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- VSL só na ESG? PLANOVOO sem VSL? config injetada sem hardcode no JS?
- Consent Mode respeitado antes da stitching?

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
