/**
 * Cross-tenant isolation tests — Slice 2.11T.3
 *
 * Verifica que o pipeline do dispatcher NUNCA mistura dados entre tenants:
 * - Credenciais Brevo (API key) resolvidas pelo env var correto por tenant
 * - Endpoints sGTM distintos por tenant (v5: por tenant, não por produto)
 * - KV keys de dedupe escopadas por tenant_id
 * - Produto de tenant A invisível para tenant B
 * - Tenant desconhecido não cai silenciosamente no tenant DECOLE
 *
 * Critério de aceite (G.8.1): 0 hardcode de tenant/produto no código.
 * Estes testes validam o COMPORTAMENTO que o código deve preservar.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeD1Stub() {
  const runs: Array<{ query: string; binds: unknown[] }> = [];
  return {
    runs,
    db: {
      prepare: vi.fn((query: string) => {
        const state = { binds: [] as unknown[] };
        return {
          bind: vi.fn((...values: unknown[]) => {
            state.binds = values;
            return {
              run: vi.fn(async () => { runs.push({ query, binds: state.binds }); return {}; }),
              first: vi.fn(async () => null),
            };
          }),
          run: vi.fn(async () => { runs.push({ query, binds: [] }); return {}; }),
          first: vi.fn(async () => null),
        };
      }),
    },
  };
}

function makeEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const kvStore = new Map<string, string>();
  const identityStore = new Map<string, string>();
  return {
    DEDUPE_KV: {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { kvStore.set(key, value); }),
    },
    IDENTITY_KV: {
      get: vi.fn(async (key: string) => identityStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { identityStore.set(key, value); }),
      delete: vi.fn(async (key: string) => { identityStore.delete(key); }),
    },
    IDENTITY_DB: makeD1Stub().db,
    EVENT_STORE_DB: makeD1Stub().db,
    ...overrides,
  };
}

/**
 * Catálogo v5 com 2 tenants com credenciais e endpoints completamente distintos.
 * DECOLE usa BREVO_API_KEY_DECOLE e sgtm-decole.example.com.
 * SUPERARE usa BREVO_API_KEY_SUPERARE e sgtm-superare.example.com.
 */
const MULTI_TENANT_CATALOG = JSON.stringify({
  tenants: {
    decole: {
      name: "DECOLE",
      domains: ["api.decolesuacarreiraesg.com.br"],
      credentials: {
        brevo_api_key_env: "BREVO_API_KEY_DECOLE",
        hotmart_token_env: "HOTMART_TOKEN_DECOLE",
        replyToEmail: "contato@decole.com.br",
      },
      products: {
        DECOLE_ESG_MENTORIA: {
          brevo: {
            funnelPrefix: "DECOLE_ESG",
            funnelFields: {
              steps: "DECOLE_ESG_STEPS",
              lastStep: "DECOLE_ESG_LAST_STEP",
              lastStepTimestamp: "DECOLE_ESG_LAST_STEP_TS",
            },
          },
          tracking: {
            sgtm: { endpointEnvVar: "SGTM_ENDPOINT_URL_DECOLE" },
            ga4: {
              measurementId: "G-DECOLE-123",
              measurementIdEnvVar: "GA4_MEASUREMENT_ID_DECOLE",
              apiSecretEnvVar: "GA4_API_SECRET_DECOLE",
              differentiationKeys: { produto: "DECOLE_ESG_MENTORIA" },
            },
          },
          funnelEventArchitecture: {
            events: [
              { eventType: "GENERATE_LEAD", chain: ["update_brevo_funnel"] },
              { eventType: "PURCHASE_APPROVED", chain: ["update_brevo_funnel", "emit_tracking"] },
            ],
          },
        },
      },
    },
    superare: {
      name: "SUPERARE",
      domains: ["api.superare.com.br"],
      credentials: {
        brevo_api_key_env: "BREVO_API_KEY_SUPERARE",
        hotmart_token_env: "HOTMART_TOKEN_SUPERARE",
        replyToEmail: "contato@superare.com.br",
      },
      products: {
        SUPERARE_CURSO_X: {
          brevo: {
            funnelPrefix: "SUPERARE_X",
            funnelFields: {
              steps: "SUPERARE_X_STEPS",
              lastStep: "SUPERARE_X_LAST_STEP",
              lastStepTimestamp: "SUPERARE_X_LAST_STEP_TS",
            },
          },
          tracking: {
            sgtm: { endpointEnvVar: "SGTM_ENDPOINT_URL_SUPERARE" },
            ga4: {
              measurementId: "G-SUPERARE-456",
              measurementIdEnvVar: "GA4_MEASUREMENT_ID_SUPERARE",
              apiSecretEnvVar: "GA4_API_SECRET_SUPERARE",
              differentiationKeys: { produto: "SUPERARE_CURSO_X" },
            },
          },
          funnelEventArchitecture: {
            events: [
              { eventType: "GENERATE_LEAD", chain: ["update_brevo_funnel"] },
              { eventType: "PURCHASE_APPROVED", chain: ["update_brevo_funnel", "emit_tracking"] },
            ],
          },
        },
      },
    },
  },
});

