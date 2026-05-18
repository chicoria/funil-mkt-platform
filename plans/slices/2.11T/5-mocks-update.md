# Slice 2.11T.5 — Bridge de mocks para transição v4→v5

> Satélite: 2.11A seção 11.4.6

## Status

| Campo | Valor |
|---|---|
| Estado | DONE |
| Started | 2026-05-18 ~08:15 por Claude Code |
| Completed | 2026-05-18 ~08:17 por Claude Code |
| Commit final | `6e54f70` |

## Contexto

Os testes existentes passam `BREVO_API_KEY: "set"` porque o catálogo v5 AINDA tem `brevo_api_key_env: "BREVO_API_KEY"`. Quando a Fase 2 mudar para `"BREVO_API_KEY_DECOLE"`, esses testes quebrariam.

## Entregável

`workers/funnel-dispatcher/test/helpers/make-test-env.ts` — helper `makeTestEnv()` com AMBOS os env var names (v4 + v5 por tenant DECOLE), permitindo que os testes existentes sobrevivam à renomeação da Fase 2 sem reescrita massiva.

Os testes existentes em `index.test.ts` continuam usando `makeEnv()` local (correto para agora). O novo `makeTestEnv()` será adotado gradualmente em Fase 2 quando cada handler for refatorado.

## Nota

Os testes novos (`cross-tenant-isolation.test.ts`) já usam o padrão correto v5 (`BREVO_API_KEY_DECOLE`, `SGTM_ENDPOINT_URL_DECOLE`, etc.), servindo como modelo para os refactors de Fase 2.
