/**
 * Golden master — emit_tracking payload structure — Slice 2.11T.4
 *
 * Captura o formato EXATO do payload enviado ao sGTM/GA4 antes dos refactors
 * da Fase 2. Qualquer mudança não intencional nos campos quebrará estes testes.
 *
 * Campos protegidos: client_id, timestamp_micros, events[].name, events[].params.*
 * Campo especialmente crítico: events[].params.produto (custom dimension GA4)
 *
 * Nota: client_id e timestamp_micros são determinísticos a partir do event_id
 * e occurred_at — verificados via formato e presença, não valor exato.
 */

import { describe, expect, it, vi } from "vitest";
import worker from "../../src/index";

function makeD1Stub() {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        run: vi.fn(async () => ({})),
        first: vi.fn(async () => null),
      })),
      run: vi.fn(async () => ({})),
      first: vi.fn(async () => null),
    })),
  };
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  const kvStore = new Map<string, string>();
  return {
    DEDUPE_KV: {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { kvStore.set(key, value); }),
    },
    IDENTITY_KV: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    },
    IDENTITY_DB: makeD1Stub(),
    EVENT_STORE_DB: makeD1Stub(),
    ...overrides,
  };
}

const SGTM_ENDPOINT = "https://sgtm.example.com";
const GA4_MEASUREMENT_ID = "G-GOLDEN-TEST";
const GA4_API_SECRET = "golden-secret";

const TRACKING_CATALOG = JSON.stringify({
  products: {
    DECOLE_ESG_MENTORIA: {
      tracking: {
        productCode: "DECOLE_ESG_MENTORIA",
        sgtm: { endpointEnvVar: "SGTM_ENDPOINT_URL" },
        ga4: {
          measurementIdEnvVar: "GA4_MEASUREMENT_ID",
          apiSecretEnvVar: "GA4_API_SECRET",
          differentiationKeys: { produto: "DECOLE_ESG_MENTORIA" },
        },
      },
      funnelEventArchitecture: {
        events: [
          { eventType: "PURCHASE_APPROVED", chain: ["emit_tracking"] },
          { eventType: "BEGIN_CHECKOUT", chain: ["emit_tracking"] },
        ],
      },
    },
    DECOLE_PLANOVOO: {
      aliases: ["PLANOVOO"],
      tracking: {
        productCode: "DECOLE_PLANOVOO",
        sgtm: { endpointEnvVar: "SGTM_ENDPOINT_URL" },
        ga4: {
          measurementIdEnvVar: "GA4_MEASUREMENT_ID",
          apiSecretEnvVar: "GA4_API_SECRET",
          differentiationKeys: { produto: "DECOLE_PLANOVOO" },
        },
      },
      funnelEventArchitecture: {
        events: [
          { eventType: "PURCHASE_APPROVED", chain: ["emit_tracking"] },
        ],
      },
    },
  },
});

interface Ga4Payload {
  client_id: string;
  timestamp_micros: string;
  events: Array<{
    name: string;
    params: Record<string, unknown>;
  }>;
}

async function captureEmitTrackingPayload(eventBody: Record<string, unknown>): Promise<Ga4Payload> {
  let capturedBody: Ga4Payload | null = null;

  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes("sgtm.example.com")) {
      capturedBody = JSON.parse(String(init?.body || "{}")) as Ga4Payload;
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  vi.stubGlobal("fetch", fetchMock);

  const env = makeEnv({
    CATALOG_JSON: TRACKING_CATALOG,
    SGTM_ENDPOINT_URL: SGTM_ENDPOINT,
    GA4_MEASUREMENT_ID: GA4_MEASUREMENT_ID,
    GA4_API_SECRET: GA4_API_SECRET,
  });

  await worker.queue({ messages: [{ body: eventBody }] }, env);
  vi.unstubAllGlobals();

  if (!capturedBody) throw new Error("emit_tracking did not call sGTM — check chain config");
  return capturedBody;
}

