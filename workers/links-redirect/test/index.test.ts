import { describe, expect, it } from "vitest";
import worker from "../src/index";

type Env = {
  ELIZETE_WHATSAPP_NUMBER?: string;
  ELIZETE_WHATSAPP_DEFAULT_TEXT?: string;
  DECOLE_MENTORIA_CHECKOUT_URL?: string;
  PLANO_DE_VOO_CHECKOUT_URL?: string;
  LINKS_PRODUCTS?: string;
  FUNNEL_EVENTS?: { send(body: unknown): Promise<void> };
  IDENTITY_KV?: { get(key: string): Promise<string | null> };
};

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ELIZETE_WHATSAPP_NUMBER: "351 915 787 088",
    ELIZETE_WHATSAPP_DEFAULT_TEXT: "Olá Elizete, preciso de ajuda",
    DECOLE_MENTORIA_CHECKOUT_URL: "https://pay.hotmart.com/K98068530F?off=1myrvww7",
    PLANO_DE_VOO_CHECKOUT_URL: "https://pay.hotmart.com/R105463680A?off=f3yweqek",
    ...overrides,
  };
}

function makeRequest(path: string, options: { method?: string } = {}): Request {
  return new Request(`https://links.decolesuacarreiraesg.com.br/${path}`, {
    method: options.method || "GET",
  });
}

