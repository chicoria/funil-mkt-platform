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
      delete: vi.fn(async (key: string) => {
        identityStore.delete(key);
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

  it("isola identity KV e D1 por tenant", async () => {
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({
        tenants: {
          decole: {
            products: {
              PLANOVOO: {
                aliases: ["DECOLE_PLANOVOO"],
                funnelEventArchitecture: {
                  events: [{ eventType: "GENERATE_LEAD", chain: ["resolve_identity", "upsert_event_store"] }],
                },
              },
            },
          },
          superare: {
            products: {
              PLANOVOO: {
                funnelEventArchitecture: {
                  events: [{ eventType: "GENERATE_LEAD", chain: ["resolve_identity", "upsert_event_store"] }],
                },
              },
            },
          },
        },
      }),
    });

    const base = {
      event_type: "GENERATE_LEAD",
      product_code: "PLANOVOO",
      source: "site",
      occurred_at: "2026-05-14T12:00:00.000Z",
      lead: { email: "same@example.com" },
      identity: { anonymous_id: "anon-same" },
      payload: {},
    };
    const decoleEvent: any = { ...base, event_id: "evt-tenant-identity-decole", tenant_id: "decole", payload: {} };
    const superareEvent: any = { ...base, event_id: "evt-tenant-identity-superare", tenant_id: "superare", payload: {} };

    await worker.queue({ messages: [{ body: decoleEvent }, { body: superareEvent }] }, env);

    expect(decoleEvent.payload.profile_id).toBeTruthy();
    expect(superareEvent.payload.profile_id).toBeTruthy();
    expect(superareEvent.payload.profile_id).not.toBe(decoleEvent.payload.profile_id);
    expect((env.IDENTITY_KV.put as any).mock.calls.map((call: unknown[]) => call[0])).toEqual(
      expect.arrayContaining([
        "decole:identity:anon:anon-same",
        "superare:identity:anon:anon-same",
      ])
    );
    const identityInsert = (env.IDENTITY_DB.prepare as any).mock.calls.find((call: unknown[]) =>
      String(call[0]).includes("INSERT INTO identity_links")
    );
    expect(String(identityInsert?.[0] || "")).toContain("tenant_id");
    const eventInsert = (env.EVENT_STORE_DB.prepare as any).mock.calls.find((call: unknown[]) =>
      String(call[0]).includes("INSERT INTO funnel_events")
    );
    expect(String(eventInsert?.[0] || "")).toContain("tenant_id");

    const identitySql = (env.IDENTITY_DB.prepare as any).mock.calls.map((call: unknown[]) => String(call[0]));
    const eventSql = (env.EVENT_STORE_DB.prepare as any).mock.calls.map((call: unknown[]) => String(call[0]));
    expect(identitySql).toEqual(expect.arrayContaining([
      expect.stringContaining("DROP INDEX IF EXISTS idx_identity_links_anonymous_id"),
      expect.stringContaining("DROP INDEX IF EXISTS idx_identity_links_email_hash"),
      expect.stringContaining("DROP TABLE identity_links"),
    ]));
    expect(eventSql).toEqual(expect.arrayContaining([
      expect.stringContaining("DROP INDEX IF EXISTS idx_funnel_events_profile"),
      expect.stringContaining("DROP TABLE funnel_events"),
    ]));
  });

  it("cria contato DOI nativo na Brevo usando configuracao do evento", async () => {
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
                  brevoConfig: {
                    listId: "7",
                    doiTemplateId: "1",
                    doiRedirectUrl: "https://links.decolesuacarreiraesg.com.br/decole-esg/signup",
                  },
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
      payload: {
        FIRSTNAME: "Ana",
        LASTNAME: "Silva",
        SMS__COUNTRY_CODE: "+55",
        SMS: "11999999999",
      },
    };

    await worker.queue({ messages: [{ body: event }] }, env);

    const doiCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/contacts/doubleOptinConfirmation"));
    expect(doiCall).toBeTruthy();
    const body = JSON.parse(String((doiCall?.[1] as RequestInit)?.body || "{}")) as {
      email?: string;
      includeListIds?: number[];
      redirectionUrl?: string;
      templateId?: number;
      attributes?: Record<string, string>;
    };
    expect(body.email).toBe("qa.doi@example.com");
    expect(body.includeListIds).toEqual([7]);
    expect(body.templateId).toBe(1);
    expect(body.redirectionUrl).toBe("https://links.decolesuacarreiraesg.com.br/decole-esg/signup");
    expect(body.attributes?.FIRSTNAME).toBe("Ana");
    expect(body.attributes?.LASTNAME).toBe("Silva");
    expect(body.attributes?.SMS).toBe("+5511999999999");
    expect(body.attributes?.PRODUCT_CODE).toBe("DECOLE_ESG_MENTORIA");

    vi.unstubAllGlobals();
  });

  it("reenvia DOI sem SMS quando Brevo rejeita telefone duplicado", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "duplicate_parameter",
            message: "Unable to create contact, SMS is already associated with another Contact",
            metadata: { duplicate_identifiers: ["SMS"] },
          }),
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY: "set",
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_ESG_MENTORIA: {
            funnelEventArchitecture: {
              events: [
                {
                  eventType: "GENERATE_LEAD",
                  chain: ["send_brevo_doi"],
                  brevoConfig: {
                    listId: "7",
                    doiTemplateId: "1",
                    doiRedirectUrl: "https://links.decolesuacarreiraesg.com.br/decole-esg/signup",
                  },
                },
              ],
            },
          },
        },
      }),
    });

    const event: any = {
      event_id: "evt-doi-duplicate-sms-1",
      event_type: "GENERATE_LEAD",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "site",
      occurred_at: new Date().toISOString(),
      lead: { email: "qa.doi.duplicate-sms@example.com" },
      payload: {
        FIRSTNAME: "Ana",
        SMS__COUNTRY_CODE: "+351",
        SMS: "351915787088",
      },
    };

    await worker.queue({ messages: [{ body: event }] }, env);

    const doiCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/contacts/doubleOptinConfirmation"));
    expect(doiCalls).toHaveLength(2);
    const firstBody = JSON.parse(String((doiCalls[0]?.[1] as RequestInit)?.body || "{}")) as { attributes?: Record<string, string> };
    const retryBody = JSON.parse(String((doiCalls[1]?.[1] as RequestInit)?.body || "{}")) as {
      email?: string;
      includeListIds?: number[];
      attributes?: Record<string, string>;
    };
    expect(firstBody.attributes?.SMS).toBe("+351915787088");
    expect(retryBody.email).toBe("qa.doi.duplicate-sms@example.com");
    expect(retryBody.includeListIds).toEqual([7]);
    expect(retryBody.attributes?.SMS).toBeUndefined();
    expect(retryBody.attributes?.FIRSTNAME).toBe("Ana");
    expect(retryBody.attributes?.PRODUCT_CODE).toBe("DECOLE_ESG_MENTORIA");

    vi.unstubAllGlobals();
  });

  it("usa credenciais Brevo do tenant para DOI, funil e carrinho", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY: "",
      BREVO_API_KEY_DECOLE: "xkeysib-decole-tenant",
      HOTMART_TOKEN_DECOLE: "hotmart-decole-token",
      CATALOG_JSON: JSON.stringify({
        tenants: {
          decole: {
            name: "DECOLE",
            domains: ["api.decolesuacarreiraesg.com.br"],
            credentials: {
              brevo_api_key_env: "BREVO_API_KEY_DECOLE",
              hotmart_token_env: "HOTMART_TOKEN_DECOLE",
              replyToEmail: "contato@decolesuacarreiraesg.com.br",
            },
            products: {
              DECOLE_PLANOVOO: {
                name: "DECOLE - Plano de Voo",
                links: {
                  checkoutPath: "/plano-de-voo/checkout",
                  checkoutBaseUrl: "https://pay.hotmart.com/R105463680A?off=f3yweqek",
                },
                brevo: {
                  doiRedirectUrl: "https://links.decolesuacarreiraesg.com.br/plano-de-voo/signup",
                  lists: { precheckout: { id: "8" } },
                  templates: { doi: { id: "10" } },
                  funnelFields: {
                    steps: "DECOLE_PLANOVOO_FUNIL_STEPS",
                    lastStep: "DECOLE_PLANOVOO_FUNIL_LAST_STEP",
                    lastStepTimestamp: "DECOLE_PLANOVOO_FUNIL_LAST_STEP_TIMESTAMP",
                  },
                },
                funnelEventArchitecture: {
                  events: [
                    { eventType: "GENERATE_LEAD", chain: ["send_brevo_doi"], brevoConfig: {} },
                    { eventType: "PURCHASE_APPROVED", chain: ["update_brevo_funnel"] },
                    {
                      eventType: "PURCHASE_OUT_OF_SHOPPING_CART",
                      chain: ["send_cart_abandonment_email"],
                      brevoConfig: { cartAbandonmentTemplateId: "11" },
                    },
                  ],
                },
              },
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
              event_id: "evt-brevo-tenant-doi",
              event_type: "GENERATE_LEAD",
              tenant_id: "decole",
              product_code: "DECOLE_PLANOVOO",
              source: "site",
              occurred_at: "2026-05-18T12:00:00.000Z",
              lead: { email: "tenant.doi@example.com" },
              payload: {},
            },
          },
        ],
      },
      env
    );

    await worker.queue(
      {
        messages: [
          {
            body: {
              event_id: "evt-brevo-tenant-funnel",
              event_type: "PURCHASE_APPROVED",
              tenant_id: "decole",
              product_code: "DECOLE_PLANOVOO",
              source: "hotmart",
              occurred_at: "2026-05-18T12:05:00.000Z",
              lead: { email: "tenant.funnel@example.com" },
              payload: {},
            },
          },
        ],
      },
      env
    );

    await worker.queue(
      {
        messages: [
          {
            body: {
              event_id: "evt-brevo-tenant-cart",
              event_type: "PURCHASE_OUT_OF_SHOPPING_CART",
              tenant_id: "decole",
              product_code: "DECOLE_PLANOVOO",
              source: "hotmart",
              occurred_at: "2026-05-18T12:10:00.000Z",
              lead: { email: "tenant.cart@example.com" },
              payload: {},
            },
          },
        ],
      },
      env
    );

    const brevoCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("api.brevo.com/v3"));
    expect(brevoCalls).toHaveLength(3);
    expect(brevoCalls.map((call) => ((call[1] as RequestInit)?.headers as Record<string, string>)["api-key"]))
      .toEqual(["xkeysib-decole-tenant", "xkeysib-decole-tenant", "xkeysib-decole-tenant"]);
    expect(brevoCalls.map((call) => String(call[0]))).toEqual([
      "https://api.brevo.com/v3/contacts/doubleOptinConfirmation",
      "https://api.brevo.com/v3/contacts",
      "https://api.brevo.com/v3/smtp/email",
    ]);

    vi.unstubAllGlobals();
  });

  it("resolve credencial Brevo via Secrets Store binding", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const brevoBinding = { get: vi.fn(async () => "xkeysib-decole-binding") };
    const env = makeEnv({
      BREVO_API_KEY: "",
      BREVO_API_KEY_DECOLE: brevoBinding,
      HOTMART_TOKEN_DECOLE: "hotmart-decole-token",
      CATALOG_JSON: JSON.stringify({
        tenants: {
          decole: {
            name: "DECOLE",
            domains: ["api.decolesuacarreiraesg.com.br"],
            credentials: {
              brevo_api_key_env: "BREVO_API_KEY_DECOLE",
              hotmart_token_env: "HOTMART_TOKEN_DECOLE",
            },
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
              event_id: "evt-brevo-binding-1",
              event_type: "PURCHASE_APPROVED",
              tenant_id: "decole",
              product_code: "DECOLE_ESG_MENTORIA",
              source: "hotmart",
              occurred_at: "2026-05-18T12:15:00.000Z",
              lead: { email: "tenant.binding@example.com" },
              payload: {},
            },
          },
        ],
      },
      env
    );

    const contactCall = fetchMock.mock.calls.find((call) => String(call[0]) === "https://api.brevo.com/v3/contacts");
    expect(contactCall).toBeTruthy();
    expect(((contactCall?.[1] as RequestInit)?.headers as Record<string, string>)["api-key"]).toBe("xkeysib-decole-binding");
    expect(brevoBinding.get).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("cria DOI usando template, lista e redirection do catalog por produto", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY: "set",
      BREVO_DOI_TEMPLATE_ID: "1",
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            brevo: {
              doiRedirectUrl: "https://links.decolesuacarreiraesg.com.br/plano-de-voo/signup",
              lists: {
                precheckout: { id: "8" },
              },
              templates: {
                doi: { id: "10" },
              },
            },
            funnelEventArchitecture: {
              events: [
                {
                  eventType: "GENERATE_LEAD",
                  chain: ["send_brevo_doi"],
                  brevoConfig: {},
                },
              ],
            },
          },
        },
      }),
    });

    const event: any = {
      event_id: "evt-doi-planovoo-1",
      event_type: "GENERATE_LEAD",
      product_code: "DECOLE_PLANOVOO",
      source: "site",
      occurred_at: new Date().toISOString(),
      lead: { email: "qa.planovoo.doi@example.com" },
      payload: { confirmation_url: "https://example.net/nao-usar" },
    };

    await worker.queue({ messages: [{ body: event }] }, env);

    const doiCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/contacts/doubleOptinConfirmation"));
    expect(doiCall).toBeTruthy();
    const body = JSON.parse(String((doiCall?.[1] as RequestInit)?.body || "{}")) as {
      templateId?: number;
      includeListIds?: number[];
      redirectionUrl?: string;
      attributes?: Record<string, string>;
    };
    expect(body.templateId).toBe(10);
    expect(body.includeListIds).toEqual([8]);
    expect(body.redirectionUrl).toBe("https://links.decolesuacarreiraesg.com.br/plano-de-voo/signup");
    expect(body.attributes?.PRODUCT_CODE).toBe("DECOLE_PLANOVOO");

    vi.unstubAllGlobals();
  });

  it("nao chama Brevo DOI quando falta configuracao obrigatoria", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY: "set",
      BREVO_DOI_TEMPLATE_ID: "10",
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            funnelEventArchitecture: {
              events: [{ eventType: "GENERATE_LEAD", chain: ["send_brevo_doi"] }],
            },
          },
        },
      }),
    });

    const event: any = {
      event_id: "evt-doi-invalid-url-1",
      event_type: "GENERATE_LEAD",
      product_code: "DECOLE_PLANOVOO",
      source: "site",
      occurred_at: new Date().toISOString(),
      lead: { email: "qa.planovoo.invalid.doi@example.com" },
      payload: {},
    };

    await worker.queue({ messages: [{ body: event }] }, env);

    const doiCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/contacts/doubleOptinConfirmation"));
    expect(doiCall).toBeFalsy();

    vi.unstubAllGlobals();
  });

	  it("envia email de carrinho abandonado usando templateId do catalog por produto", async () => {
	    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
	      return new Response(JSON.stringify({ ok: true }), { status: 200 });
	    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY: "set",
      LINKS_BASE_URL: "https://links.decolesuacarreiraesg.com.br",
      CATALOG_JSON: JSON.stringify({
        products: {
	          DECOLE_PLANOVOO: {
	            name: "DECOLE - Plano de Voo",
	            links: {
	              checkoutPath: "/plano-de-voo/checkout",
	              checkoutBaseUrl: "https://pay.hotmart.com/R105463680A?off=f3yweqek",
	            },
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
    const checkoutUrl = new URL(String(body.params?.checkout_url || ""));
    expect(checkoutUrl.origin).toBe("https://links.decolesuacarreiraesg.com.br");
    expect(checkoutUrl.pathname).toBe("/plano-de-voo/checkout");
    expect(checkoutUrl.searchParams.get("rid")).toBeTruthy();
    expect(body.params?.checkoutUrl).toBe(body.params?.checkout_url);
    expect(body.params?.product_name).toBe("DECOLE - Plano de Voo");
    expect(body.params?.productName).toBe("DECOLE - Plano de Voo");
    const recoveryPutCall = (env.IDENTITY_KV.put as any).mock.calls.find((call: unknown[]) =>
      String(call[0]).startsWith("decole:checkout_recovery:")
    );
    expect(recoveryPutCall).toBeTruthy();
    const recoveryPayload = JSON.parse(String(recoveryPutCall?.[1] || "{}")) as { params?: Record<string, string> };
    expect(recoveryPayload.params?.email).toBe("qa.cart@example.com");
    expect(recoveryPayload.params?.utm_source).toBe("brevo");
    expect(recoveryPayload.params?.utm_medium).toBe("email");
    const indexPutCalls = (env.IDENTITY_KV.put as any).mock.calls.filter((call: unknown[]) =>
      String(call[0]).startsWith("decole:checkout_recovery_index:")
    );
    expect(indexPutCalls.length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it("gera link de carrinho abandonado usando linksDomain do tenant", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY_DECOLE: "xkeysib-decole",
      HOTMART_TOKEN_DECOLE: "hotmart-decole-token",
      CATALOG_JSON: JSON.stringify({
        tenants: {
          decole: {
            links: {
              linksDomain: "links.decole.test",
            },
            credentials: {
              brevo_api_key_env: "BREVO_API_KEY_DECOLE",
              hotmart_token_env: "HOTMART_TOKEN_DECOLE",
            },
            products: {
              DECOLE_PLANOVOO: {
                name: "DECOLE - Plano de Voo",
                links: {
                  checkoutPath: "/plano-de-voo/checkout",
                  checkoutBaseUrl: "https://pay.hotmart.com/R105463680A?off=f3yweqek",
                },
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
          },
        },
      }),
    });

    await worker.queue({
      messages: [{
        body: {
          event_id: "evt-cart-tenant-links-1",
          event_type: "PURCHASE_OUT_OF_SHOPPING_CART",
          tenant_id: "decole",
          product_code: "DECOLE_PLANOVOO",
          source: "hotmart",
          occurred_at: new Date().toISOString(),
          lead: { email: "qa.cart.tenant@example.com" },
          payload: {},
        },
      }],
    }, env);

    const emailCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/smtp/email"));
    expect(emailCall).toBeTruthy();
    const body = JSON.parse(String((emailCall?.[1] as RequestInit)?.body || "{}")) as {
      params?: Record<string, string>;
    };
    const checkoutUrl = new URL(String(body.params?.checkout_url || ""));
    expect(checkoutUrl.origin).toBe("https://links.decole.test");
    expect(checkoutUrl.pathname).toBe("/plano-de-voo/checkout");
    expect(checkoutUrl.searchParams.get("rid")).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it("nao usa dominio DECOLE hardcoded quando tenant nao define linksDomain", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY_SUPERARE: "xkeysib-superare",
      HOTMART_TOKEN_SUPERARE: "hotmart-superare-token",
      CATALOG_JSON: JSON.stringify({
        tenants: {
          superare: {
            credentials: {
              brevo_api_key_env: "BREVO_API_KEY_SUPERARE",
              hotmart_token_env: "HOTMART_TOKEN_SUPERARE",
            },
            products: {
              SUPERARE_CURSO_X: {
                name: "SUPERARE Curso X",
                links: {
                  checkoutPath: "/curso-x/checkout",
                  checkoutBaseUrl: "https://pay.hotmart.com/SUPERARE123",
                },
                funnelEventArchitecture: {
                  events: [
                    {
                      eventType: "PURCHASE_OUT_OF_SHOPPING_CART",
                      chain: ["send_cart_abandonment_email"],
                      brevoConfig: { cartAbandonmentTemplateId: "12" },
                    },
                  ],
                },
              },
            },
          },
        },
      }),
    });

    await worker.queue({
      messages: [{
        body: {
          event_id: "evt-cart-no-links-domain-1",
          event_type: "PURCHASE_OUT_OF_SHOPPING_CART",
          tenant_id: "superare",
          product_code: "SUPERARE_CURSO_X",
          source: "hotmart",
          occurred_at: new Date().toISOString(),
          lead: { email: "qa.cart.superare@example.com" },
          payload: {},
        },
      }],
    }, env);

    const emailCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/smtp/email"));
    expect(emailCall).toBeTruthy();
    const body = JSON.parse(String((emailCall?.[1] as RequestInit)?.body || "{}")) as {
      params?: Record<string, string>;
    };
    expect(body.params?.checkout_url).toBe("https://pay.hotmart.com/SUPERARE123");
    expect(body.params?.checkout_url).not.toContain("links.decolesuacarreiraesg.com.br");
    expect((env.IDENTITY_KV.put as any).mock.calls.some((call: unknown[]) =>
      String(call[0]).startsWith("superare:checkout_recovery:")
    )).toBe(false);

    vi.unstubAllGlobals();
  });

  it("grava dados de checkout recuperados do historico para prefill na Hotmart", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sitePayload = JSON.stringify({
      link_url:
        "https://links.decolesuacarreiraesg.com.br/plano-de-voo/checkout?name=Ana%20Silva&email=ana@example.com&phoneac=11&phonenumber=999999999&fbp=fb.1.site&utm_source=ig",
      session_id: "sess-site-1",
      anonymous_id: "anon-site-1",
    });
    const d1Stub = makeD1Stub();
    d1Stub.db.prepare = vi.fn((sql: string) => {
      const state = { binds: [] as unknown[] };
      return {
        bind: vi.fn((...vals: unknown[]) => {
          state.binds = vals;
          return {
            run: vi.fn(async () => ({})),
            first: vi.fn(async () => {
              if (sql.includes("source = 'site'")) return { payload_json: sitePayload };
              return null;
            }),
          };
        }),
        run: vi.fn(async () => ({})),
        first: vi.fn(async () => null),
      };
    }) as any;

    const env = makeEnv({
      EVENT_STORE_DB: d1Stub.db,
      BREVO_API_KEY: "set",
      LINKS_BASE_URL: "https://links.decolesuacarreiraesg.com.br",
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            name: "DECOLE - Plano de Voo",
            links: {
              checkoutPath: "/plano-de-voo/checkout",
              checkoutBaseUrl: "https://pay.hotmart.com/R105463680A?off=f3yweqek",
            },
            funnelEventArchitecture: {
              events: [
                {
                  eventType: "PURCHASE_OUT_OF_SHOPPING_CART",
                  chain: ["resolve_identity", "upsert_event_store", "send_cart_abandonment_email"],
                  brevoConfig: { cartAbandonmentTemplateId: "11" },
                },
              ],
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
              event_id: "evt-cart-prefill-1",
              event_type: "PURCHASE_OUT_OF_SHOPPING_CART",
              product_code: "DECOLE_PLANOVOO",
              source: "hotmart",
              occurred_at: new Date().toISOString(),
              lead: { email: "ana@example.com" },
              payload: {},
            },
          },
        ],
      },
      env
    );

    const recoveryPutCall = (env.IDENTITY_KV.put as any).mock.calls.find((call: unknown[]) =>
      String(call[0]).startsWith("decole:checkout_recovery:")
    );
    expect(recoveryPutCall).toBeTruthy();
    const recoveryPayload = JSON.parse(String(recoveryPutCall?.[1] || "{}")) as { params?: Record<string, string> };
    expect(recoveryPayload.params).toMatchObject({
      name: "Ana Silva",
      email: "ana@example.com",
      phoneac: "11",
      phonenumber: "999999999",
      fbp: "fb.1.site",
      utm_source: "ig",
      session_id: "sess-site-1",
      anonymous_id: "anon-site-1",
    });

    vi.unstubAllGlobals();
  });

  it("invalida token de recuperacao associado a transacao Hotmart terminal", async () => {
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            aliases: ["PLANOVOO"],
            funnelEventArchitecture: {
              events: [{ eventType: "PURCHASE_REFUNDED", chain: ["invalidate_purchase_token"] }],
            },
          },
        },
      }),
    });
    await env.IDENTITY_KV.put(
      "decole:checkout_recovery:rec-123",
      JSON.stringify({
        version: 2,
        product_code: "DECOLE_PLANOVOO",
        index_keys: ["decole:checkout_recovery_index:transaction:DECOLE_PLANOVOO:hp-123"],
        params: { email: "buyer@example.com" },
      })
    );
    await env.IDENTITY_KV.put("decole:checkout_recovery_index:transaction:DECOLE_PLANOVOO:hp-123", "rec-123");

    await worker.queue(
      {
        messages: [
          {
            body: {
              event_id: "evt-refund-1",
              event_type: "PURCHASE_REFUNDED",
              product_code: "PLANOVOO",
              source: "hotmart",
              occurred_at: "2026-05-10T10:00:00.000Z",
              lead: { email: "buyer@example.com" },
              payload: {
                data: {
                  purchase: { transaction: "HP-123" },
                },
              },
            },
          },
        ],
      },
      env
    );

    expect(env.IDENTITY_KV.delete).toHaveBeenCalledWith("decole:checkout_recovery:rec-123");
    expect(env.IDENTITY_KV.delete).toHaveBeenCalledWith("decole:checkout_recovery_index:transaction:DECOLE_PLANOVOO:hp-123");
  });

  it("remove token e indice legados de recuperacao DECOLE", async () => {
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            aliases: ["PLANOVOO"],
            funnelEventArchitecture: {
              events: [{ eventType: "PURCHASE_REFUNDED", chain: ["invalidate_purchase_token"] }],
            },
          },
        },
      }),
    });
    await env.IDENTITY_KV.put(
      "checkout_recovery:rec-legacy",
      JSON.stringify({
        version: 2,
        product_code: "DECOLE_PLANOVOO",
        index_keys: ["checkout_recovery_index:transaction:DECOLE_PLANOVOO:hp-legacy"],
        params: { email: "buyer@example.com" },
      })
    );
    await env.IDENTITY_KV.put("checkout_recovery_index:transaction:DECOLE_PLANOVOO:hp-legacy", "rec-legacy");

    await worker.queue(
      {
        messages: [
          {
            body: {
              event_id: "evt-refund-legacy",
              event_type: "PURCHASE_REFUNDED",
              product_code: "PLANOVOO",
              source: "hotmart",
              occurred_at: "2026-05-10T10:00:00.000Z",
              lead: { email: "buyer@example.com" },
              payload: {
                data: {
                  purchase: { transaction: "HP-LEGACY" },
                },
              },
            },
          },
        ],
      },
      env
    );

    expect(env.IDENTITY_KV.delete).not.toHaveBeenCalledWith("checkout_recovery:rec-legacy");
    expect(env.IDENTITY_KV.delete).not.toHaveBeenCalledWith("checkout_recovery_index:transaction:DECOLE_PLANOVOO:hp-legacy");
    expect(env.IDENTITY_KV.delete).toHaveBeenCalledWith("decole:checkout_recovery_index:transaction:DECOLE_PLANOVOO:hp-legacy");
  });

		  it("chama API do Plano de Voo para eventos terminais do Plano de Voo sem afetar a mentoria", async () => {
		    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
		      const url = String(input);
		      if (url.includes("app.planovoo.test/api/hooks/protest")) {
		        return new Response(JSON.stringify({ updated: 1 }), { status: 200 });
		      }
		      if (url.includes("brevo.com")) {
		        return new Response(JSON.stringify({ messageId: "ok" }), { status: 201 });
		      }
		      return new Response(JSON.stringify({ ok: true }), { status: 200 });
		    });
		    vi.stubGlobal("fetch", fetchMock);

		    const env = makeEnv({
		      PLANOVOO_HOOK_SECRET: "test-secret",
		      BREVO_API_KEY: "xkeysib-test",
		      CATALOG_JSON: JSON.stringify({
		        products: {
		          DECOLE_PLANOVOO: {
		            aliases: ["PLANOVOO"],
		            funnelEventArchitecture: {
		              events: [
		                {
		                  eventType: "PURCHASE_PROTEST",
		                  chain: ["resolve_identity", "upsert_event_store", "invalidate_purchase_token", "update_brevo_funnel", "call_product_api", "send_template_email"],
		                  product_api: {
		                    url: "https://app.planovoo.test/api/hooks/protest",
		                    method: "POST",
		                    hmac_secret_env: "PLANOVOO_HOOK_SECRET",
		                    request_mapping: { transacao: "$.data.purchase.transaction" },
		                  },
		                  template_email: {
		                    templateId: 14,
		                    to_email: "$.data.buyer.email",
		                    params_mapping: {
		                      primeiroNome: "$.data.buyer.name | first_name",
		                      transacao: "$.data.purchase.transaction",
		                    },
		                  },
		                },
		              ],
		            },
		          },
		          DECOLE_ESG_MENTORIA: {
		            funnelEventArchitecture: {
		              events: [
		                {
		                  eventType: "PURCHASE_PROTEST",
		                  chain: ["resolve_identity", "upsert_event_store", "invalidate_purchase_token", "update_brevo_funnel"],
		                },
		              ],
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
		              event_id: "evt-planovoo-protest-api-1",
		              event_type: "PURCHASE_PROTEST",
		              product_code: "PLANOVOO",
		              source: "hotmart",
		              occurred_at: "2026-05-11T12:05:54.078Z",
		              lead: { email: "buyer@example.com" },
		              payload: {
		                event: "PURCHASE_PROTEST",
		                data: {
		                  buyer: { email: "buyer@example.com" },
		                  purchase: { transaction: "HP-PLANOVOO-PROTEST-1", status: "DISPUTE" },
		                },
		              },
		            },
		          },
		        ],
		      },
		      env
		    );

		    await worker.queue(
		      {
		        messages: [
		          {
		            body: {
		              event_id: "evt-esg-protest-no-api-1",
		              event_type: "PURCHASE_PROTEST",
		              product_code: "DECOLE_ESG_MENTORIA",
		              source: "hotmart",
		              occurred_at: "2026-05-11T12:06:00.000Z",
		              lead: { email: "buyer@example.com" },
		              payload: {
		                event: "PURCHASE_PROTEST",
		                data: {
		                  buyer: { email: "buyer@example.com" },
		                  purchase: { transaction: "HP-ESG-PROTEST-1", status: "DISPUTE" },
		                },
		              },
		            },
		          },
		        ],
		      },
		      env
		    );

		    // Plano de Voo protest should call API + send email
		    const apiCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("app.planovoo.test"));
		    expect(apiCalls).toHaveLength(1);
		    const apiBody = JSON.parse(String((apiCalls[0]?.[1] as RequestInit)?.body || "{}")) as {
		      transacao?: string;
		    };
		    expect(apiBody.transacao).toBe("HP-PLANOVOO-PROTEST-1");

		    // ESG mentoria should NOT call Plano de Voo API
		    const allApiCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("app.planovoo.test"));
		    expect(allApiCalls).toHaveLength(1); // only from planovoo, not from mentoria

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

  it("processa PURCHASE_COMPLETE da mentoria ESG como evento proprio sem tracking nem n8n", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY: "set",
      BREVO_API_KEY_DECOLE: "set",
      N8N_WEBHOOK_URL: "https://n8n.example.com/webhook/plano-de-voo/hotmart",
      SGTM_ENDPOINT_URL: "https://sgtm.example.com/g/collect",
    });

    await worker.queue(
      {
        messages: [
          {
            body: {
              event_id: "evt-esg-complete-1",
              event_type: "PURCHASE_COMPLETE",
              product_code: "DECOLE_ESG_MENTORIA",
              source: "hotmart",
              occurred_at: "2026-05-09T18:30:00.000Z",
              lead: { email: "qa.complete.esg@example.com" },
              payload: {
                event: "PURCHASE_COMPLETE",
                data: {
                  buyer: { email: "qa.complete.esg@example.com" },
                  purchase: { transaction: "HP-ESG-COMPLETE-1" },
                },
              },
            },
          },
        ],
      },
      env
    );

    const contactsCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/contacts"));
    expect(contactsCalls.length).toBe(1);
    const body = JSON.parse(String((contactsCalls[0]?.[1] as RequestInit)?.body || "{}")) as {
      attributes?: Record<string, string>;
    };
    expect(body.attributes?.DECOLE_ESG_FUNIL_LAST_STEP).toBe("PURCHASE_COMPLETE");
    expect(body.attributes?.DECOLE_ESG_FUNIL_STEPS).toBe("PURCHASE_COMPLETE");
    expect(body.attributes?.DECOLE_ESG_FUNIL_LAST_STEP_TIMESTAMP).toBe("2026-05-09T18:30:00.000Z");
    expect(env.IDENTITY_KV.delete).not.toHaveBeenCalled();

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("sgtm.example.com"))).toBe(false);
    expect(urls.some((url) => url.includes("n8n.example.com"))).toBe(false);
    const hasEventInsert = (env.EVENT_STORE_DB.prepare as any).mock.calls.some((call: any[]) =>
      String(call[0]).includes("INSERT INTO funnel_events")
    );
    expect(hasEventInsert).toBe(true);

    vi.unstubAllGlobals();
  });

  it("processa PURCHASE_COMPLETE do Plano de Voo como evento proprio sem tracking nem n8n", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      BREVO_API_KEY: "set",
      BREVO_API_KEY_DECOLE: "set",
      N8N_WEBHOOK_URL: "https://n8n.example.com/webhook/plano-de-voo/hotmart",
      SGTM_ENDPOINT_URL: "https://sgtm.example.com/g/collect",
    });

    await worker.queue(
      {
        messages: [
          {
            body: {
              event_id: "evt-planovoo-complete-1",
              event_type: "PURCHASE_COMPLETE",
              product_code: "DECOLE_PLANOVOO",
              source: "hotmart",
              occurred_at: "2026-05-09T18:00:00.000Z",
              lead: { email: "qa.complete.planovoo@example.com" },
              payload: {
                event: "PURCHASE_COMPLETE",
                data: {
                  buyer: { email: "qa.complete.planovoo@example.com" },
                  purchase: { transaction: "HP-COMPLETE-1" },
                },
              },
            },
          },
        ],
      },
      env
    );

    const contactsCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/contacts"));
    expect(contactsCalls.length).toBe(1);
    const body = JSON.parse(String((contactsCalls[0]?.[1] as RequestInit)?.body || "{}")) as {
      attributes?: Record<string, string>;
    };
    expect(body.attributes?.DECOLE_PLANOVOO_FUNIL_LAST_STEP).toBe("PURCHASE_COMPLETE");
    expect(body.attributes?.DECOLE_PLANOVOO_FUNIL_STEPS).toBe("PURCHASE_COMPLETE");
    expect(body.attributes?.DECOLE_PLANOVOO_FUNIL_LAST_STEP_TIMESTAMP).toBe("2026-05-09T18:00:00.000Z");
    expect(env.IDENTITY_KV.delete).not.toHaveBeenCalled();

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("sgtm.example.com"))).toBe(false);
    expect(urls.some((url) => url.includes("n8n.example.com"))).toBe(false);
    const hasEventInsert = (env.EVENT_STORE_DB.prepare as any).mock.calls.some((call: any[]) =>
      String(call[0]).includes("INSERT INTO funnel_events")
    );
    expect(hasEventInsert).toBe(true);

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

  it("resolve tracking por tenant e envia para sgtm preservando diferenciação por produto", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      SGTM_ENDPOINT_URL_DECOLE: "https://sgtm.example.com/decole",
      GA4_MEASUREMENT_ID_DECOLE: "G-DECOLE-TEST123",
      GA4_API_SECRET_DECOLE: "decole-api-secret",
      CATALOG_JSON: JSON.stringify({
        tenants: {
          decole: {
            tracking: {
              sgtm: { endpointEnvVar: "SGTM_ENDPOINT_URL_DECOLE" },
              ga4: {
                measurementId: "G-DECOLE-FALLBACK",
                measurementIdEnvVar: "GA4_MEASUREMENT_ID_DECOLE",
                apiSecretEnvVar: "GA4_API_SECRET_DECOLE",
              },
              metaCapi: { accessTokenEnv: "META_CAPI_ACCESS_TOKEN_DECOLE" },
            },
            products: {
              DECOLE_ESG_MENTORIA: {
                tracking: {
                  productCode: "DECOLE_ESG_MENTORIA",
                  differentiation: { produto: "DECOLE_ESG_MENTORIA" },
                },
                funnelEventArchitecture: {
                  events: [{ eventType: "PURCHASE_APPROVED", chain: ["emit_tracking"] }, { eventType: "PURCHASE_OUT_OF_SHOPPING_CART", chain: ["emit_tracking"] }],
                },
              },
              DECOLE_PLANOVOO: {
                aliases: ["PLANOVOO"],
                tracking: {
                  productCode: "DECOLE_PLANOVOO",
                  differentiation: { produto: "DECOLE_PLANOVOO" },
                },
                funnelEventArchitecture: {
                  events: [{ eventType: "PURCHASE_APPROVED", chain: ["emit_tracking"] }],
                },
              },
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

    const sgtmEsgCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/decole/mp/collect"));
    expect(sgtmEsgCall).toBeTruthy();
    expect(String(sgtmEsgCall?.[0])).toContain("measurement_id=G-DECOLE-TEST123");
    expect(String(sgtmEsgCall?.[0])).toContain("api_secret=decole-api-secret");
    const sgtmEsgBody = JSON.parse(String((sgtmEsgCall?.[1] as RequestInit)?.body || "{}")) as Record<string, unknown>;
    const esgParams = (sgtmEsgBody.events as Array<{ name: string; params: Record<string, unknown> }>)[0];
    expect(esgParams.name).toBe("purchase");
    expect(esgParams.params.transaction_id).toBe("HP123");
    expect(esgParams.params.page_location).toBe("https://pay.hotmart.com/K98068530F");
    expect(esgParams.params.currency).toBe("BRL");
    expect(esgParams.params.value).toBe(1500);
    expect(esgParams.params.produto).toBe("DECOLE_ESG_MENTORIA");

    fetchMock.mock.calls.length = 0;
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

    const sgtmPlanovooCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/decole/mp/collect"));
    expect(sgtmPlanovooCall).toBeTruthy();
    const sgtmPlanovooBody = JSON.parse(String((sgtmPlanovooCall?.[1] as RequestInit)?.body || "{}")) as Record<string, unknown>;
    const planovooParams = (sgtmPlanovooBody.events as Array<{ name: string; params: Record<string, unknown> }>)[0];
    expect(planovooParams.name).toBe("purchase");
    expect(planovooParams.params.produto).toBe("DECOLE_PLANOVOO");
    expect(planovooParams.params.product_code).toBe("PLANOVOO");

    fetchMock.mock.calls.length = 0;
    await worker.queue(
      {
        messages: [
          {
            body: {
              event_id: "evt-track-cart-abandon",
              event_type: "PURCHASE_OUT_OF_SHOPPING_CART",
              product_code: "DECOLE_ESG_MENTORIA",
              source: "hotmart",
              occurred_at: "2026-04-24T12:00:00.000Z",
              payload: { value: 1500, currency: "BRL" },
            },
          },
        ],
      },
      env
    );

    const sgtmCartCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/decole/mp/collect"));
    expect(sgtmCartCall).toBeTruthy();
    const sgtmCartBody = JSON.parse(String((sgtmCartCall?.[1] as RequestInit)?.body || "{}")) as Record<string, unknown>;
    const cartParams = (sgtmCartBody.events as Array<{ name: string; params: Record<string, unknown> }>)[0];
    expect(cartParams.name).toBe("begin_checkout");
    expect(cartParams.params.produto).toBe("DECOLE_ESG_MENTORIA");
    expect(cartParams.params.product_code).toBe("DECOLE_ESG_MENTORIA");

    vi.unstubAllGlobals();
  });

  it("resolve tracking por tenant usando bindings do Secrets Store", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      SGTM_ENDPOINT_URL_TEST_BINDING: { get: vi.fn(async () => "https://sgtm-binding.example.com") },
      GA4_MEASUREMENT_ID_TEST_BINDING: { get: vi.fn(async () => "G-BINDING-123") },
      GA4_API_SECRET_TEST_BINDING: { get: vi.fn(async () => "binding-secret") },
      CATALOG_JSON: JSON.stringify({
        tenants: {
          testtenant: {
            tracking: {
              sgtm: { endpointEnvVar: "SGTM_ENDPOINT_URL_TEST_BINDING" },
              ga4: {
                measurementIdEnvVar: "GA4_MEASUREMENT_ID_TEST_BINDING",
                apiSecretEnvVar: "GA4_API_SECRET_TEST_BINDING",
              },
            },
            products: {
              TEST_PRODUCT: {
                tracking: {
                  productCode: "TEST_PRODUCT",
                  differentiation: { produto: "TEST_PRODUCT" },
                },
                funnelEventArchitecture: {
                  events: [{ eventType: "PURCHASE_APPROVED", chain: ["emit_tracking"] }],
                },
              },
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
              event_id: "evt-track-binding",
              event_type: "PURCHASE_APPROVED",
              tenant_id: "testtenant",
              product_code: "TEST_PRODUCT",
              source: "hotmart",
              occurred_at: "2026-04-24T12:00:00.000Z",
              payload: { value: 100, currency: "BRL" },
            },
          },
        ],
      },
      env
    );

    const sgtmCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("sgtm-binding.example.com/mp/collect"));
    expect(sgtmCall).toBeTruthy();
    expect(String(sgtmCall?.[0])).toContain("measurement_id=G-BINDING-123");
    expect(String(sgtmCall?.[0])).toContain("api_secret=binding-secret");

    vi.unstubAllGlobals();
  });

  it.skip("(removido 2.11A.9) encaminha compra Hotmart ao n8n no formato esperado pelo workflow legado", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      N8N_WEBHOOK_URL: "https://n8n.example.com/webhook/plano-de-voo/hotmart",
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            aliases: ["PLANOVOO"],
            funnelEventArchitecture: {
              events: [{ eventType: "PURCHASE_APPROVED", chain: ["forward_n8n"] }],
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
              event_id: "evt-n8n-planovoo-1",
              event_type: "PURCHASE_APPROVED",
              product_code: "DECOLE_PLANOVOO",
              source: "hotmart",
              occurred_at: "2026-05-09T12:45:39.000Z",
              lead: { email: "buyer@example.com" },
              payload: {
                event: "PURCHASE_COMPLETE",
                data: {
                  buyer: { email: "buyer@example.com", name: "Buyer Test" },
                  purchase: { transaction: "HP421796212" },
                  product: { name: "DECOLE - Plano de Voo" },
                },
              },
            },
          },
        ],
      },
      env
    );

    const n8nCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("n8n.example.com"));
    expect(n8nCall).toBeTruthy();
    const body = JSON.parse(String((n8nCall?.[1] as RequestInit)?.body || "{}")) as Record<string, any>;
    expect(body.event).toBe("PURCHASE_COMPLETE");
    expect(body.data?.buyer?.email).toBe("buyer@example.com");
    expect(body.data?.purchase?.transaction).toBe("HP421796212");
    expect(body._decole?.event_type).toBe("PURCHASE_APPROVED");
    expect(body._decole?.product_code).toBe("DECOLE_PLANOVOO");

    vi.unstubAllGlobals();
  });

  it.skip("(removido 2.11A.9) normaliza payload Hotmart top-level antes de encaminhar ao n8n", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      N8N_WEBHOOK_URL: "https://n8n.example.com/webhook/plano-de-voo/hotmart",
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            funnelEventArchitecture: {
              events: [{ eventType: "PURCHASE_APPROVED", chain: ["forward_n8n"] }],
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
              event_id: "evt-n8n-planovoo-2",
              event_type: "PURCHASE_APPROVED",
              product_code: "DECOLE_PLANOVOO",
              source: "hotmart",
              occurred_at: "2026-05-09T12:45:39.000Z",
              payload: {
                buyer: { email: "buyer@example.com" },
                purchase: { transaction: "HP421796212" },
              },
            },
          },
        ],
      },
      env
    );

    const n8nCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("n8n.example.com"));
    expect(n8nCall).toBeTruthy();
    const body = JSON.parse(String((n8nCall?.[1] as RequestInit)?.body || "{}")) as Record<string, any>;
    expect(body.event).toBe("PURCHASE_APPROVED");
    expect(body.data?.buyer?.email).toBe("buyer@example.com");
    expect(body.data?.purchase?.transaction).toBe("HP421796212");
    expect(body.id).toBe("evt-n8n-planovoo-2");

    vi.unstubAllGlobals();
  });

  it.skip("(removido 2.11A.9) mantem formato canonico ao encaminhar n8n de produto sem compat legado", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const env = makeEnv({
      N8N_WEBHOOK_URL: "https://n8n.example.com/webhook/plano-de-voo/hotmart",
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_ESG_MENTORIA: {
            funnelEventArchitecture: {
              events: [{ eventType: "PURCHASE_APPROVED", chain: ["forward_n8n"] }],
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
              event_id: "evt-n8n-esg-1",
              event_type: "PURCHASE_APPROVED",
              product_code: "DECOLE_ESG_MENTORIA",
              source: "hotmart",
              occurred_at: "2026-05-09T12:45:39.000Z",
              payload: {
                event: "PURCHASE_COMPLETE",
                data: {
                  buyer: { email: "buyer@example.com" },
                  purchase: { transaction: "HP-ESG-1" },
                },
              },
            },
          },
        ],
      },
      env
    );

    const n8nCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("n8n.example.com"));
    expect(n8nCall).toBeTruthy();
    const body = JSON.parse(String((n8nCall?.[1] as RequestInit)?.body || "{}")) as Record<string, any>;
    expect(body.event_type).toBe("PURCHASE_APPROVED");
    expect(body.product_code).toBe("DECOLE_ESG_MENTORIA");
    expect(body.event).toBeUndefined();
    expect(body.payload?.data?.purchase?.transaction).toBe("HP-ESG-1");

    vi.unstubAllGlobals();
  });

  it("upsert_event_store guarda attribution merged no payload_json (fbp/fbc/client_ip acessíveis para enrich_attribution)", async () => {
    const d1Stub = makeD1Stub();
    let storedPayloadJson = "";
    d1Stub.db.prepare = vi.fn((sql: string) => {
      const state = { binds: [] as unknown[] };
      return {
        bind: vi.fn((...vals: unknown[]) => {
          state.binds = vals;
          return {
	            run: vi.fn(async () => {
	              if (sql.includes("INSERT INTO funnel_events")) {
	                // payload_json is the 10th bind param (index 9), after tenant_id.
	                storedPayloadJson = String(state.binds[9] ?? "");
	              }
	              return {};
	            }),
            first: vi.fn(async () => null),
          };
        }),
        run: vi.fn(async () => ({})),
        first: vi.fn(async () => null),
      };
    }) as any;

    const env = makeEnv({ EVENT_STORE_DB: d1Stub.db });
    const event: any = {
      event_id: "evt-attr-merge-1",
      event_type: "BEGIN_CHECKOUT",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "site",
      occurred_at: new Date().toISOString(),
      attribution: { fbp: "fb.1.123.test", fbc: "fb.click.456", client_ip: "1.2.3.4" },
      payload: { checkout_url: "https://pay.hotmart.com/checkout" },
    };

    await worker.queue({ messages: [{ body: event }] }, env);

    // attribution fields must be present in payload_json for enrich_attribution recovery
    const stored = JSON.parse(storedPayloadJson || "{}") as Record<string, unknown>;
    expect(stored.fbp).toBe("fb.1.123.test");
    expect(stored.fbc).toBe("fb.click.456");
    expect(stored.client_ip).toBe("1.2.3.4");
    expect(stored.checkout_url).toBe("https://pay.hotmart.com/checkout");
  });

  it("enrich_attribution injeta fbp/client_ip no evento quando evento site anterior existe no D1", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/hooks/purchase")) {
        return new Response(JSON.stringify({ token: "enriched-token" }), { status: 201 });
      }
      if (url.includes("brevo.com")) {
        return new Response(JSON.stringify({ messageId: "ok" }), { status: 201 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sitePayload = JSON.stringify({ fbp: "fb.1.site.111", client_ip: "9.9.9.9" });
    const d1Stub = makeD1Stub();
    d1Stub.db.prepare = vi.fn((sql: string) => {
      return {
        bind: vi.fn((..._vals: unknown[]) => ({
          run: vi.fn(async () => ({})),
          first: vi.fn(async () => {
            // enrich_attribution queries for prior site event
            if (sql.includes("source = 'site'")) return { payload_json: sitePayload };
            return null;
          }),
        })),
        run: vi.fn(async () => ({})),
        first: vi.fn(async () => null),
      };
    }) as any;

    const env = makeEnv({
      EVENT_STORE_DB: d1Stub.db,
      SGTM_ENDPOINT_URL_PLANOVOO: "https://sgtm.test",
      GA4_MEASUREMENT_ID: "G-TEST",
      GA4_API_SECRET: "test-secret",
      PLANOVOO_API_BASE_URL: "https://app.planovoo.test",
      PLANOVOO_API_BASE_URL_DECOLE: "https://app.planovoo.test",
      PLANOVOO_HOOK_SECRET: "test-secret",
      PLANOVOO_HOOK_SECRET_DECOLE: "test-secret",
      BREVO_API_KEY: "xkeysib-test",
      BREVO_API_KEY_DECOLE: "xkeysib-test",
    });

    // Hotmart event without fbp — enrich_attribution should recover from D1
    const event: any = {
      event_id: "evt-enrich-1",
      event_type: "PURCHASE_APPROVED",
      product_code: "DECOLE_PLANOVOO",
      source: "hotmart",
      occurred_at: new Date().toISOString(),
      identity: { email_hash: "abc123" },
      attribution: {},
      lead: { email: "buyer@example.com" },
      payload: {
        profile_id: "profile-enrich-1",
        value: 297,
        data: {
          buyer: { email: "buyer@example.com", name: "Test" },
          purchase: { transaction: "TRX-ENRICH-1" },
          product: { name: "Plano de Voo" },
        },
      },
    };

    await worker.queue({ messages: [{ body: event }] }, env);

    // emit_tracking should have been called with fbp from enriched attribution
    const sgtmCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/mp/collect")
    );
    expect(sgtmCall).toBeTruthy();
    const body = JSON.parse(String((sgtmCall?.[1] as RequestInit)?.body || "{}")) as { events?: Array<{ params?: Record<string, unknown> }> };
    const params = body.events?.[0]?.params ?? {};
    expect(params.fbp).toBe("fb.1.site.111");
    expect(params.client_ip_address).toBe("9.9.9.9");
    expect(env.IDENTITY_KV.delete).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("consulta historico de atribuicao e etapas escopado por tenant", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const d1Stub = makeD1Stub();
    const queryBinds: unknown[][] = [];
    d1Stub.db.prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...vals: unknown[]) => {
        queryBinds.push(vals);
        return {
          run: vi.fn(async () => ({})),
          first: vi.fn(async () => {
            if (sql.includes("source = 'site'")) return { payload_json: JSON.stringify({ fbp: "fb.tenant", client_ip: "8.8.8.8" }) };
            if (sql.includes("group_concat")) return { steps: "GENERATE_LEAD|BEGIN_CHECKOUT" };
            return null;
          }),
        };
      }),
      run: vi.fn(async () => ({})),
      first: vi.fn(async () => null),
    })) as any;

    const env = makeEnv({
      EVENT_STORE_DB: d1Stub.db,
      BREVO_API_KEY: "legacy-key-must-not-be-used",
      BREVO_API_KEY_SUPERARE: "superare-key",
      HOTMART_TOKEN_SUPERARE: "superare-hotmart-token",
      CATALOG_JSON: JSON.stringify({
        tenants: {
          superare: {
            credentials: {
              brevo_api_key_env: "BREVO_API_KEY_SUPERARE",
              hotmart_token_env: "HOTMART_TOKEN_SUPERARE",
            },
            products: {
              PLANOVOO: {
                brevo: {
                  funnelFields: {
                    steps: "SUPERARE_FUNIL_STEPS",
                    lastStep: "SUPERARE_FUNIL_LAST_STEP",
                    lastStepTimestamp: "SUPERARE_FUNIL_LAST_STEP_TIMESTAMP",
                  },
                },
                tracking: {
                  sgtm: { endpointUrl: "https://sgtm.superare.test" },
                  ga4: { measurementId: "G-SUPERARE", apiSecretEnvVar: "GA4_API_SECRET" },
                },
                funnelEventArchitecture: {
                  events: [
                    {
                      eventType: "PURCHASE_APPROVED",
                      chain: ["enrich_attribution", "update_brevo_funnel", "emit_tracking"],
                    },
                  ],
                },
              },
            },
          },
        },
      }),
      GA4_API_SECRET: "secret",
    });
    const event: any = {
      event_id: "evt-tenant-history-1",
      event_type: "PURCHASE_APPROVED",
      tenant_id: "superare",
      product_code: "PLANOVOO",
      source: "hotmart",
      occurred_at: "2026-05-14T12:00:00.000Z",
      identity: { anonymous_id: "anon-tenant-history" },
      attribution: {},
      lead: { email: "buyer@superare.test" },
      payload: { profile_id: "profile-same" },
    };

    await worker.queue({ messages: [{ body: event }] }, env);

    const selectBinds = queryBinds.filter((binds) => binds.includes("profile-same"));
    expect(selectBinds).toEqual(expect.arrayContaining([["superare", "profile-same"], ["superare", "profile-same"]]));
    const contactCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/contacts"));
    const contactBody = JSON.parse(String((contactCall?.[1] as RequestInit)?.body || "{}")) as { attributes?: Record<string, string> };
    expect(contactBody.attributes?.SUPERARE_FUNIL_STEPS).toBe("GENERATE_LEAD|BEGIN_CHECKOUT|PURCHASE_APPROVED");
    const sgtmCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/mp/collect"));
    const sgtmBody = JSON.parse(String((sgtmCall?.[1] as RequestInit)?.body || "{}")) as { events?: Array<{ params?: Record<string, unknown> }> };
    expect(sgtmBody.events?.[0]?.params?.fbp).toBe("fb.tenant");

    vi.unstubAllGlobals();
  });
});
