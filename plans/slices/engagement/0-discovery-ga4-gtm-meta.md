# Slice 0-disc — Descoberta GA4/GTM/Meta + deriva de credenciais

> Satélite: engagement
> Estimativa: 3–4 horas (read-only)

## Status

| Campo | Valor |
|---|---|
| Estado | CODE_REVIEW |
| Started | 2026-05-29 por Claude Sonnet 4.6 |
| Completed | — (aguarda Slice Validator) |
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

### 2026-05-29 por Claude Sonnet 4.6

- Autenticado via `GOOGLE_APPLICATION_CREDENTIALS` (service account file; `GOOGLE_SERVICE_ACCOUNT_JSON` no env estava inválido).
- GA4 Admin API: 7 dimensões event-scoped existentes (`cta_*` + `produto`), 43 slots livres.
- GTM Web (workspace 21): 14 tags, 9 triggers, ~35 variables. Padrão `cta_click` confirmado (tag [51], trigger [44], vars `DL - *` [45–50]).
- GTM Server (workspace 16): **vazio** — nenhuma tag, trigger ou variável.
- Meta: 2 pixels activos (`1329973348435032` ESG, `2220600768748665` PLANOVOO), disparados ontem. Eventos activos: `cta_click` + `PageView` (ESG); + `InitiateCheckout`, `Lead`, `form_start` (PLANOVOO). Sem custom conversions no ad account. API `/custom_events` não disponível com o token actual.
- Deriva de credenciais analisada: catálogo tem nomes `*_DECOLE` que são os corretos para produção; `.env.local` tem nomes simplificados (sem sufixo) — não afecta produção mas requer aliases para testes locais.
- Relatório completo: `0-disc-relatorio-descoberta.md`.

## Gotchas / lições aprendidas

- `GOOGLE_SERVICE_ACCOUNT_JSON` no `.env.local` estava inválido (formato incorreto); usar `GOOGLE_APPLICATION_CREDENTIALS` (path para o JSON file) que funciona.
- GTM Server container existe (`241313282`) mas está vazio — a config Meta CAPI actual está no GTM **Web** (tags HTML). Para 1J: opção mais simples é adicionar ao Web (padrão existente); Server requer setup completo.
- Meta Graph API v21.0 com System User token não expõe `/custom_events`, `/datasets` ou `/events` directamente — usar `/stats?aggregation=event` para ver eventos activos por hora.
- Deriva catálogo↔env.local: nomes no catálogo (`GA4_PROPERTY_ID_DECOLE`, `META_CAPI_ACCESS_TOKEN_DECOLE`, etc.) são os correctos para produção. O `.env.local` local precisa de ter esses nomes para testes locais funcionarem.