describe("links-redirect worker", () => {
  it("retorna healthcheck", async () => {
    const res = await worker.fetch(makeRequest("health"), makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; worker?: string };
    expect(json.ok).toBe(true);
    expect(json.worker).toBe("links-redirect");
  });

  it("retorna 404 quando rota nao existe", async () => {
    const res = await worker.fetch(makeRequest("rota-invalida"), makeEnv());
    expect(res.status).toBe(404);
  });

  it("retorna 500 quando link nao esta configurado", async () => {
    const res = await worker.fetch(makeRequest("elizete-wp"), makeEnv({ ELIZETE_WHATSAPP_NUMBER: "" }));
    expect(res.status).toBe(500);
  });

  it("redireciona para WhatsApp com texto default e numero sanitizado", async () => {
    const res = await worker.fetch(makeRequest("elizete-wp"), makeEnv());
    expect(res.status).toBe(302);
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe("/351915787088");
    expect(url.searchParams.get("text")).toBe("Olá Elizete, preciso de ajuda");
  });

  it("repassa parametros recebidos para o WhatsApp", async () => {
    const res = await worker.fetch(makeRequest("elizete-wp?text=Oi&t=Ola&foo=bar"), makeEnv());
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.searchParams.get("text")).toBe("Oi");
    expect(url.searchParams.get("t")).toBe("Ola");
    expect(url.searchParams.get("foo")).toBe("bar");
  });

  it("repassa parametros recebidos para o checkout", async () => {
    const res = await worker.fetch(makeRequest("checkout?utm_source=ig"), makeEnv());
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.origin).toBe("https://pay.hotmart.com");
    expect(url.searchParams.get("off")).toBe("1myrvww7");
    expect(url.searchParams.get("offer")).toBeNull();
    expect(url.searchParams.get("utm_source")).toBe("ig");
  });

  it("enfileira BEGIN_CHECKOUT antes de redirecionar para checkout", async () => {
    const sent: unknown[] = [];
    const res = await worker.fetch(
      makeRequest("plano-de-voo/checkout?utm_source=ig&anonymous_id=anon-123&fbp=fb.1.123&event_id=evt-begin-1"),
      makeEnv({
        FUNNEL_EVENTS: {
          send: async (body: unknown) => {
            sent.push(body);
          },
        },
      })
    );

    expect(res.status).toBe(302);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      event_id: "evt-begin-1",
      event_type: "BEGIN_CHECKOUT",
      product_code: "DECOLE_PLANOVOO",
      source: "site",
      identity: { anonymous_id: "anon-123" },
      attribution: { fbp: "fb.1.123", utm_source: "ig" },
      payload: {
        checkout_path: "plano-de-voo/checkout",
        offer_code: "f3yweqek",
      },
    });
  });

  it("padroniza oferta via parametro offer", async () => {
    const res = await worker.fetch(makeRequest("checkout?offer=n82b9jqz&utm_source=ig"), makeEnv());
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.searchParams.get("off")).toBe("n82b9jqz");
    expect(url.searchParams.get("offer")).toBe("n82b9jqz");
    expect(url.searchParams.get("utm_source")).toBe("ig");
  });

  it("redireciona plano de voo com parametros recebidos", async () => {
    const res = await worker.fetch(makeRequest("plano-de-voo/checkout?utm_source=ig"), makeEnv());
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.origin).toBe("https://pay.hotmart.com");
    expect(url.pathname).toBe("/R105463680A");
    expect(url.searchParams.get("off")).toBe("f3yweqek");
    expect(url.searchParams.get("utm_source")).toBe("ig");
  });

  it("expande token de recuperacao antes de redirecionar para Hotmart", async () => {
    const sent: unknown[] = [];
    const res = await worker.fetch(
      makeRequest("plano-de-voo/checkout?rid=rec-123&utm_medium=manual"),
      makeEnv({
        IDENTITY_KV: {
          get: async (key: string) =>
            key === "checkout_recovery:rec-123"
              ? JSON.stringify({
                  params: {
                    email: "ana@example.com",
                    name: "Ana Silva",
                    phoneac: "11",
                    phonenumber: "999999999",
                    fbp: "fb.1.123",
                    utm_source: "brevo",
                    utm_medium: "email",
                    ignored: "nope",
                  },
                })
              : null,
        },
        FUNNEL_EVENTS: {
          send: async (body: unknown) => {
            sent.push(body);
          },
        },
      })
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.origin).toBe("https://pay.hotmart.com");
    expect(url.searchParams.get("rid")).toBeNull();
    expect(url.searchParams.get("email")).toBe("ana@example.com");
    expect(url.searchParams.get("name")).toBe("Ana Silva");
    expect(url.searchParams.get("phoneac")).toBe("11");
    expect(url.searchParams.get("phonenumber")).toBe("999999999");
    expect(url.searchParams.get("fbp")).toBe("fb.1.123");
    expect(url.searchParams.get("utm_source")).toBe("brevo");
    expect(url.searchParams.get("utm_medium")).toBe("manual");
    expect(url.searchParams.get("ignored")).toBeNull();
    expect(sent[0]).toMatchObject({
      event_type: "BEGIN_CHECKOUT",
      lead: { email: "ana@example.com" },
      attribution: { fbp: "fb.1.123", utm_source: "brevo", utm_medium: "manual" },
    });
  });

  it("expande token de recuperacao escopado por tenant", async () => {
    const requestedKeys: string[] = [];
    const res = await worker.fetch(
      makeRequest("plano-de-voo/checkout?rid=rec-scoped"),
      makeEnv({
        IDENTITY_KV: {
          get: async (key: string) => {
            requestedKeys.push(key);
            return key === "decole:checkout_recovery:rec-scoped"
              ? JSON.stringify({
                  params: {
                    email: "scoped@example.com",
                    name: "Scoped Lead",
                    fbp: "fb.2.scoped",
                  },
                })
              : null;
          },
        },
      })
    );

    expect(res.status).toBe(302);
    expect(requestedKeys[0]).toBe("decole:checkout_recovery:rec-scoped");
    const url = new URL(res.headers.get("location") || "");
    expect(url.searchParams.get("email")).toBe("scoped@example.com");
    expect(url.searchParams.get("name")).toBe("Scoped Lead");
    expect(url.searchParams.get("fbp")).toBe("fb.2.scoped");
  });

  it("redireciona /plano-de-voo/checkout/offer/:codigo com oferta da rota", async () => {
    const res = await worker.fetch(makeRequest("plano-de-voo/checkout/offer/novo123?utm_source=ig"), makeEnv());
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.pathname).toBe("/R105463680A");
    expect(url.searchParams.get("off")).toBe("novo123");
    expect(url.searchParams.get("offer")).toBe("novo123");
    expect(url.searchParams.get("utm_source")).toBe("ig");
  });

  it("retorna 404 quando /decole-esg/checkout/offer nao tem codigo", async () => {
    const res = await worker.fetch(makeRequest("decole-esg/checkout/offer?utm_source=ig"), makeEnv());
    expect(res.status).toBe(404);
  });

  it("redireciona /decole-esg/checkout/offer/:codigo com oferta da rota", async () => {
    const res = await worker.fetch(makeRequest("decole-esg/checkout/offer/3j6lto4t?utm_source=ig"), makeEnv());
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.searchParams.get("off")).toBe("3j6lto4t");
    expect(url.searchParams.get("offer")).toBe("3j6lto4t");
    expect(url.searchParams.get("utm_source")).toBe("ig");
  });

  it("resolve checkout por LINKS_PRODUCTS para produtos novos", async () => {
    const sent: unknown[] = [];
    const res = await worker.fetch(
      makeRequest("novo-produto/checkout?utm_campaign=multi"),
      makeEnv({
        LINKS_PRODUCTS: JSON.stringify([
          {
            checkoutPath: "/novo-produto/checkout",
            checkoutBaseUrl: "https://pay.hotmart.com/KNOVO999",
            productCode: "NOVO_PRODUTO",
          },
        ]),
        FUNNEL_EVENTS: {
          send: async (body: unknown) => {
            sent.push(body);
          },
        },
      })
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.pathname).toBe("/KNOVO999");
    expect(url.searchParams.get("utm_campaign")).toBe("multi");
    expect(sent[0]).toMatchObject({
      event_type: "BEGIN_CHECKOUT",
      product_code: "NOVO_PRODUTO",
    });
  });

  it("captura CF-Connecting-IP e inclui client_ip na attribution do BEGIN_CHECKOUT", async () => {
    const sent: unknown[] = [];
    const req = new Request("https://links.decolesuacarreiraesg.com.br/checkout?anonymous_id=anon-ip", {
      method: "GET",
      headers: { "cf-connecting-ip": "9.8.7.6" },
    });
    await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send: async (b: unknown) => { sent.push(b); } } }));
    expect(sent).toHaveLength(1);
    const evt = sent[0] as { attribution?: { client_ip?: string } };
    expect(evt?.attribution?.client_ip).toBe("9.8.7.6");
  });

  it("recusa metodos nao permitidos", async () => {
    const res = await worker.fetch(makeRequest("health", { method: "POST" }), makeEnv());
    expect(res.status).toBe(405);
  });
});
