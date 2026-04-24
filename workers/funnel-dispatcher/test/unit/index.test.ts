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

  it("executa chain do catalog embutido e dedupe em reenvio", async () => {
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

  it("atualiza Brevo com campos de funil por produto", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY: "set",
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_ESG_MENTORIA: {
            brevo: {
              funnelFields: {
                steps: "DECOLE_ESG_FUNIL_STEPS",
                lastStep: "DECOLE_ESG_FUNIL_LAST_STEP",
                lastStepTimestamp: "DECOLE_ESG_FUNIL_LAST_STEP_TIMESTAMP",
              },
            },
            funnelEventArchitecture: {
              events: [{ eventType: "PURCHASE_APPROVED", chain: ["update_brevo_funnel"] }],
            },
          },
          DECOLE_PLANOVOO: {
            aliases: ["PLANOVOO"],
            brevo: {
              funnelFields: {
                steps: "DECOLE_PLANOVOO_FUNIL_STEPS",
                lastStep: "DECOLE_PLANOVOO_FUNIL_LAST_STEP",
                lastStepTimestamp: "DECOLE_PLANOVOO_FUNIL_LAST_STEP_TIMESTAMP",
              },
            },
            funnelEventArchitecture: {
              events: [{ eventType: "PURCHASE_APPROVED", chain: ["update_brevo_funnel"] }],
            },
          },
        },
      }),
    });

    await worker.queue(
      {
        messages: [
          {
            body: {
              event_id: "evt-brevo-esg-1",
              event_type: "PURCHASE_APPROVED",
              product_code: "DECOLE_ESG_MENTORIA",
              source: "hotmart",
              occurred_at: "2026-04-24T12:00:00.000Z",
              lead: { email: "qa.brevo.esg@example.com" },
              payload: {},
            },
          },
        ],
      },
      env
    );

    const esgCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/contacts"));
    expect(esgCall).toBeTruthy();
    const esgBody = JSON.parse(String((esgCall?.[1] as RequestInit)?.body || "{}")) as {
      attributes?: Record<string, string>;
    };
    expect(esgBody.attributes?.DECOLE_ESG_FUNIL_LAST_STEP).toBe("PURCHASE_APPROVED");
    expect(esgBody.attributes?.DECOLE_ESG_FUNIL_STEPS).toBe("PURCHASE_APPROVED");
    expect(esgBody.attributes?.DECOLE_ESG_FUNIL_LAST_STEP_TIMESTAMP).toBe("2026-04-24T12:00:00.000Z");
    expect(esgBody.attributes?.PRODUCT_CODE).toBe("DECOLE_ESG_MENTORIA");

    await worker.queue(
      {
        messages: [
          {
            body: {
              event_id: "evt-brevo-planovoo-1",
              event_type: "PURCHASE_APPROVED",
              product_code: "PLANOVOO",
              source: "hotmart",
              occurred_at: "2026-04-24T13:00:00.000Z",
              lead: { email: "qa.brevo.planovoo@example.com" },
              payload: {},
            },
          },
        ],
      },
      env
    );

    const contactsCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/contacts"));
    const planovooCall = contactsCalls[1];
    expect(planovooCall).toBeTruthy();
    const planovooBody = JSON.parse(String((planovooCall?.[1] as RequestInit)?.body || "{}")) as {
      attributes?: Record<string, string>;
    };
    expect(planovooBody.attributes?.DECOLE_PLANOVOO_FUNIL_LAST_STEP).toBe("PURCHASE_APPROVED");
    expect(planovooBody.attributes?.DECOLE_PLANOVOO_FUNIL_STEPS).toBe("PURCHASE_APPROVED");
    expect(planovooBody.attributes?.DECOLE_PLANOVOO_FUNIL_LAST_STEP_TIMESTAMP).toBe("2026-04-24T13:00:00.000Z");
    expect(planovooBody.attributes?.PRODUCT_CODE).toBe("PLANOVOO");

    vi.unstubAllGlobals();
  });

  it("faz skip de update_brevo_funnel sem funnelFields no catalogo", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY: "set",
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_ESG_MENTORIA: {
            funnelEventArchitecture: {
              events: [{ eventType: "PURCHASE_APPROVED", chain: ["update_brevo_funnel"] }],
            },
          },
        },
      }),
    });

    await worker.queue(
      {
        messages: [
          {
            body: {
              event_id: "evt-brevo-skip-1",
              event_type: "PURCHASE_APPROVED",
              product_code: "DECOLE_ESG_MENTORIA",
              source: "hotmart",
              occurred_at: "2026-04-24T12:00:00.000Z",
              lead: { email: "qa.brevo.skip@example.com" },
              payload: {},
            },
          },
        ],
      },
      env
    );

    const contactsCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/contacts"));
    expect(contactsCalls.length).toBe(0);

    vi.unstubAllGlobals();
  });

  it("resolve tracking por produto e envia para sgtm", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      SGTM_ENDPOINT_URL_DECOLE_ESG: "https://sgtm.example.com/decole-esg/event",
      SGTM_ENDPOINT_URL_PLANOVOO: "https://sgtm.example.com/planovoo/event",
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_ESG_MENTORIA: {
            tracking: {
              sgtm: { endpointEnvVar: "SGTM_ENDPOINT_URL_DECOLE_ESG" },
            },
            funnelEventArchitecture: {
              events: [{ eventType: "PURCHASE_APPROVED", chain: ["emit_tracking"] }],
            },
          },
          DECOLE_PLANOVOO: {
            aliases: ["PLANOVOO"],
            tracking: {
              sgtm: { endpointEnvVar: "SGTM_ENDPOINT_URL_PLANOVOO" },
            },
            funnelEventArchitecture: {
              events: [{ eventType: "PURCHASE_APPROVED", chain: ["emit_tracking"] }],
            },
          },
        },
      }),
    });

    await worker.queue(
      {
        messages: [
          {
            body: {
              event_id: "evt-track-esg",
              event_type: "PURCHASE_APPROVED",
              product_code: "DECOLE_ESG_MENTORIA",
              source: "hotmart",
              occurred_at: "2026-04-24T12:00:00.000Z",
              lead: { email: "qa.track@example.com" },
              payload: {
                value: 1500,
                currency: "BRL",
                transaction: "HP123",
                event_source_url: "https://pay.hotmart.com/K98068530F",
              },
            },
          },
        ],
      },
      env
    );

    const sgtmEsgCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/decole-esg/event"));
    expect(sgtmEsgCall).toBeTruthy();
    const sgtmEsgBody = JSON.parse(String((sgtmEsgCall?.[1] as RequestInit)?.body || "{}")) as Record<string, unknown>;
    expect(sgtmEsgBody.transaction_id).toBe("HP123");
    expect(sgtmEsgBody.event_source_url).toBe("https://pay.hotmart.com/K98068530F");
    expect(sgtmEsgBody.ga4_event_name).toBe("purchase");
    expect(sgtmEsgBody.meta_event_name).toBe("Purchase");

    await worker.queue(
      {
        messages: [
          {
            body: {
              event_id: "evt-track-planovoo",
              event_type: "PURCHASE_APPROVED",
              product_code: "PLANOVOO",
              source: "hotmart",
              occurred_at: "2026-04-24T12:00:00.000Z",
              payload: { value: 100, currency: "BRL" },
            },
          },
        ],
      },
      env
    );

    const sgtmPlanovooCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/planovoo/event"));
    expect(sgtmPlanovooCall).toBeTruthy();
    const sgtmPlanovooBody = JSON.parse(String((sgtmPlanovooCall?.[1] as RequestInit)?.body || "{}")) as Record<string, unknown>;
    expect(sgtmPlanovooBody.product_code).toBe("PLANOVOO");
    expect(sgtmPlanovooBody.ga4_event_name).toBe("purchase");
    expect(sgtmPlanovooBody.meta_event_name).toBe("Purchase");

    vi.unstubAllGlobals();
  });
});