// ─── golden master: campos obrigatórios no payload ───────────────────────────

describe("emit_tracking — golden master payload structure (PURCHASE_APPROVED ESG)", () => {
  it("URL do sGTM contém measurement_id e api_secret corretos", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("sgtm.example.com")) capturedUrl = String(url);
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      CATALOG_JSON: TRACKING_CATALOG,
      SGTM_ENDPOINT_URL: SGTM_ENDPOINT,
      GA4_MEASUREMENT_ID: GA4_MEASUREMENT_ID,
      GA4_API_SECRET: GA4_API_SECRET,
    });

    await worker.queue({ messages: [{ body: {
      event_id: "gm-url-1",
      event_type: "PURCHASE_APPROVED",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "hotmart",
      occurred_at: "2026-05-01T10:00:00.000Z",
      payload: { value: 1500, currency: "BRL" },
    } }] }, env);
    vi.unstubAllGlobals();

    expect(capturedUrl).toContain(`${SGTM_ENDPOINT}/mp/collect`);
    expect(capturedUrl).toContain(`measurement_id=${encodeURIComponent(GA4_MEASUREMENT_ID)}`);
    expect(capturedUrl).toContain(`api_secret=${encodeURIComponent(GA4_API_SECRET)}`);
  });

  it("payload body tem client_id string não vazia e timestamp_micros numérico como string", async () => {
    const payload = await captureEmitTrackingPayload({
      event_id: "gm-struct-1",
      event_type: "PURCHASE_APPROVED",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "hotmart",
      occurred_at: "2026-05-01T10:00:00.000Z",
      payload: { value: 1500, currency: "BRL", transaction: "TX-001" },
    });

    // client_id: string não vazia derivada do anonymous_id ou event_id
    expect(typeof payload.client_id).toBe("string");
    expect(payload.client_id.length).toBeGreaterThan(0);

    // timestamp_micros: string de número (microseconds)
    expect(typeof payload.timestamp_micros).toBe("string");
    expect(Number(payload.timestamp_micros)).toBeGreaterThan(0);
    expect(payload.timestamp_micros).toMatch(/^\d+$/);
  });

  it("events array contém exatamente 1 evento com name='purchase'", async () => {
    const payload = await captureEmitTrackingPayload({
      event_id: "gm-events-1",
      event_type: "PURCHASE_APPROVED",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "hotmart",
      occurred_at: "2026-05-01T10:00:00.000Z",
      payload: { value: 1500, currency: "BRL" },
    });

    expect(Array.isArray(payload.events)).toBe(true);
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0].name).toBe("purchase");
  });

  it("params contém os campos críticos para GA4: produto, currency, value, source", async () => {
    const payload = await captureEmitTrackingPayload({
      event_id: "gm-params-1",
      event_type: "PURCHASE_APPROVED",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "hotmart",
      occurred_at: "2026-05-01T10:00:00.000Z",
      payload: { value: 1500, currency: "BRL", transaction: "TX-002" },
    });

    const params = payload.events[0].params;
    // custom dimension para diferenciação no GA4 — CRÍTICO para analytics
    expect(params.produto).toBe("DECOLE_ESG_MENTORIA");
    // outros campos obrigatórios
    expect(params.currency).toBe("BRL");
    expect(params.value).toBe(1500);
    expect(params.source).toBe("hotmart");
    expect(params.transaction_id).toBe("TX-002");
    // event_id presente (dedup no GA4)
    expect(typeof params.event_id).toBe("string");
  });

  it("params.product_code bate com o product_code do evento", async () => {
    const payload = await captureEmitTrackingPayload({
      event_id: "gm-product-code-1",
      event_type: "PURCHASE_APPROVED",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "hotmart",
      occurred_at: "2026-05-01T10:00:00.000Z",
      payload: { value: 1500, currency: "BRL" },
    });

    // product_code ≠ produto (produto é o valor de diferenciação customizado)
    expect(payload.events[0].params.product_code).toBe("DECOLE_ESG_MENTORIA");
  });
});