// ─── testes ───────────────────────────────────────────────────────────────────

/**
 * Testes de isolamento via sGTM e GA4 measurement_id.
 * Mais relevante que Brevo para integridade de tracking.
 * Brevo credential isolation é coberto por tenant-resolver.test.ts (já existente).
 */
describe("cross-tenant isolation — sGTM e GA4 measurement_id por tenant", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("PURCHASE_APPROVED de DECOLE usa measurement_id e sGTM de DECOLE, nunca de SUPERARE", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      CATALOG_JSON: MULTI_TENANT_CATALOG,
      BREVO_API_KEY_DECOLE: "decole-key",
      SGTM_ENDPOINT_URL_DECOLE: "https://sgtm-decole.example.com",
      SGTM_ENDPOINT_URL_SUPERARE: "https://sgtm-superare.example.com",
      GA4_MEASUREMENT_ID_DECOLE: "G-DECOLE-123",
      GA4_API_SECRET_DECOLE: "secret-decole",
      GA4_MEASUREMENT_ID_SUPERARE: "G-SUPERARE-456",
      GA4_API_SECRET_SUPERARE: "secret-superare",
    });

    await worker.queue(
      { messages: [{ body: {
        event_id: "iso-ga4-decole-1",
        event_type: "PURCHASE_APPROVED",
        tenant_id: "decole",
        product_code: "DECOLE_ESG_MENTORIA",
        source: "hotmart",
        occurred_at: new Date().toISOString(),
        payload: { value: 1500, currency: "BRL" },
      } }] },
      env
    );

    const allUrls = fetchMock.mock.calls.map(([url]) => String(url));
    const sgtmCalls = allUrls.filter((u) => u.includes("mp/collect"));

    expect(sgtmCalls.length).toBeGreaterThan(0);
    // Usa endpoint e measurement_id do DECOLE
    expect(sgtmCalls.some((u) => u.includes("sgtm-decole.example.com"))).toBe(true);
    expect(sgtmCalls.some((u) => u.includes("measurement_id=G-DECOLE-123"))).toBe(true);
    // NUNCA usa configurações do SUPERARE
    expect(sgtmCalls.some((u) => u.includes("sgtm-superare.example.com"))).toBe(false);
    expect(sgtmCalls.some((u) => u.includes("measurement_id=G-SUPERARE-456"))).toBe(false);
  });

  it("PURCHASE_APPROVED de SUPERARE usa measurement_id e sGTM de SUPERARE, nunca de DECOLE", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      CATALOG_JSON: MULTI_TENANT_CATALOG,
      BREVO_API_KEY_SUPERARE: "superare-key",
      SGTM_ENDPOINT_URL_DECOLE: "https://sgtm-decole.example.com",
      SGTM_ENDPOINT_URL_SUPERARE: "https://sgtm-superare.example.com",
      GA4_MEASUREMENT_ID_DECOLE: "G-DECOLE-123",
      GA4_API_SECRET_DECOLE: "secret-decole",
      GA4_MEASUREMENT_ID_SUPERARE: "G-SUPERARE-456",
      GA4_API_SECRET_SUPERARE: "secret-superare",
    });

    await worker.queue(
      { messages: [{ body: {
        event_id: "iso-ga4-superare-1",
        event_type: "PURCHASE_APPROVED",
        tenant_id: "superare",
        product_code: "SUPERARE_CURSO_X",
        source: "hotmart",
        occurred_at: new Date().toISOString(),
        payload: { value: 2000, currency: "BRL" },
      } }] },
      env
    );

    const allUrls = fetchMock.mock.calls.map(([url]) => String(url));
    const sgtmCalls = allUrls.filter((u) => u.includes("mp/collect"));

    expect(sgtmCalls.length).toBeGreaterThan(0);
    expect(sgtmCalls.some((u) => u.includes("sgtm-superare.example.com"))).toBe(true);
    expect(sgtmCalls.some((u) => u.includes("measurement_id=G-SUPERARE-456"))).toBe(true);
    expect(sgtmCalls.some((u) => u.includes("sgtm-decole.example.com"))).toBe(false);
    expect(sgtmCalls.some((u) => u.includes("measurement_id=G-DECOLE-123"))).toBe(false);
  });
});

