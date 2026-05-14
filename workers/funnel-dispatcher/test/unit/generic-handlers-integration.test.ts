import { describe, expect, it, vi } from "vitest";
import { runChain } from "../../src/dispatcher";
import { createHandlers } from "../../src/handlers/index";
import type { FunnelEvent } from "../../../../packages/shared/src/funnel-event";
import type { DispatcherEnv } from "../../src/dispatcher";

type FetchMock = typeof fetch & {
  mock: { calls: Array<[RequestInfo | URL, RequestInit?]> };
};

function getFetchCall(fetchMock: FetchMock, index: number): [string, RequestInit] {
  const call = fetchMock.mock.calls[index];
  expect(call).toBeDefined();
  const [input, init] = call as [RequestInfo | URL, RequestInit?];
  expect(init).toBeDefined();
  return [String(input), init as RequestInit];
}

function makeEvent(overrides: Partial<FunnelEvent> = {}): FunnelEvent {
  return {
    event_id: "evt-generic-1",
    event_type: "PURCHASE_APPROVED",
    product_code: "DECOLE_PLANOVOO",
    source: "hotmart",
    occurred_at: new Date().toISOString(),
    lead: { email: "buyer@example.com" },
    payload: {
      data: {
        buyer: { email: "buyer@example.com", name: "Maria Silva" },
        purchase: {
          transaction: "TRX-100",
          offer_code: "OFFER-A",
          price: { value: 197 },
          payment: { type: "CREDIT_CARD" },
        },
        product: { name: "Plano de Voo" },
      },
    },
    ...overrides,
  };
}

function makeEnv(overrides: Record<string, unknown> = {}): DispatcherEnv {
  return {
    PLANOVOO_HOOK_SECRET: "test-secret",
    BREVO_API_KEY: "xkeysib-test",
    ...overrides,
  } as unknown as DispatcherEnv;
}

function makeDedupeKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

