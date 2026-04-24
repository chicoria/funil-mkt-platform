import { describe, expect, it, vi } from "vitest";
import worker from "../../src/index";

function makeD1Stub() {
  const prepared: string[] = [];
  const runs: Array<{ query: string; binds: unknown[] }> = [];
  return {
    prepared,
    runs,
    db: {
      prepare: vi.fn((query: string) => {
        prepared.push(query);
        const state = { binds: [] as unknown[] };
        return {
          bind: vi.fn((...values: unknown[]) => {
            state.binds = values;
            return {
              run: vi.fn(async () => {
                runs.push({ query, binds: state.binds });
                return {};
              }),
              first: vi.fn(async () => null),
            };
          }),
          run: vi.fn(async () => {
            runs.push({ query, binds: [] });
            return {};
          }),
          first: vi.fn(async () => null),
        };
      }),
    },
  };
}

function makeEnv(overrides: Record<string, unknown> = {}): any {
  const kvStore = new Map<string, string>();
  const identityStore = new Map<string, string>();
  const identityDb = makeD1Stub();
  const eventStoreDb = makeD1Stub();
  return {
    DEDUPE_KV: {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kvStore.set(key, value);
      }),
    },
    IDENTITY_KV: {
      get: vi.fn(async (key: string) => identityStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        identityStore.set(key, value);
      }),
    },
    IDENTITY_DB: identityDb.db,
    EVENT_STORE_DB: eventStoreDb.db,
    ...overrides,
  };
}

describe("funnel-dispatcher", () => {
  it("retorna health", async () => {
    const res = await worker.fetch(new Request("https://x/health"));
    expect(res.status).toBe(200);
  });

  it("executa chain default e dedupe em reenvio", async () => {
    const env = makeEnv();
    const event = {
      event_id: "evt-1",
      event_type: "GENERATE_LEAD",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "site",
      occurred_at: new Date().toISOString(),
      payload: {},
    };

    await worker.queue({ messages: [{ body: event }] }, env);
    await worker.queue({ messages: [{ body: event }] }, env);

    expect(env.DEDUPE_KV.put).toHaveBeenCalled();
    const putCalls = (env.DEDUPE_KV.put as any).mock.calls.length;
    expect(putCalls).toBe(5);
  });

  it("usa chain do catalog_json quando presente", async () => {
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_ESG_MENTORIA: {
            funnelEventArchitecture: {
              events: [{ eventType: "GENERATE_LEAD", chain: ["update_brevo_funnel"] }],
            },
          },
        },
      }),
    });

    const event = {
      event_id: "evt-2",
      event_type: "GENERATE_LEAD",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "site",
      occurred_at: new Date().toISOString(),
      payload: {},
    };

    await worker.queue({ messages: [{ body: event }] }, env);
    expect((env.DEDUPE_KV.put as any).mock.calls.length).toBe(1);
  });

  it("resolve identity e grava event_store com profile_id", async () => {
    const env = makeEnv();
    const event: any = {
      event_id: "evt-identity-1",
      event_type: "GENERATE_LEAD",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "site",
      occurred_at: new Date().toISOString(),
      lead: { email: "qa.identity@example.com" },
      identity: { anonymous_id: "anon-identity-1" },
      payload: {},
    };

    await worker.queue({ messages: [{ body: event }] }, env);

    expect(event.payload.profile_id).toBeTruthy();
    expect(env.IDENTITY_KV.put).toHaveBeenCalled();
    const hasEventInsert = (env.EVENT_STORE_DB.prepare as any).mock.calls.some((call: any[]) =>
      String(call[0]).includes("INSERT INTO funnel_events")
    );
    expect(hasEventInsert).toBe(true);
  });

  it("envia confirmation_url no DOI a partir do catalog", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY: "set",
      BREVO_DOI_TEMPLATE_ID: "1",
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_ESG_MENTORIA: {
            funnelEventArchitecture: {
              events: [
                {
                  eventType: "GENERATE_LEAD",
                  chain: ["send_brevo_doi"],
                  brevoConfig: { doiRedirectUrl: "https://decolesuacarreiraesg.com.br/confirmacao.html" },
                },
              ],
            },
          },
        },
      }),
    });

    const event: any = {
      event_id: "evt-doi-1",
      event_type: "GENERATE_LEAD",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "site",
      occurred_at: new Date().toISOString(),
      lead: { email: "qa.doi@example.com" },
      payload: {},
    };

    await worker.queue({ messages: [{ body: event }] }, env);

    const emailCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/smtp/email"));
    expect(emailCall).toBeTruthy();
    const body = JSON.parse(String((emailCall?.[1] as RequestInit)?.body || "{}")) as {
      params?: Record<string, string>;
    };
    expect(body.params?.confirmation_url).toBe("https://decolesuacarreiraesg.com.br/confirmacao.html");

    vi.unstubAllGlobals();
  });

  it("envia email de carrinho abandonado usando templateId do catalog por produto", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY: "set",
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            name: "DECOLE - Plano de Voo",
            links: { checkoutBaseUrl: "https://pay.hotmart.com/R105463680A?off=f3yweqek" },
            funnelEventArchitecture: {
              events: [
                {
                  eventType: "PURCHASE_OUT_OF_SHOPPING_CART",
                  chain: ["send_cart_abandonment_email"],
                  brevoConfig: { cartAbandonmentTemplateId: "11" },
                },
              ],
            },
          },
        },
      }),
    });

    const event: any = {
      event_id: "evt-cart-1",
      event_type: "PURCHASE_OUT_OF_SHOPPING_CART",
      product_code: "DECOLE_PLANOVOO",
      source: "hotmart",
      occurred_at: new Date().toISOString(),
      lead: { email: "qa.cart@example.com" },
      payload: {},
    };

    await worker.queue({ messages: [{ body: event }] }, env);

    const emailCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/smtp/email"));
    expect(emailCall).toBeTruthy();
    const body = JSON.parse(String((emailCall?.[1] as RequestInit)?.body || "{}")) as {
      templateId?: number;
      params?: Record<string, string>;
    };
    expect(body.templateId).toBe(11);
    expect(body.params?.checkout_url).toBe("https://pay.hotmart.com/R105463680A?off=f3yweqek");
    expect(body.params?.checkoutUrl).toBe("https://pay.hotmart.com/R105463680A?off=f3yweqek");
    expect(body.params?.product_name).toBe("DECOLE - Plano de Voo");
    expect(body.params?.productName).toBe("DECOLE - Plano de Voo");

    vi.unstubAllGlobals();
  });
});
