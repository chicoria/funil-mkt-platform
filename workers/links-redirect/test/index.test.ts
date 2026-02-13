import { describe, expect, it } from "vitest";
import worker from "../src/index";

type Env = {
  ELIZETE_WHATSAPP_NUMBER?: string;
  ELIZETE_WHATSAPP_DEFAULT_TEXT?: string;
  CHECKOUT_URL?: string;
};

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ELIZETE_WHATSAPP_NUMBER: "351 915 787 088",
    ELIZETE_WHATSAPP_DEFAULT_TEXT: "Olá Elizete, preciso de ajuda",
    CHECKOUT_URL: "https://pay.hotmart.com/K98068530F?off=1myrvww7",
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

  it("padroniza oferta via parametro offer", async () => {
    const res = await worker.fetch(makeRequest("checkout?offer=n82b9jqz&utm_source=ig"), makeEnv());
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.searchParams.get("off")).toBe("n82b9jqz");
    expect(url.searchParams.get("offer")).toBe("n82b9jqz");
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

  it("recusa metodos nao permitidos", async () => {
    const res = await worker.fetch(makeRequest("health", { method: "POST" }), makeEnv());
    expect(res.status).toBe(405);
  });
});
