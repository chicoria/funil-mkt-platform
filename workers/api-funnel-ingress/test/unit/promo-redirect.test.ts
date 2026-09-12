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
  // Fatia G: com o gate de DOI, a entrega do link deixa de ser síncrona (via
  // redirect_url) — o único caminho passa a ser o e-mail de confirmação
  // (funnel-dispatcher, assíncrono). Por isso, quando existe rota promocional
  // configurada pro produto, a resposta não deve trazer redirect_url nenhum
  // (nem pro resgate, nem pro checkout) — o frontend já trata a ausência de
  // redirect_url mostrando "Confirme no e-mail para liberar o acesso."
  it("payload com promo_code e rota promocional configurada -> sem redirect_url (entrega só via DOI)", async () => {
    const req = precheckoutRequest({
      email: "ana@example.com",
      product_code: "DECOLE_PLANOVOO",
      promo_code: "ESG-PILOTO",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(json.redirect_url).toBeUndefined();
  });

  it("payload com promo_code -> email/nome nunca aparecem em nenhum campo da resposta", async () => {
    const req = precheckoutRequest({
      EMAIL: "ana@example.com",
      FIRSTNAME: "Ana",
      LASTNAME: "Silva",
      product_code: "DECOLE_PLANOVOO",
      promo_code: "ESG-PILOTO",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = (await res.json()) as Record<string, unknown>;

    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain("ana@example.com");
    expect(serialized).not.toContain("Ana");
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

  it("promo_code com caractere especial -> ainda sem redirect_url, sem crash", async () => {
    const req = precheckoutRequest({
      email: "ana@example.com",
      product_code: "DECOLE_PLANOVOO",
      promo_code: "../evil a%b",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(json.redirect_url).toBeUndefined();
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
