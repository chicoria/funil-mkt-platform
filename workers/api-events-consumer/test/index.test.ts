import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

type Env = {
  BREVO_API_KEY?: string;
  BREVO_CART_ABANDONMENT_TEMPLATE_ID?: string;
  BREVO_REPLY_TO_EMAIL?: string;
  BREVO_REPLY_TO_NAME?: string;
  HOTMART_PRODUCTS?: string;
};

const HOTMART_PRODUCTS_CONFIG = JSON.stringify([
  {
    id: 3526906,
    name: "Metodo DECOLE",
    prefix: "DECOLE_ESG",
    checkoutCode: "KDECOLE123",
    offerCode: "offer-default-decole",
  },
  {
    id: 987654,
    name: "Plano de Voo",
    prefix: "DECOLE_PLANO_VOO",
    checkoutCode: "KPLANOVOO123",
    offerCode: "offer-default-plano",
  },
]);

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    BREVO_API_KEY: "brevo_key",
    BREVO_CART_ABANDONMENT_TEMPLATE_ID: "123",
    HOTMART_PRODUCTS: HOTMART_PRODUCTS_CONFIG,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      const method = (options?.method || "GET").toUpperCase();
      if (method === "GET" && String(url).includes("api.brevo.com/v3/contacts/")) {
        return {
          ok: false,
          status: 404,
          text: async () => "",
          json: async () => ({}),
        } as unknown as Response;
      }

      return {
        ok: true,
        status: 200,
        text: async () => "",
      } as unknown as Response;
    })
  );
});

