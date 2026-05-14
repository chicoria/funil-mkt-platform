# BACKLOG-005 - Update técnico (2026-04-27)

## Escopo
Validacao E2E do fluxo server-side para tracking via Cloudflare + sGTM, com foco em entrega para GA4 e Meta.

## O que foi implementado/ajustado
- `funnel-dispatcher` (`emit_tracking`) envia para `sGTM /mp/collect` com:
  - `event_id`
  - `meta_event_name`
  - `meta_test_event_code` e `test_event_code` (quando informado)
- Script de replay atualizado para suportar injeção de codigo de teste Meta:
  - `scripts/replay-emit-tracking.mjs`
  - flag: `--meta-test-event-code`
- Suite de validacao E2E criada/organizada em:
  - `tests/e2e-server-side-tracking/`
  - `run-e2e-server-side-tracking.sh`
  - `verify-ga4-realtime.mjs`
  - `verify-sgtm-meta-delivery.mjs`
  - `verify-meta-stats-delta.mjs`
  - `README.MD`

## Evidencias objetivas (event_id)
- `GA4ROUTE-1777300917`:
  - envio via rota GA4 (`/g/collect`) com HTTP 200
  - confirmado no Meta Events Manager como recebido/processado
- `GA4ROUTE-1777301651`:
  - envio via rota GA4 (`/g/collect`) com HTTP 200
  - validacao em andamento no momento do registro

## Diagnostico atual
- Fluxo por `/g/collect` esta funcional ponta a ponta (confirmado no Meta).
- Em alguns ciclos, a verificacao automatica de GA4 Realtime retornou `event_not_visible_yet` dentro da janela de polling, apesar de entrega confirmada no servidor.
- Gap principal para `/mp/collect` ficou no lado de configuracao do sGTM (client/tag/trigger/mapeamentos), nao no payload base emitido pelo worker.

## Causa raiz provavel para divergencias
- Configuracao de trigger/tag no sGTM nao totalmente alinhada para trafego de `Measurement Protocol (GA4)` em todos os cenarios.
- Janela curta de polling da API de realtime pode gerar falso negativo.

## Proximo passo recomendado
1. Padronizar trigger server-side para aceitar eventos de `/g/collect` e `/mp/collect`.
2. Garantir mapeamento explicito de:
   - `event_name` (Meta)
   - `test_event_code` <- `meta_test_event_code`/`test_event_code`
3. Rodar replay com `--meta-test-event-code` e validar no sGTM Preview + Meta Test Events pelo mesmo `event_id`.
4. Ajustar o script E2E para considerar sucesso quando houver confirmacao em Meta e GA4, evitando falso negativo de latencia do realtime.

## Correcoes aplicadas via API (2026-04-27)

Inspecao direta do container sGTM `GTM-K6Q4H6BR` (conta 6266094107, container 241313282, workspace 16) revelou 3 bugs que bloqueavam entrega Meta via `/mp/collect`:

### Bug 1 — Trigger PLANOVOO com filtro errado (CORRIGIDO)
- **Trigger 12** `FB_CONVERSIONS_API-2220600768748665-Server-Trigger`
- Tinha filtro `Event Name matches ^app_.+` — nunca disparava para `purchase`, `begin_checkout`, `generate_lead`
- Corrigido: filtro removido, tipo `always` sem condicao

### Bug 2 — testEventCode hardcoded errado na tag DECOLE ESG (CORRIGIDO)
- **Tag 10** `FB_CONVERSIONS_API-1329973348435032-Server-Tag`
- Tinha `testEventCode = TEST19244` (hardcoded incorreto)
- Worker enviava `test_event_code = TEST15651` (do env `META_TEST_EVENT_CODE_DECOLE_ESG`)
- Eventos chegavam na Meta sob TEST19244, nao TEST15651 — apareciam como "nao entregues" no painel errado
- Corrigido: `testEventCode = TEST15651`

