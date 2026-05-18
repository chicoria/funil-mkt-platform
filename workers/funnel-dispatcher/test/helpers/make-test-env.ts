/**
 * Test environment factory — Slice 2.11T.5
 *
 * Fornece env vars com AMBOS os nomes de variável (v4 global + v5 por tenant)
 * para que os testes existentes continuem funcionando durante a janela de
 * coexistência enquanto a Fase 2 renomeia os env vars no catálogo.
 *
 * ANTES da Fase 2 (catálogo v5 ainda com `brevo_api_key_env: "BREVO_API_KEY"`):
 *   - Tests passam BREVO_API_KEY → handler lê via ctx.credentials.brevoApiKey
 *
 * DEPOIS da Fase 2 (catálogo com `brevo_api_key_env: "BREVO_API_KEY_DECOLE"`):
 *   - Tests precisam de BREVO_API_KEY_DECOLE (já incluído neste helper)
 *   - BREVO_API_KEY fica como fallback para handlers legados ainda não migrados
 *
 * Uso: substituir `makeEnv(overrides)` por `makeTestEnv(overrides)` nos testes
 * que testam comportamento de Brevo/tracking com o catálogo bundled (não custom).
 */

import { vi } from "vitest";

/** Cria stub de D1 para testes de dispatcher. */
export function makeD1Stub() {
  const queries: Array<{ sql: string; binds: unknown[] }> = [];
  return {
    queries,
    db: {
      prepare: vi.fn((sql: string) => {
        const state = { binds: [] as unknown[] };
        return {
          bind: vi.fn((...values: unknown[]) => {
            state.binds = values;
            return {
              run: vi.fn(async () => { queries.push({ sql, binds: state.binds }); return {}; }),
              first: vi.fn(async () => null),
            };
          }),
          run: vi.fn(async () => { queries.push({ sql, binds: [] }); return {}; }),
          first: vi.fn(async () => null),
        };
      }),
    },
  };
}

/**
 * Cria env de teste com suporte à transição v4→v5 de env vars.
 *
 * Inclui AMBOS os nomes de secret (global v4 + por-tenant v5) para que
 * os testes funcionem independente de qual versão do catálogo está ativa.
 *
 * @param overrides - Variáveis específicas do teste (sobrescrevem defaults)
 */
export function makeTestEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const kvStore = new Map<string, string>();
  const identityStore = new Map<string, string>();
  const identityDb = makeD1Stub();
  const eventStoreDb = makeD1Stub();

  return {
    // Bindings obrigatórios
    DEDUPE_KV: {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { kvStore.set(key, value); }),
    },
    IDENTITY_KV: {
      get: vi.fn(async (key: string) => identityStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { identityStore.set(key, value); }),
      delete: vi.fn(async (key: string) => { identityStore.delete(key); }),
    },
    IDENTITY_DB: identityDb.db,
    EVENT_STORE_DB: eventStoreDb.db,

    // ── Bridge v4→v5: ambos os nomes de secret (DECOLE) ──────────────────
    // v4 (global): lido quando catálogo não tem credentials com env var específico
    BREVO_API_KEY: "test-brevo-key",
    N8N_WEBHOOK_URL: "https://n8n.test.com/webhook",
    // v5 (por tenant): lido quando catálogo tem credentials.brevo_api_key_env="BREVO_API_KEY_DECOLE"
    BREVO_API_KEY_DECOLE: "test-brevo-key",
    N8N_WEBHOOK_URL_DECOLE: "https://n8n.test.com/webhook",
    // sGTM: v4 por produto → v5 por tenant
    SGTM_ENDPOINT_URL: "https://sgtm.test.com",
    SGTM_ENDPOINT_URL_DECOLE: "https://sgtm.test.com",
    // GA4: v4 global → v5 por tenant
    GA4_MEASUREMENT_ID: "G-TEST",
    GA4_MEASUREMENT_ID_DECOLE: "G-TEST",
    GA4_API_SECRET: "test-secret",
    GA4_API_SECRET_DECOLE: "test-secret",
    // Meta Pixel: permanece por produto
    META_PIXEL_ID_DECOLE_ESG: "111",
    META_PIXEL_ID_DECOLE_PLANOVOO: "222",
    // CAPI
    META_CAPI_ACCESS_TOKEN_DECOLE: "test-capi-token",
    // Plano de Voo (DECOLE-exclusive)
    PLANOVOO_API_BASE_URL: "https://plano.test.com",
    PLANOVOO_API_BASE_URL_DECOLE: "https://plano.test.com",
    PLANOVOO_HOOK_SECRET: "test-hook-secret",
    PLANOVOO_HOOK_SECRET_DECOLE: "test-hook-secret",

    // Sobrescritas específicas do teste (maior prioridade)
    ...overrides,
  };
}