describe("api-events-consumer", () => {
  it("retorna healthcheck", async () => {
    const req = new Request("https://worker.example/health", { method: "GET" });
    const res = await worker.fetch(req);
    expect(res.status).toBe(200);
  });

  it("processa begin_checkout e atualiza atributos do produto configurado por id", async () => {
    await worker.queue(
      {
        messages: [
          {
            body: {
              eventType: "begin_checkout",
              eventId: "evt-1",
              email: "aluna@exemplo.com",
              payload: {
                product: {
                  id: 3526906,
                  name: "Metodo DECOLE",
                },
              },
            },
          },
        ],
      },
      makeEnv()
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/contacts");
    const body = JSON.parse(String(options.body || "{}")) as {
      email?: string;
      listIds?: number[];
      attributes?: Record<string, unknown>;
    };
    expect(body.email).toBe("aluna@exemplo.com");
    expect(body.listIds).toBeUndefined();
    expect(body.attributes?.DECOLE_ESG_FUNIL_LAST_STEP).toBe("begin_checkout");
    expect(body.attributes?.DECOLE_ESG_FUNIL_LAST_STEP_TIMESTAMP).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    expect(body.attributes?.DECOLE_ESG_FUNIL_STEPS).toBe("begin_checkout");
  });

  it("processa purchase e extrai email do payload", async () => {
    await worker.queue(
      {
        messages: [
          {
            body: {
              eventType: "purchase",
              payload: {
                buyer: {
                  email: "compradora@exemplo.com",
                },
                product: {
                  name: "Plano de Voo",
                },
              },
            },
          },
        ],
      },
      makeEnv()
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(options.body || "{}")) as {
      email?: string;
      listIds?: number[];
      attributes?: Record<string, unknown>;
    };
    expect(body.email).toBe("compradora@exemplo.com");
    expect(body.listIds).toBeUndefined();
    expect(body.attributes?.DECOLE_PLANO_VOO_FUNIL_LAST_STEP).toBe("purchase");
    expect(body.attributes?.DECOLE_PLANO_VOO_FUNIL_LAST_STEP_TIMESTAMP).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    expect(body.attributes?.DECOLE_PLANO_VOO_FUNIL_STEPS).toBe("purchase");
  });

  it("processa cart abandonment e atualiza atributos", async () => {
    await worker.queue(
      {
        messages: [
          {
            body: {
              eventType: "PURCHASE_OUT_OF_SHOPPING_CART",
              email: "lead@exemplo.com",
              payload: {
                offer: {
                  code: "n82b9jqz",
                },
                product: {
                  id: 3526906,
                  name: "decole",
                },
                buyer: {
                  name: "Lead Nome",
                },
              },
            },
          },
        ],
      },
      makeEnv({
        BREVO_REPLY_TO_EMAIL: "contato@decolesuacarreiraesg.com.br",
        BREVO_REPLY_TO_NAME: "DECOLE",
      })
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(options.body || "{}")) as {
      email?: string;
      listIds?: number[];
      attributes?: Record<string, unknown>;
    };
    expect(body.email).toBe("lead@exemplo.com");
    expect(body.listIds).toBeUndefined();
    expect(body.attributes?.DECOLE_ESG_FUNIL_LAST_STEP).toBe("purchase_out_of_shopping_cart");
    expect(body.attributes?.DECOLE_ESG_FUNIL_LAST_STEP_TIMESTAMP).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    expect(body.attributes?.DECOLE_ESG_FUNIL_STEPS).toBe("purchase_out_of_shopping_cart");

    const [emailUrl, emailOptions] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(emailUrl).toBe("https://api.brevo.com/v3/smtp/email");
    const emailBody = JSON.parse(String(emailOptions.body || "{}")) as {
      templateId?: number;
      to?: Array<{ email?: string; name?: string }>;
      replyTo?: { email?: string; name?: string };
      params?: Record<string, unknown>;
    };
    expect(emailBody.templateId).toBe(123);
    expect(emailBody.to?.[0]?.email).toBe("lead@exemplo.com");
    expect(emailBody.to?.[0]?.name).toBe("Lead Nome");
    expect(emailBody.replyTo?.email).toBe("contato@decolesuacarreiraesg.com.br");
    expect(emailBody.replyTo?.name).toBe("DECOLE");
    expect(emailBody.params?.productName).toBe("Metodo DECOLE");
    expect(emailBody.params?.buyerName).toBe("Lead Nome");
    expect(emailBody.params?.buyerNameGreeting).toBe(" Lead Nome");
    expect(emailBody.params?.email).toBe("lead@exemplo.com");
    expect(emailBody.params?.offerCode).toBe("n82b9jqz");
    expect(emailBody.params?.checkoutUrl).toBe("https://pay.hotmart.com/KDECOLE123?off=n82b9jqz");
  });

  it("usa offerCode do config quando webhook nao envia offer.code", async () => {
    await worker.queue(
      {
        messages: [
          {
            body: {
              eventType: "PURCHASE_OUT_OF_SHOPPING_CART",
              email: "lead@exemplo.com",
              payload: {
                product: {
                  id: 3526906,
                  name: "Metodo DECOLE",
                },
                buyer: {
                  name: "Lead Nome",
                },
              },
            },
          },
        ],
      },
      makeEnv()
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [emailUrl, emailOptions] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(emailUrl).toBe("https://api.brevo.com/v3/smtp/email");
    const emailBody = JSON.parse(String(emailOptions.body || "{}")) as {
      templateId?: number;
      to?: Array<{ email?: string; name?: string }>;
      params?: Record<string, unknown>;
    };
    expect(emailBody.templateId).toBe(123);
    expect(emailBody.to?.[0]?.email).toBe("lead@exemplo.com");
    expect(emailBody.params?.offerCode).toBe("offer-default-decole");
    expect(emailBody.params?.checkoutUrl).toBe("https://pay.hotmart.com/KDECOLE123?off=offer-default-decole");
  });

  it("ignora evento de outro produto", async () => {
    await worker.queue(
      {
        messages: [
          {
            body: {
              eventType: "SUBSCRIPTION_CANCELED",
              email: "lead@exemplo.com",
              payload: {
                product: {
                  id: 111,
                  name: "Outro Produto",
                },
              },
            },
          },
        ],
      },
      makeEnv()
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falha quando API key nao esta configurada", async () => {
    await expect(
      worker.queue(
        {
          messages: [
            {
              body: {
                eventType: "purchase",
                email: "lead@exemplo.com",
                payload: {
                  product: {
                    name: "DECOLE",
                  },
                },
              },
            },
          ],
        },
        makeEnv({ BREVO_API_KEY: "" })
      )
    ).rejects.toThrow(/BREVO_API_KEY/);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