### Bug 3 — GTM_WORKSPACE_ID_SERVER incorreto no .env.local (CORRIGIDO)
- Estava como `13`, workspace correto e `Default Workspace` e o ID `16`
- Corrigido em `.env.local`

### Publicacao
- Versao **v16** `fix-sgtm-meta-triggers` criada e publicada via GTM API
- Container sGTM atualizado em producao: `https://sgtm.decolesuacarreiraesg.com.br`

### Proximo passo
- Rodar `replay-emit-tracking.mjs --meta-test-event-code TEST15651 --apply` com um evento recente
- Verificar no Meta Test Events (codigo TEST15651) que o evento aparece com entrega confirmada

## Observacoes operacionais
- Nenhum secret foi registrado neste update.

---

## Update 2026-04-28 — Fixes de tracking + Suite E2E completa

### Correcoes aplicadas (deploy em producao)

**1. Meta CAPI nao recebia user data**
`emitTracking` nao incluia campos de utilizador no payload enviado ao sGTM. O template Meta CAPI no sGTM descarta eventos silenciosamente sem pelo menos um campo de user data.
- `em` (email hash SHA-256) adicionado ao payload `/mp/collect`
- `client_ip_address` adicionado quando disponivel

**2. `client_ip` capturado nas fontes corretas**
- `api-funnel-ingress` → endpoint `/funnel/precheckout` via `CF-Connecting-IP`
- `links-redirect` → `buildBeginCheckoutEvent` via `CF-Connecting-IP`

**3. Handler `enrich_attribution` (novo)**
Eventos Hotmart chegam sem `fbp`/`fbc`/`client_ip`. Novo handler recupera esses campos do evento site mais recente do mesmo `profile_id` em D1 e injeta antes do `emit_tracking`.

Cadeia: `resolve_identity → upsert_event_store → enrich_attribution → update_brevo_funnel → emit_tracking`

**4. `PURCHASE_OUT_OF_SHOPPING_CART` removido do sGTM**
Duplicava `InitiateCheckout` com `BEGIN_CHECKOUT`. Chain agora: `resolve_identity → upsert_event_store → update_brevo_funnel → send_cart_abandonment_email`

**5. `payload_json` em D1 inclui attribution**
`upsertEventStoreRecord` faz merge de `event.attribution` + `event.payload`. Antes so guardava `event.payload`, tornando `enrich_attribution` incapaz de encontrar `fbp` de eventos site anteriores.

**6. Handlers externos nao-fatais**
`sendBrevoEmail`, `updateBrevoFunnel` e `forwardN8n` envolvidos em try/catch. Erros HTTP ja nao causam retry da queue message que bloqueava `upsert_event_store`.

### Suite E2E de referencia

`tests/` — 8 cenarios independentes, todos verdes em producao:

| # | Cenario | Tags |
|---|---|---|
| 01 | generate-lead | ingress, identity |
| 02 | begin-checkout | ingress, identity, tracking, sgtm |
| 03 | purchase-approved | hotmart, identity, tracking, sgtm |
| 04 | cart-abandonment | hotmart — confirma SEM sgtm |
| 05 | identity-stitch | identity |
| 06 | attribution-enrichment | identity, tracking, sgtm |
| 07 | deduplication | ingress, identity |
| 08 | sgtm-payload | tracking, sgtm |

```bash
# Regressao rapida (antes de qualquer deploy)
./tests/run-scenarios.sh --all --skip-sgtm

# Validacao completa
./tests/run-scenarios.sh --all --meta-test-event-code TEST15651
```

### Workers deployados

- `decole-links-redirect` v4b030fa6
- `decole-api-funnel-ingress` vbb54fa47
- `decole-funnel-dispatcher` v16c5cb74

### Commits

- `693d1f6` feat(tracking): enrich Meta CAPI user data and fix InitiateCheckout deduplication
- `b52ff26` feat(tests): add E2E scenario suite for full funnel validation
- `6e6feff` fix(e2e): resolve issues found during E2E suite execution
- `1b1abe8` fix(dispatcher): make Brevo/n8n handler errors non-fatal to prevent queue retries
