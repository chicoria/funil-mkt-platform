# Slice 0-disc — Descoberta GA4/GTM/Meta + deriva de credenciais

> Satélite: engagement
> Estimativa: 3–4 horas (read-only)

## Status

| Campo | Valor |
|---|---|
| Estado | TODO |
| Started | — |
| Completed | — |
| Commit final | — |
| PR | — |

## Contexto

Antes de configurar eventos/dimensões customizadas (1H/1I/1J) é preciso saber o estado **live** de GA4 (dimensões já registradas), GTM Web+Server (tags/vars/triggers existentes) e Meta (pixels/eventos), e resolver a deriva de nomes de credenciais entre catálogo e `.env.local`. Read-only; nenhuma mudança.

## Pré-requisitos

- [ ] Acesso a `.env.local` (nomes; valores nunca expostos/commitados)
- [ ] Service account com permissão de leitura em GA4 Admin API e GTM API
- [ ] `META_SYSTEM_USER_ACCESS_TOKEN` válido

## Mudança

### Arquivos a criar/modificar

| Arquivo | Ação | Descrição |
|---|---|---|
| `plans/slices/engagement/0-discovery-ga4-gtm-meta.md` | EDIT | registrar achados na seção Execução |
| (relatório de descoberta) | CREATE | doc com estado live + mapa de credenciais confirmado |

### Itens a levantar

- **GA4 Admin API** (`customDimensions.list`): quais dimensões event-scoped já existem (confirmar `produto`); quantas das 50 livres.
- **GTM Web** (`accounts.containers.workspaces.{tags,triggers,variables}.list`): inventário atual (confirmar padrão `cta_click` de `trafego/gtm/cta-click-import.json`).
- **GTM Server**: tags/clients existentes p/ Meta CAPI.
- **Meta** (Graph API): pixels (`META_PIXEL_ID_*`), eventos custom e custom conversions já definidos.
- **Deriva de nomes**: confirmar quais env vars os workers/dashboard realmente leem (`GA4_API_SECRET` vs `GA4_API_SECRET_DECOLE`, `META_CAPI_ACCESS_TOKEN_DECOLE` vs `_DECOLE_ESG`, etc.).

## Testes

N/A (read-only). Critério = relatório completo e sem ambiguidade de nomes.

## Validação executável

```bash
# Inventário de nomes de env (valores redigidos)
grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' .env.local | sed 's/=$//' | grep -iE "GA4|GTM|META|GOOGLE|SGTM"
# GA4 Admin API list customDimensions (script com SA; não imprimir secret)
# GTM API list tags/variables/triggers (web + server)
# Meta Graph: GET /{pixel-id}/events (ou Events Manager)
```

## Rollback

N/A — slice read-only.

## Revisão G.12 — preenchido pelo revisor antes de DONE

> ⛔ Implementador não auto-aprova. Planning Review obrigatório.

**Resultado:** APROVADO | APROVADO COM RESSALVAS | REPROVADO
- Relatório cobre GA4 + GTM Web + Server + Meta?
- Deriva de credenciais resolvida com nomes confirmados?

## Execução (append-only)

_(vazio — não iniciado)_

## Gotchas / lições aprendidas

- _(a preencher)_