// ─── golden master: diferenciação por produto ─────────────────────────────────

describe("emit_tracking — diferenciação por produto (params.produto)", () => {
  it("DECOLE_ESG_MENTORIA → params.produto = 'DECOLE_ESG_MENTORIA'", async () => {
    const payload = await captureEmitTrackingPayload({
      event_id: "gm-diff-esg-1",
      event_type: "PURCHASE_APPROVED",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "hotmart",
      occurred_at: "2026-05-01T10:00:00.000Z",
      payload: { value: 1500, currency: "BRL" },
    });
    expect(payload.events[0].params.produto).toBe("DECOLE_ESG_MENTORIA");
  });

  it("DECOLE_PLANOVOO → params.produto = 'DECOLE_PLANOVOO'", async () => {
    const payload = await captureEmitTrackingPayload({
      event_id: "gm-diff-planovoo-1",
      event_type: "PURCHASE_APPROVED",
      product_code: "PLANOVOO",  // alias
      source: "hotmart",
      occurred_at: "2026-05-01T10:00:00.000Z",
      payload: { value: 997, currency: "BRL" },
    });
    // alias PLANOVOO → produto = DECOLE_PLANOVOO (do catálogo)
    expect(payload.events[0].params.produto).toBe("DECOLE_PLANOVOO");
  });
});

// ─── golden master: event_name mapeamento ────────────────────────────────────

describe("emit_tracking — mapeamento event_type → GA4 event_name", () => {
  it("PURCHASE_APPROVED → events[0].name = 'purchase'", async () => {
    const payload = await captureEmitTrackingPayload({
      event_id: "gm-name-purchase-1",
      event_type: "PURCHASE_APPROVED",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "hotmart",
      occurred_at: "2026-05-01T10:00:00.000Z",
      payload: { value: 1500, currency: "BRL" },
    });
    expect(payload.events[0].name).toBe("purchase");
  });

  it("BEGIN_CHECKOUT → events[0].name = 'begin_checkout'", async () => {
    const payload = await captureEmitTrackingPayload({
      event_id: "gm-name-checkout-1",
      event_type: "BEGIN_CHECKOUT",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "site",
      occurred_at: "2026-05-01T10:00:00.000Z",
      payload: {},
    });
    expect(payload.events[0].name).toBe("begin_checkout");
  });
});

// ─── golden master: campos opcionais de atribuição ────────────────────────────

describe("emit_tracking — campos de atribuição (passados quando presentes)", () => {
  it("fbp e fbc são incluídos em params quando presentes na attribution", async () => {
    const payload = await captureEmitTrackingPayload({
      event_id: "gm-attr-1",
      event_type: "PURCHASE_APPROVED",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "hotmart",
      occurred_at: "2026-05-01T10:00:00.000Z",
      attribution: { fbp: "fb.1.123.456", fbc: "fb.1.789.012", gclid: "gclid123" },
      payload: { value: 1500, currency: "BRL" },
    });
    const params = payload.events[0].params;
    expect(params.fbp).toBe("fb.1.123.456");
    expect(params.fbc).toBe("fb.1.789.012");
    expect(params.gclid).toBe("gclid123");
  });

  it("campos de atribuição ausentes NÃO aparecem em params (sem undefined/null)", async () => {
    const payload = await captureEmitTrackingPayload({
      event_id: "gm-attr-absent-1",
      event_type: "PURCHASE_APPROVED",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "hotmart",
      occurred_at: "2026-05-01T10:00:00.000Z",
      payload: { value: 1500, currency: "BRL" },
    });
    const params = payload.events[0].params;
    // Campos ausentes NÃO devem aparecer (nem como undefined nem null)
    expect("fbp" in params).toBe(false);
    expect("fbc" in params).toBe(false);
    expect("gclid" in params).toBe(false);
  });
});
