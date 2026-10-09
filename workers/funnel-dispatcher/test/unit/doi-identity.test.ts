/**
 * Identidade do SIGN_UP via rid no DOI — RUNBOOK-ONBOARDING-LISTA, fatia L3B.1.
 *
 * Com brevoConfig.doiIdentity, o DOI grava {tenant}:checkout_recovery:{rid} (o formato que
 * o links-redirect já lê) e anexa ?rid= ao redirectionUrl. Sem a flag, nada muda.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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

function makeEnv(overrides: Record<string, unknown> = {}): any {
  const dedupe = new Map<string, string>();
  const identity = new Map<string, string>();
  return {
    DEDUPE_KV: {
      get: vi.fn(async (key: string) => dedupe.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        dedupe.set(key, value);
      }),
    },
    IDENTITY_KV: {
      get: vi.fn(async (key: string) => identity.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        identity.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        identity.delete(key);
      }),
    },
    IDENTITY_DB: makeD1Stub(),
    EVENT_STORE_DB: makeD1Stub(),
    ...overrides,
  };
}

const DOI_URL = "https://links.decolesuacarreiraesg.com.br/plano-de-voo/signup";

function doiCatalog(brevoConfig: Record<string, unknown>, productBrevo: Record<string, unknown> = {}): string {
  return JSON.stringify({
    products: {
      DECOLE_PLANOVOO: {
        brevo: {
          doiRedirectUrl: DOI_URL,
          lists: { precheckout: { id: "8" } },
          templates: { doi: { id: "10" } },
          ...productBrevo,
        },
        funnelEventArchitecture: {
          events: [{ eventType: "GENERATE_LEAD", chain: ["send_brevo_doi"], brevoConfig }],
        },
      },
    },
  });
}

function leadEvent(identity: Record<string, unknown> = {}, payload: Record<string, unknown> = {}): any {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    event_type: "GENERATE_LEAD",
    product_code: "DECOLE_PLANOVOO",
    source: "site",
    occurred_at: new Date().toISOString(),
    identity: { lead_id: "lead-123", session_id: "sess-uuid-1", ...identity },
    lead: { email: "lead@exemplo.com", lead_id: "lead-123" },
    payload: { FIRSTNAME: "Ana", utm_source: "linkedin", ...payload },
  };
}

function stubBrevo() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function doiBody(fetchMock: ReturnType<typeof stubBrevo>): { redirectionUrl?: string } {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/contacts/doubleOptinConfirmation"));
  return JSON.parse(String((call?.[1] as RequestInit)?.body || "{}"));
}

function recoveryPuts(env: any): Array<[string, string, { expirationTtl?: number } | undefined]> {
  return (env.IDENTITY_KV.put.mock.calls as Array<[string, string, { expirationTtl?: number }]>).filter((c) =>
    String(c[0]).includes("checkout_recovery")
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DOI com rid (brevoConfig.doiIdentity)", () => {
  it("com a flag: redirectionUrl ganha ?rid= e o registro vai para {tenant}:checkout_recovery:{rid}", async () => {
    const fetchMock = stubBrevo();
    const env = makeEnv({ BREVO_API_KEY: "set", CATALOG_JSON: doiCatalog({ doiIdentity: true }) });

    await worker.queue({ messages: [{ body: leadEvent({ anonymous_id: "1234567890.1700000000" }) }] }, env);

    const url = new URL(String(doiBody(fetchMock).redirectionUrl));
    expect(`${url.origin}${url.pathname}`).toBe(DOI_URL);
    const rid = url.searchParams.get("rid");
    expect(rid).toMatch(/^[0-9a-f-]{36}$/);

    const puts = recoveryPuts(env);
    expect(puts).toHaveLength(1);
    const [key, value, options] = puts[0];
    expect(key).toBe(`decole:checkout_recovery:${rid}`);
    expect(options?.expirationTtl).toBe(14 * 24 * 60 * 60);
    const record = JSON.parse(value);
    expect(record.kind).toBe("doi_confirmation");
    expect(record.params).toMatchObject({
      email: "lead@exemplo.com",
      name: "Ana",
      lead_id: "lead-123",
      anonymous_id: "1234567890.1700000000",
      utm_source: "linkedin",
    });
    expect(record.params.session_id).toBeUndefined();
  });

  it("anonymous_id sintético (fora do formato do GA) não entra no registro", async () => {
    stubBrevo();
    const env = makeEnv({ BREVO_API_KEY: "set", CATALOG_JSON: doiCatalog({ doiIdentity: true }) });

    await worker.queue({ messages: [{ body: leadEvent({ anonymous_id: "8f0e-uuid-do-site" }) }] }, env);

    const record = JSON.parse(recoveryPuts(env)[0][1]);
    expect(record.params.anonymous_id).toBeUndefined();
  });

  it("não grava índices de checkout_recovery (carrinho posterior não invalida o rid)", async () => {
    stubBrevo();
    const env = makeEnv({ BREVO_API_KEY: "set", CATALOG_JSON: doiCatalog({ doiIdentity: true }) });

    await worker.queue({ messages: [{ body: leadEvent() }] }, env);

    const keys = (env.IDENTITY_KV.put.mock.calls as Array<[string]>).map((c) => String(c[0]));
    expect(keys.some((k) => k.includes("checkout_recovery_index:"))).toBe(false);
  });

  it("sem a flag (DECOLE hoje): redirectionUrl fixo e nenhuma escrita de checkout_recovery", async () => {
    const fetchMock = stubBrevo();
    const env = makeEnv({ BREVO_API_KEY: "set", CATALOG_JSON: doiCatalog({}) });

    await worker.queue({ messages: [{ body: leadEvent({ anonymous_id: "1234567890.1700000000" }) }] }, env);

    expect(doiBody(fetchMock).redirectionUrl).toBe(DOI_URL);
    expect(recoveryPuts(env)).toHaveLength(0);
  });

  it("falha ao gravar no KV: DOI sai com a URL fixa", async () => {
    const fetchMock = stubBrevo();
    const env = makeEnv({ BREVO_API_KEY: "set", CATALOG_JSON: doiCatalog({ doiIdentity: true }) });
    const originalPut = env.IDENTITY_KV.put;
    env.IDENTITY_KV.put = vi.fn(async (key: string, value: string, options?: unknown) => {
      if (String(key).includes("checkout_recovery")) throw new Error("kv down");
      return originalPut(key, value, options);
    });

    await worker.queue({ messages: [{ body: leadEvent() }] }, env);

    expect(doiBody(fetchMock).redirectionUrl).toBe(DOI_URL);
  });

  it("promo continua precedendo o rid de identidade", async () => {
    const fetchMock = stubBrevo();
    const env = makeEnv({
      BREVO_API_KEY: "set",
      CATALOG_JSON: doiCatalog(
        { doiIdentity: true },
        {
          promoDoiTemplateId: "20",
          promoSignupUrl: "https://links.decolesuacarreiraesg.com.br/planodevoo/promo-signup",
        }
      ),
    });

    await worker.queue({ messages: [{ body: leadEvent({}, { promo_code: "ESG-PILOTO" }) }] }, env);

    expect(String(doiBody(fetchMock).redirectionUrl)).toMatch(/\/planodevoo\/promo-signup\?rid=/);
    expect(recoveryPuts(env)).toHaveLength(0);
  });
});

describe("DOI com rid no tenant product-engineer (catálogo multi-tenant)", () => {
  it("grava em product-engineer:checkout_recovery:{rid}, a chave que o links-redirect lê", async () => {
    const fetchMock = stubBrevo();
    const env = makeEnv({
      BREVO_API_KEY_PRODUCT_ENGINEER: "set",
      CATALOG_JSON: JSON.stringify({
        tenants: {
          "product-engineer": {
            credentials: { brevo_api_key_env: "BREVO_API_KEY_PRODUCT_ENGINEER" },
            products: {
              PRODUCT_ENGINEER_NEWSLETTER: {
                brevo: { lists: { precheckout: { id: "3" } }, templates: { doi: { id: "1" } } },
                funnelEventArchitecture: {
                  events: [
                    {
                      eventType: "GENERATE_LEAD",
                      chain: ["send_brevo_doi"],
                      brevoConfig: {
                        doiRedirectUrl: "https://links.theproductengineer.net/product-engineer/signup",
                        doiIdentity: true,
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

    await worker.queue(
      {
        messages: [
          {
            body: {
              ...leadEvent({ anonymous_id: "1234567890.1700000000" }),
              tenant_id: "product-engineer",
              product_code: "PRODUCT_ENGINEER_NEWSLETTER",
            },
          },
        ],
      },
      env
    );

    const rid = new URL(String(doiBody(fetchMock).redirectionUrl)).searchParams.get("rid");
    expect(rid).toBeTruthy();
    expect(recoveryPuts(env).map((c) => c[0])).toEqual([`product-engineer:checkout_recovery:${rid}`]);
  });
});

describe("emit_tracking do SIGN_UP (trackingRequiresIdentity)", () => {
  const SGTM = "https://sgtm.example.com";

  function trackingEnv(signUpEvent: Record<string, unknown>) {
    return makeEnv({
      SGTM_ENDPOINT_URL_DECOLE: SGTM,
      GA4_MEASUREMENT_ID_DECOLE: "G-TEST",
      GA4_API_SECRET_DECOLE: "secret",
      CATALOG_JSON: JSON.stringify({
        tenants: {
          decole: {
            tracking: {
              sgtm: { endpointEnvVar: "SGTM_ENDPOINT_URL_DECOLE" },
              ga4: { measurementIdEnvVar: "GA4_MEASUREMENT_ID_DECOLE", apiSecretEnvVar: "GA4_API_SECRET_DECOLE" },
            },
            products: {
              DECOLE_PLANOVOO: {
                tracking: { productCode: "DECOLE_PLANOVOO", differentiation: { produto: "DECOLE_PLANOVOO" } },
                funnelEventArchitecture: {
                  events: [{ eventType: "SIGN_UP", chain: ["emit_tracking"], ...signUpEvent }],
                },
              },
            },
          },
        },
      }),
    });
  }

  function signUp(overrides: Record<string, unknown> = {}): any {
    return {
      event_id: `sign_up:DECOLE_PLANOVOO:${Math.random().toString(36).slice(2)}`,
      event_type: "SIGN_UP",
      product_code: "DECOLE_PLANOVOO",
      source: "site",
      occurred_at: "2026-10-09T10:00:00.000Z",
      payload: {},
      ...overrides,
    };
  }

  function stubSgtm() {
    const bodies: Array<{ client_id: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).startsWith(SGTM)) bodies.push(JSON.parse(String(init?.body || "{}")));
        return new Response("{}", { status: 200 });
      })
    );
    return bodies;
  }

  it("com a flag e sem identidade: não envia ao GA4", async () => {
    const bodies = stubSgtm();
    await worker.queue({ messages: [{ body: signUp() }] }, trackingEnv({ trackingRequiresIdentity: true }));
    expect(bodies).toHaveLength(0);
  });

  it("com a flag e com identidade: envia, com client_id = client id do GA (sem hash)", async () => {
    const bodies = stubSgtm();
    await worker.queue(
      {
        messages: [
          {
            body: signUp({
              lead: { email: "lead@exemplo.com" },
              identity: { anonymous_id: "1234567890.1700000000" },
            }),
          },
        ],
      },
      trackingEnv({ trackingRequiresIdentity: true })
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0].client_id).toBe("1234567890.1700000000");
  });

  it("sem a flag (DECOLE hoje): SIGN_UP anônimo continua indo ao GA4", async () => {
    const bodies = stubSgtm();
    await worker.queue({ messages: [{ body: signUp() }] }, trackingEnv({}));
    expect(bodies).toHaveLength(1);
  });
});
