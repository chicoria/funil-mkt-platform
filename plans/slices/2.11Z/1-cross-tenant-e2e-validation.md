# Slice 2.11Z.1 — Smoke E2E cross-slice com validação de produção

> Satélite: 2.11Z (validação cruzada)
> Estimativa: 2–3 horas

## Status

| Campo | Valor |
|---|---|
| Estado | IN_PROGRESS |
| Started | 2026-05-19 por Claude Sonnet 4.6 |
| Completed | — |
| Commit final | — |

## Contexto

Sistema não tem tráfego orgânico — substituímos o período de 48h por uma suite E2E
executável contra produção. Cobre: HTTP endpoints, fluxo completo de eventos via
api-funnel-ingress → Queue → funnel-dispatcher → D1, isolamento cross-tenant,
fix de identity resolution (2.11A.10), e dashboard-sync com `?tenant=`.

## Script

`scripts/e2e-prod.sh` — executável contra produção real.

## Validação executável

```bash
bash scripts/e2e-prod.sh
# Esperado: PASS em todos os cenários obrigatórios
```

## Smoke checklist

- [ ] links-redirect: todas as URLs conhecidas → HTTP correto
- [ ] api-funnel-ingress: CORS OK para origem válida; 403 para inválida
- [ ] api-hotmart-ingress: rejeita webhook sem HMAC
- [ ] dashboard-sync: `/sync/status` com secret → 200; sem secret → 401
- [ ] dashboard-sync: `?tenant=desconhecido` → 400
- [ ] Evento enviado via api-funnel-ingress → aparece em D1 (funnel_events)
- [ ] Cross-tenant: evento de `superare-test` não aparece em queries de `decole`
- [ ] Identity resolution: dois emails diferentes, mesmo anonymous_id → profile_ids distintos em identity_links

## Revisão G.12

> ⛔ **GUARD RAIL:** agente implementador NÃO pode auto-aprovar.

(a preencher pelo revisor externo)

---

## Execução (append-only)

### 2026-05-19 por Claude Sonnet 4.6

- Recovery point: `7541724`
- Contexto: sistema sem tráfego orgânico → E2E executável substitui janela de 48h
- Próximo: criar `scripts/e2e-prod.sh` e executar

## Gotchas / lições aprendidas

(a preencher)
