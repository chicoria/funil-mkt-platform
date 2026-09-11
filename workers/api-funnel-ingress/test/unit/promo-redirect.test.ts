/**
 * Fatia C — desvio para o resgate promocional gratuito no /funnel/precheckout
 * payload com promo_code -> redirect_url aponta pro /promo/{code} (links-redirect,
 * Fatia B) em vez do checkout Hotmart; sem promo_code, comportamento intacto.
 */
import { describe, it, expect, vi } from "vitest";
import worker from "../../src/index";
// @ts-expect-error — sufixo ?raw do Vite: conteúdo do arquivo como string, sem tipos do Node
import indexSource from "../../src/index.ts?raw";

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    FUNNEL_EVENTS: { send: vi.fn(async () => {}) },
    ...overrides,
  } as never;
}

function precheckoutRequest(body: Record<string, string>, origin = "https://decolesuacarreiraesg.com.br") {
  const form = new URLSearchParams(body).toString();
  return new Request("https://api.decolesuacarreiraesg.com.br/funnel/precheckout", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": origin,
    },
    body: form,
  });
}

describe("precheckout — desvio promocional gratuito", () => {
  it("payload com promo_code -> redirect_url aponta para /planodevoo/promo/{code}", async () => {
    const req = precheckoutRequest({
      email: "ana@example.com",
      product_code: "DECOLE_PLANOVOO",
      promo_code: "ESG-PILOTO",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(json.redirect_url as string).toContain("links.decolesuacarreiraesg.com.br");
    expect(json.redirect_url as string).toContain("/planodevoo/promo/ESG-PILOTO");
    expect(json.redirect_url as string).not.toContain("/plano-de-voo/checkout");
  });

  it("payload sem promo_code -> comportamento atual preservado (checkout Hotmart)", async () => {
    const req = precheckoutRequest({
      email: "ana@example.com",
      product_code: "DECOLE_PLANOVOO",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(json.redirect_url as string).toContain("/plano-de-voo/checkout");
  });

  it("promo_code vazio tratado como ausente -> cai no checkout normal", async () => {
    const req = precheckoutRequest({
      email: "ana@example.com",
      product_code: "DECOLE_PLANOVOO",
      promo_code: "",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.redirect_url as string).toContain("/plano-de-voo/checkout");
  });

  it("promo_code presente mas produto sem rota channel_referral com prefixo -> fallback pro checkout", async () => {
    // ESG Mentoria usa /ref/{slug} (sem prefixo de produto) — nao tem
    // "{prefixo}/ref/..." pra derivar o path de promo, entao cai no checkout.
    const req = precheckoutRequest({
      email: "joao@example.com",
      product_code: "DECOLE_ESG_MENTORIA",
      promo_code: "ESG-PILOTO",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(json.redirect_url as string).toContain("/decole-esg/checkout");
  });

  it("propaga email e name no destino promocional", async () => {
    const req = precheckoutRequest({
      EMAIL: "ana@example.com",
      FIRSTNAME: "Ana",
      LASTNAME: "Silva",
      product_code: "DECOLE_PLANOVOO",
      promo_code: "ESG-PILOTO",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.redirect_url as string).toContain("email=ana%40example.com");
    expect(json.redirect_url as string).toContain("name=Ana+Silva");
  });

  it("promo_code com caractere especial e encodado, sem escapar do path", async () => {
    const req = precheckoutRequest({
      email: "ana@example.com",
      product_code: "DECOLE_PLANOVOO",
      promo_code: "../evil a%b",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = (await res.json()) as Record<string, unknown>;

    const url = new URL(json.redirect_url as string);
    expect(url.hostname).toBe("links.decolesuacarreiraesg.com.br");
    // path continua sob /planodevoo/promo/ — nao escapa via ../ nem muda host
    expect(url.pathname.startsWith("/planodevoo/promo/")).toBe(true);
    expect(url.pathname).not.toContain("/../");
  });

  it("enfileira o evento antes de montar o redirect promocional", async () => {
    const sendOrder: string[] = [];
    const env = makeEnv({
      FUNNEL_EVENTS: {
        send: vi.fn(async () => {
          sendOrder.push("queued");
        }),
      },
    });
    const req = precheckoutRequest({
      email: "ana@example.com",
      product_code: "DECOLE_PLANOVOO",
      promo_code: "ESG-PILOTO",
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(202);
    expect(sendOrder).toEqual(["queued"]);
  });

  it("mantem o worker agnostico de tenant/produto — nenhum literal hardcoded em src/index.ts", () => {
    const matches = (indexSource as string).match(/DECOLE|PLANOVOO|ESG/g) || [];
    expect(matches).toEqual([]);
  });
});