describe("cross-tenant isolation — sGTM endpoint", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("PURCHASE_APPROVED de DECOLE envia para sgtm-decole.example.com, nunca sgtm-superare.example.com", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      CATALOG_JSON: MULTI_TENANT_CATALOG,
      BREVO_API_KEY_DECOLE: "decole-key",
      SGTM_ENDPOINT_URL_DECOLE: "https://sgtm-decole.example.com",
      SGTM_ENDPOINT_URL_SUPERARE: "https://sgtm-superare.example.com",
      GA4_MEASUREMENT_ID_DECOLE: "G-DECOLE-123",
      GA4_API_SECRET_DECOLE: "secret-decole",
    });

    await worker.queue(
      { messages: [{ body: {
        event_id: "iso-sgtm-decole-1",
        event_type: "PURCHASE_APPROVED",
        tenant_id: "decole",
        product_code: "DECOLE_ESG_MENTORIA",
        source: "hotmart",
        occurred_at: new Date().toISOString(),
        payload: { value: 1500, currency: "BRL" },
      } }] },
      env
    );

    const allUrls = fetchMock.mock.calls.map(([url]) => String(url));
    const sgtmCalls = allUrls.filter((url) => url.includes("sgtm") || url.includes("mp/collect"));

    // Must call DECOLE's sGTM
    expect(sgtmCalls.some((url) => url.includes("sgtm-decole.example.com"))).toBe(true);
    // Must NOT call SUPERARE's sGTM
    expect(sgtmCalls.some((url) => url.includes("sgtm-superare.example.com"))).toBe(false);
  });

  it("PURCHASE_APPROVED de SUPERARE envia para sgtm-superare.example.com, nunca sgtm-decole.example.com", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      CATALOG_JSON: MULTI_TENANT_CATALOG,
      BREVO_API_KEY_SUPERARE: "superare-key",
      SGTM_ENDPOINT_URL_DECOLE: "https://sgtm-decole.example.com",
      SGTM_ENDPOINT_URL_SUPERARE: "https://sgtm-superare.example.com",
      GA4_MEASUREMENT_ID_SUPERARE: "G-SUPERARE-456",
      GA4_API_SECRET_SUPERARE: "secret-superare",
    });

    await worker.queue(
      { messages: [{ body: {
        event_id: "iso-sgtm-superare-1",
        event_type: "PURCHASE_APPROVED",
        tenant_id: "superare",
        product_code: "SUPERARE_CURSO_X",
        source: "hotmart",
        occurred_at: new Date().toISOString(),
        payload: { value: 2000, currency: "BRL" },
      } }] },
      env
    );

    const allUrls = fetchMock.mock.calls.map(([url]) => String(url));
    const sgtmCalls = allUrls.filter((url) => url.includes("sgtm") || url.includes("mp/collect"));

    expect(sgtmCalls.some((url) => url.includes("sgtm-superare.example.com"))).toBe(true);
    expect(sgtmCalls.some((url) => url.includes("sgtm-decole.example.com"))).toBe(false);
  });
});

describe("cross-tenant isolation — produto invisível entre tenants", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("produto de DECOLE (DECOLE_ESG_MENTORIA) não gera chamada Brevo quando processado em tenant SUPERARE", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      CATALOG_JSON: MULTI_TENANT_CATALOG,
      BREVO_API_KEY_SUPERARE: "superare-key",
    });

    // Evento com tenant_id=superare mas product_code de decole
    // → produto não existe no catálogo de SUPERARE → handlers skipped
    await worker.queue(
      { messages: [{ body: {
        event_id: "iso-cross-product-1",
        event_type: "GENERATE_LEAD",
        tenant_id: "superare",
        product_code: "DECOLE_ESG_MENTORIA",  // produto do DECOLE, não do SUPERARE
        source: "site",
        occurred_at: new Date().toISOString(),
        payload: {},
      } }] },
      env
    );

    // Produto não existe em SUPERARE → handlers Brevo não chamados
    const brevoCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("brevo"));
    expect(brevoCalls.length).toBe(0);  // nenhuma chamada Brevo feita
  });
});