function mockGlobalFetch(responses: Array<{ body: Record<string, unknown>; status?: number }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const config = responses[callIndex] || responses[responses.length - 1];
    callIndex++;
    return new Response(JSON.stringify(config.body), {
      status: config.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as FetchMock;
}

describe("generic handlers integration (call_product_api + send_template_email)", () => {
  it("PURCHASE_APPROVED chain calls API then sends email with interpolated token", async () => {
    const fetchMock = mockGlobalFetch([
      { body: { token: "generated-token-uuid" }, status: 201 },
      { body: { messageId: "msg-1" }, status: 201 },
    ]);
    globalThis.fetch = fetchMock;

    const handlers = createHandlers();
    const event = makeEvent();
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            aliases: ["PLANOVOO"],
            funnelEventArchitecture: {
              events: [
                {
                  eventType: "PURCHASE_APPROVED",
                  chain: ["call_product_api", "send_template_email"],
                  product_api: {
                    url: "https://plano.decolesuacarreiraesg.com.br/api/hooks/purchase",
                    method: "POST",
                    hmac_secret_env: "PLANOVOO_HOOK_SECRET",
                    request_mapping: {
                      email: "$.data.buyer.email",
                      nome: "$.data.buyer.name",
                      transacao: "$.data.purchase.transaction",
                      oferta: "$.data.purchase.offer_code",
                      valor: "$.data.purchase.price.value",
                      pagamento: "$.data.purchase.payment.type",
                    },
                    response_key: "token",
                  },
                  template_email: {
                    templateId: 12,
                    to_email: "$.data.buyer.email",
                    params_mapping: {
                      primeiroNome: "$.data.buyer.name | first_name",
                      produto: "$.data.product.name",
                      formUrl: "https://plano.decolesuacarreiraesg.com.br/formulario/{{response.token}}",
                      transacao: "$.data.purchase.transaction",
                    },
                  },
                },
              ],
            },
          },
        },
      }),
    });

    const result = await runChain(event, env, handlers);

    expect(result.executed).toEqual(["call_product_api", "send_template_email"]);

    // First call: Plano de Voo API with HMAC
    const [apiUrl, apiInit] = getFetchCall(fetchMock, 0);
    expect(apiUrl).toBe("https://plano.decolesuacarreiraesg.com.br/api/hooks/purchase");
    expect(apiInit.method).toBe("POST");
    expect((apiInit.headers as Record<string, string>)["x-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    const apiBody = JSON.parse(String(apiInit.body));
    expect(apiBody.email).toBe("buyer@example.com");
    expect(apiBody.transacao).toBe("TRX-100");

    // Second call: Brevo email with interpolated token
    const [emailUrl, emailInit] = getFetchCall(fetchMock, 1);
    expect(emailUrl).toBe("https://api.brevo.com/v3/smtp/email");
    const emailBody = JSON.parse(String(emailInit.body));
    expect(emailBody.templateId).toBe(12);
    expect(emailBody.to).toEqual([{ email: "buyer@example.com" }]);
    expect(emailBody.params.formUrl).toContain("/formulario/generated-token-uuid");
    expect(emailBody.params.primeiroNome).toBe("Maria");
  });

  it("supports multi-tenant catalog shape for generic handlers", async () => {
    const fetchMock = mockGlobalFetch([
      { body: { token: "tenant-token" }, status: 201 },
      { body: { messageId: "msg-tenant" }, status: 201 },
    ]);
    globalThis.fetch = fetchMock;

    const handlers = createHandlers();
    const event = makeEvent({
      tenant_id: "decole",
      product_code: "PLANOVOO",
    });
    const env = makeEnv({
      BREVO_API_KEY: "",
      BREVO_API_KEY_DECOLE: "xkeysib-decole-tenant",
      HOTMART_TOKEN_DECOLE: "hotmart-decole-token",
      PLANOVOO_API_BASE_URL: "https://plano.tenant.test",
      CATALOG_JSON: JSON.stringify({
        tenants: {
          decole: {
            name: "DECOLE sua Carreira ESG",
            domains: ["api.decolesuacarreiraesg.com.br"],
            credentials: {
              brevo_api_key_env: "BREVO_API_KEY_DECOLE",
              hotmart_token_env: "HOTMART_TOKEN_DECOLE",
              replyToEmail: "contato@decolesuacarreiraesg.com.br",
            },
            products: {
              PLANOVOO: {
                aliases: ["DECOLE_PLANOVOO"],
                funnelEventArchitecture: {
                  events: [
                    {
                      eventType: "PURCHASE_APPROVED",
                      chain: ["call_product_api", "send_template_email"],
                      product_api: {
                        url_env: "PLANOVOO_API_BASE_URL",
                        path: "/api/hooks/purchase",
                        method: "POST",
                        hmac_secret_env: "PLANOVOO_HOOK_SECRET",
                        request_mapping: {
                          email: "$.data.buyer.email",
                          transacao: "$.data.purchase.transaction",
                        },
                        response_key: "token",
                      },
                      template_email: {
                        templateId: 12,
                        to_email: "$.data.buyer.email",
                        params_mapping: {
                          formUrl: "https://plano.decolesuacarreiraesg.com.br/formulario/{{response.token}}",
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      }),
    });

    const result = await runChain(event, env, handlers);

    expect(result.executed).toEqual(["call_product_api", "send_template_email"]);
    const [apiUrl] = getFetchCall(fetchMock, 0);
    expect(apiUrl).toBe("https://plano.tenant.test/api/hooks/purchase");
    const [emailUrl, emailInit] = getFetchCall(fetchMock, 1);
    expect(emailUrl).toBe("https://api.brevo.com/v3/smtp/email");
    expect((emailInit.headers as Record<string, string>)["api-key"]).toBe("xkeysib-decole-tenant");
    const emailBody = JSON.parse(String(emailInit.body));
    expect(emailBody.replyTo).toEqual({ email: "contato@decolesuacarreiraesg.com.br" });
    expect(emailBody.params.formUrl).toContain("/formulario/tenant-token");
  });

  it("uses tenant-aware dedupe keys for same event_id across tenants", async () => {
    const fetchMock = mockGlobalFetch([
      { body: { token: "decole-token" }, status: 201 },
      { body: { token: "superare-token" }, status: 201 },
    ]);
    globalThis.fetch = fetchMock;

    const catalog = {
      tenants: {
        decole: {
          products: {
            PLANOVOO: {
              funnelEventArchitecture: {
                events: [
                  {
                    eventType: "PURCHASE_APPROVED",
                    chain: ["call_product_api"],
                    product_api: {
                      url: "https://api.test/decole/purchase",
                      method: "POST",
                      hmac_secret_env: "PLANOVOO_HOOK_SECRET",
                      request_mapping: { email: "$.data.buyer.email" },
                      response_key: "token",
                    },
                  },
                ],
              },
            },
          },
        },
        superare: {
          products: {
            PLANOVOO: {
              funnelEventArchitecture: {
                events: [
                  {
                    eventType: "PURCHASE_APPROVED",
                    chain: ["call_product_api"],
                    product_api: {
                      url: "https://api.test/superare/purchase",
                      method: "POST",
                      hmac_secret_env: "PLANOVOO_HOOK_SECRET",
                      request_mapping: { email: "$.data.buyer.email" },
                      response_key: "token",
                    },
                  },
                ],
              },
            },
          },
        },
      },
    };
    const dedupeKv = makeDedupeKv();
    const env = makeEnv({ CATALOG_JSON: JSON.stringify(catalog), DEDUPE_KV: dedupeKv });
    const handlers = createHandlers();

    const decoleResult = await runChain(
      makeEvent({ event_id: "evt-same-id", tenant_id: "decole", product_code: "PLANOVOO" }),
      env,
      handlers
    );
    const superareResult = await runChain(
      makeEvent({ event_id: "evt-same-id", tenant_id: "superare", product_code: "PLANOVOO" }),
      env,
      handlers
    );

    expect(decoleResult.executed).toEqual(["call_product_api"]);
    expect(superareResult.executed).toEqual(["call_product_api"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((dedupeKv.put as any).mock.calls.map((call: unknown[]) => call[0])).toEqual([
      "decole:PLANOVOO:evt-same-id:call_product_api",
      "superare:PLANOVOO:evt-same-id:call_product_api",
    ]);
  });

  it("hydrates API response from dedupe when email retry runs after call_product_api was already successful", async () => {
    let emailAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/hooks/purchase")) {
        return new Response(JSON.stringify({ token: "deduped-token" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      emailAttempts++;
      if (emailAttempts === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(JSON.stringify({ messageId: "msg-retry" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as FetchMock;
    globalThis.fetch = fetchMock;

    const handlers = createHandlers();
    const dedupeKv = makeDedupeKv();
    const catalogJson = JSON.stringify({
      products: {
        DECOLE_PLANOVOO: {
          aliases: ["PLANOVOO"],
          funnelEventArchitecture: {
            events: [
              {
                eventType: "PURCHASE_APPROVED",
                chain: ["call_product_api", "send_template_email"],
                product_api: {
                  url: "https://plano.decolesuacarreiraesg.com.br/api/hooks/purchase",
                  method: "POST",
                  hmac_secret_env: "PLANOVOO_HOOK_SECRET",
                  request_mapping: {
                    email: "$.data.buyer.email",
                    transacao: "$.data.purchase.transaction",
                  },
                  response_key: "token",
                },
                template_email: {
                  templateId: 12,
                  to_email: "$.data.buyer.email",
                  params_mapping: {
                    formUrl: "https://plano.decolesuacarreiraesg.com.br/formulario/{{response.token}}",
                  },
                },
              },
            ],
          },
        },
      },
    });
    const env = makeEnv({ CATALOG_JSON: catalogJson, DEDUPE_KV: dedupeKv });

    await expect(runChain(makeEvent(), env, handlers)).rejects.toThrow(/Brevo transactional email failed/);

    const retryResult = await runChain(makeEvent(), env, handlers);

    expect(retryResult.skipped).toEqual(["call_product_api"]);
    expect(retryResult.executed).toEqual(["send_template_email"]);
    const apiCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/hooks/purchase"));
    expect(apiCalls).toHaveLength(1);
    const [, retryEmailInit] = getFetchCall(fetchMock, 2);
    const retryEmailBody = JSON.parse(String(retryEmailInit.body));
    expect(retryEmailBody.params.formUrl).toContain("/formulario/deduped-token");
  });

  it("generic PURCHASE_APPROVED supports flat Hotmart payload and lead email fallback", async () => {
    const fetchMock = mockGlobalFetch([
      { body: { token: "flat-token" }, status: 201 },
      { body: { messageId: "msg-flat" }, status: 201 },
    ]);
    globalThis.fetch = fetchMock;

    const handlers = createHandlers();
    const event = makeEvent({
      lead: { email: "lead-flat@example.com" },
      payload: {
        buyer: { name: "Flat Buyer" },
        purchase: { transaction: "TRX-FLAT", price: { value: 99 }, payment: { type: "PIX" } },
        product: { name: "Flat Plano" },
      },
    });
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            aliases: ["PLANOVOO"],
            funnelEventArchitecture: {
              events: [
                {
                  eventType: "PURCHASE_APPROVED",
                  chain: ["call_product_api", "send_template_email"],
                  product_api: {
                    url: "https://plano.decolesuacarreiraesg.com.br/api/hooks/purchase",
                    method: "POST",
                    hmac_secret_env: "PLANOVOO_HOOK_SECRET",
                    request_mapping: {
                      email: "$.data.buyer.email ?? $.buyer.email ?? $.lead.email",
                      nome: "$.data.buyer.name ?? $.buyer.name",
                      transacao: "$.data.purchase.transaction ?? $.purchase.transaction",
                      valor: "$.data.purchase.price.value ?? $.purchase.price.value",
                    },
                    skip_if_missing: ["email"],
                    response_key: "token",
                  },
                  template_email: {
                    templateId: 12,
                    to_email: "$.data.buyer.email ?? $.buyer.email ?? $.lead.email",
                    params_mapping: {
                      primeiroNome: "$.data.buyer.name | first_name ?? $.buyer.name | first_name",
                      formUrl: "https://plano.decolesuacarreiraesg.com.br/formulario/{{response.token}}",
                    },
                  },
                },
              ],
            },
          },
        },
      }),
    });

    await runChain(event, env, handlers);

    const [, apiInit] = getFetchCall(fetchMock, 0);
    const apiBody = JSON.parse(String(apiInit.body));
    expect(apiBody).toMatchObject({
      email: "lead-flat@example.com",
      nome: "Flat Buyer",
      transacao: "TRX-FLAT",
      valor: 99,
    });

    const [, emailInit] = getFetchCall(fetchMock, 1);
    const emailBody = JSON.parse(String(emailInit.body));
    expect(emailBody.to).toEqual([{ email: "lead-flat@example.com" }]);
    expect(emailBody.params.primeiroNome).toBe("Flat");
  });

  it("terminal event without transacao skips API and still sends email", async () => {
    const fetchMock = mockGlobalFetch([
      { body: { messageId: "msg-no-transacao" }, status: 201 },
    ]);
    globalThis.fetch = fetchMock;

    const handlers = createHandlers();
    const event = makeEvent({
      event_type: "PURCHASE_REFUNDED",
      payload: {
        data: {
          buyer: { email: "buyer@example.com", name: "Maria Silva" },
          purchase: { price: { value: 197 } },
          product: { name: "Plano de Voo" },
        },
      },
    });
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            aliases: ["PLANOVOO"],
            funnelEventArchitecture: {
              events: [
                {
                  eventType: "PURCHASE_REFUNDED",
                  chain: ["call_product_api", "send_template_email"],
                  product_api: {
                    url: "https://plano.decolesuacarreiraesg.com.br/api/hooks/refund",
                    method: "POST",
                    hmac_secret_env: "PLANOVOO_HOOK_SECRET",
                    request_mapping: {
                      transacao: "$.data.purchase.transaction ?? $.purchase.transaction",
                    },
                    skip_if_missing: ["transacao"],
                  },
                  template_email: {
                    templateId: 13,
                    to_email: "$.data.buyer.email",
                    params_mapping: {
                      primeiroNome: "$.data.buyer.name | first_name",
                    },
                  },
                },
              ],
            },
          },
        },
      }),
    });

    const result = await runChain(event, env, handlers);

    expect(result.executed).toEqual(["call_product_api", "send_template_email"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [emailUrl] = getFetchCall(fetchMock, 0);
    expect(emailUrl).toBe("https://api.brevo.com/v3/smtp/email");
  });

  it("PURCHASE_REFUNDED chain calls refund API then sends refund email", async () => {
    const fetchMock = mockGlobalFetch([
      { body: { updated: 1 } },
      { body: { messageId: "msg-2" }, status: 201 },
    ]);
    globalThis.fetch = fetchMock;

    const handlers = createHandlers();
    const event = makeEvent({ event_type: "PURCHASE_REFUNDED" });
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            aliases: ["PLANOVOO"],
            funnelEventArchitecture: {
              events: [
                {
                  eventType: "PURCHASE_REFUNDED",
                  chain: ["call_product_api", "send_template_email"],
                  product_api: {
                    url: "https://plano.decolesuacarreiraesg.com.br/api/hooks/refund",
                    method: "POST",
                    hmac_secret_env: "PLANOVOO_HOOK_SECRET",
                    request_mapping: {
                      transacao: "$.data.purchase.transaction",
                    },
                  },
                  template_email: {
                    templateId: 13,
                    to_email: "$.data.buyer.email",
                    params_mapping: {
                      primeiroNome: "$.data.buyer.name | first_name",
                      produto: "$.data.product.name",
                      transacao: "$.data.purchase.transaction",
                    },
                  },
                },
              ],
            },
          },
        },
      }),
    });

    const result = await runChain(event, env, handlers);

    expect(result.executed).toEqual(["call_product_api", "send_template_email"]);
    const [apiUrl] = getFetchCall(fetchMock, 0);
    expect(apiUrl).toBe("https://plano.decolesuacarreiraesg.com.br/api/hooks/refund");

    const [, emailInit] = getFetchCall(fetchMock, 1);
    const emailBody = JSON.parse(String(emailInit.body));
    expect(emailBody.templateId).toBe(13);
  });

  it("PURCHASE_PROTEST chain calls protest API then sends protest email", async () => {
    const fetchMock = mockGlobalFetch([
      { body: { updated: 1 } },
      { body: { messageId: "msg-3" }, status: 201 },
    ]);
    globalThis.fetch = fetchMock;

    const handlers = createHandlers();
    const event = makeEvent({ event_type: "PURCHASE_PROTEST" });
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            aliases: ["PLANOVOO"],
            funnelEventArchitecture: {
              events: [
                {
                  eventType: "PURCHASE_PROTEST",
                  chain: ["call_product_api", "send_template_email"],
                  product_api: {
                    url: "https://plano.decolesuacarreiraesg.com.br/api/hooks/protest",
                    method: "POST",
                    hmac_secret_env: "PLANOVOO_HOOK_SECRET",
                    request_mapping: {
                      transacao: "$.data.purchase.transaction",
                    },
                  },
                  template_email: {
                    templateId: 14,
                    to_email: "$.data.buyer.email",
                    params_mapping: {
                      primeiroNome: "$.data.buyer.name | first_name",
                      produto: "$.data.product.name",
                      transacao: "$.data.purchase.transaction",
                    },
                  },
                },
              ],
            },
          },
        },
      }),
    });

    const result = await runChain(event, env, handlers);

    expect(result.executed).toEqual(["call_product_api", "send_template_email"]);
    const [apiUrl] = getFetchCall(fetchMock, 0);
    expect(apiUrl).toBe("https://plano.decolesuacarreiraesg.com.br/api/hooks/protest");

    const [, emailInit] = getFetchCall(fetchMock, 1);
    const emailBody = JSON.parse(String(emailInit.body));
    expect(emailBody.templateId).toBe(14);
  });

  it("call_product_api skips when no product_api config for event", async () => {
    const fetchMock = mockGlobalFetch([]);
    globalThis.fetch = fetchMock;

    const handlers = createHandlers();
    const event = makeEvent({ event_type: "PURCHASE_APPROVED", product_code: "DECOLE_ESG_MENTORIA" });
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_ESG_MENTORIA: {
            funnelEventArchitecture: {
              events: [
                {
                  eventType: "PURCHASE_APPROVED",
                  chain: ["call_product_api"],
                },
              ],
            },
          },
        },
      }),
    });

    const result = await runChain(event, env, handlers);

    expect(result.executed).toEqual(["call_product_api"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("send_template_email skips when no template_email config for event", async () => {
    const fetchMock = mockGlobalFetch([]);
    globalThis.fetch = fetchMock;

    const handlers = createHandlers();
    const event = makeEvent({ event_type: "PURCHASE_COMPLETE" });
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_PLANOVOO: {
            aliases: ["PLANOVOO"],
            funnelEventArchitecture: {
              events: [
                {
                  eventType: "PURCHASE_COMPLETE",
                  chain: ["send_template_email"],
                },
              ],
            },
          },
        },
      }),
    });

    const result = await runChain(event, env, handlers);

    expect(result.executed).toEqual(["send_template_email"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