describe("cross-tenant isolation — tenant desconhecido", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("evento com tenant_id desconhecido não processa via tenant DECOLE (não vaza credentials)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      CATALOG_JSON: MULTI_TENANT_CATALOG,
      BREVO_API_KEY_DECOLE: "brevo-key-decole-secret",
      SGTM_ENDPOINT_URL_DECOLE: "https://sgtm-decole.example.com",
      GA4_MEASUREMENT_ID_DECOLE: "G-DECOLE-123",
      GA4_API_SECRET_DECOLE: "secret-decole",
    });

    await worker.queue(
      { messages: [{ body: {
        event_id: "iso-unknown-tenant-1",
        event_type: "PURCHASE_APPROVED",
        tenant_id: "unknown_tenant_xyz",  // tenant não existe no catálogo
        product_code: "DECOLE_ESG_MENTORIA",
        source: "hotmart",
        occurred_at: new Date().toISOString(),
        payload: { value: 1500, currency: "BRL" },
      } }] },
      env
    );

    // Tenant desconhecido → NUNCA deve usar endpoints de DECOLE
    const allUrls = fetchMock.mock.calls.map(([url]) => String(url));
    const sgtmCalls = allUrls.filter((u) => u.includes("mp/collect"));
    expect(sgtmCalls.some((u) => u.includes("sgtm-decole.example.com"))).toBe(false);
    expect(sgtmCalls.some((u) => u.includes("measurement_id=G-DECOLE-123"))).toBe(false);

    const brevoCalls = allUrls.filter((u) => u.includes("brevo"));
    for (const [, init] of fetchMock.mock.calls.filter(([u]) => String(u).includes("brevo"))) {
      const headers = (init as RequestInit)?.headers as Record<string, string>;
      expect(headers?.["api-key"]).not.toBe("brevo-key-decole-secret");
    }
  });
});

describe("cross-tenant isolation — KV dedupe scoped por tenant_id", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("eventos de tenants diferentes com mesmo event_id são deduped independentemente", async () => {
    const kvStore = new Map<string, string>();
    const keysWritten: string[] = [];

    const env = makeEnv({
      CATALOG_JSON: MULTI_TENANT_CATALOG,
      BREVO_API_KEY_DECOLE: "decole-key",
      BREVO_API_KEY_SUPERARE: "superare-key",
      DEDUPE_KV: {
        get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => {
          keysWritten.push(key);
          kvStore.set(key, value);
        }),
      },
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));

    // Mesmo event_id para os dois tenants (edge case: dois tenants podem ter event_ids que colidem)
    await worker.queue(
      { messages: [{ body: {
        event_id: "shared-event-id-99",
        event_type: "GENERATE_LEAD",
        tenant_id: "decole",
        product_code: "DECOLE_ESG_MENTORIA",
        source: "site",
        occurred_at: new Date().toISOString(),
        payload: {},
      } }] },
      env
    );

    await worker.queue(
      { messages: [{ body: {
        event_id: "shared-event-id-99",  // mesmo ID
        event_type: "GENERATE_LEAD",
        tenant_id: "superare",
        product_code: "SUPERARE_CURSO_X",
        source: "site",
        occurred_at: new Date().toISOString(),
        payload: {},
      } }] },
      env
    );

    // KV keys devem incluir tenant_id para evitar colisão
    const decoleKeys = keysWritten.filter((k) => k.includes("decole"));
    const superareKeys = keysWritten.filter((k) => k.includes("superare"));

    // Ambos os tenants devem ter suas próprias keys
    expect(decoleKeys.length).toBeGreaterThan(0);
    expect(superareKeys.length).toBeGreaterThan(0);

    // Nenhuma key pode ser compartilhada sem o prefixo de tenant
    for (const key of keysWritten) {
      expect(key).toMatch(/decole|superare/);
    }
  });
});
