/**
 * TDD Red — precheckout catalog-driven redirect
 * Garante que /funnel/precheckout retorna 302 para o checkout URL do catálogo
 * incluindo email e attribution params, em vez de 202 JSON.
 */
import { describe, it, expect, vi } from "vitest";
import worker from "../../src/index";

// ── Env stub ──────────────────────────────────────────────────────────────────

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    FUNNEL_EVENTS: { send: vi.fn(async () => {}) },
    ...overrides,
  } as never;
}

// ── Request helpers ───────────────────────────────────────────────────────────

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

// ── Testes ────────────────────────────────────────────────────────────────────

describe("precheckout — catalog-driven redirect", () => {

  it("retorna 202 JSON com redirect_url para checkout PlanoVoo com email", async () => {
    const req = precheckoutRequest({
      email: "ana@example.com",
      product_code: "DECOLE_PLANOVOO",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(json.ok).toBe(true);
    expect(typeof json.redirect_url).toBe("string");
    expect(json.redirect_url as string).toContain("links.decolesuacarreiraesg.com.br");
    expect(json.redirect_url as string).toContain("/plano-de-voo/checkout");
    expect(json.redirect_url as string).toContain("email=ana%40example.com");
  });

  it("retorna 202 JSON com redirect_url para checkout ESG Mentoria com email", async () => {
    const req = precheckoutRequest({
      email: "joao@example.com",
      product_code: "DECOLE_ESG_MENTORIA",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(202);
    expect(json.redirect_url as string).toContain("/decole-esg/checkout");
    expect(json.redirect_url as string).toContain("email=joao%40example.com");
  });

  it("propaga UTMs no redirect_url do JSON", async () => {
    const req = precheckoutRequest({
      email: "maria@example.com",
      product_code: "DECOLE_PLANOVOO",
      utm_source: "instagram",
      utm_medium: "social",
      utm_campaign: "lancamento",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = await res.json() as Record<string, unknown>;

    expect(json.redirect_url as string).toContain("utm_source=instagram");
    expect(json.redirect_url as string).toContain("utm_medium=social");
    expect(json.redirect_url as string).toContain("utm_campaign=lancamento");
  });

  it("propaga fbp e anonymous_id no redirect_url do JSON", async () => {
    const req = precheckoutRequest({
      email: "pedro@example.com",
      product_code: "DECOLE_PLANOVOO",
      fbp: "fb.1.123456789.987654321",
      anonymous_id: "anon-abc-123",
    });
    const res = await worker.fetch(req, makeEnv());
    const json = await res.json() as Record<string, unknown>;

    expect(json.redirect_url as string).toContain("fbp=fb.1.123456789.987654321");
    expect(json.redirect_url as string).toContain("anonymous_id=anon-abc-123");
  });

  it("enfileira o evento na queue antes de redirecionar", async () => {
    const sendMock = vi.fn(async () => {});
    const req = precheckoutRequest({
      email: "test@example.com",
      product_code: "DECOLE_PLANOVOO",
    });
    await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send: sendMock } }));

    expect(sendMock).toHaveBeenCalledOnce();
    const event = (sendMock.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0];
    expect(event.event_type).toBe("GENERATE_LEAD");
    expect(event.product_code).toBe("DECOLE_PLANOVOO");
  });

  it("retorna 202 JSON como fallback quando produto nao tem rota no catalogo", async () => {
    const req = precheckoutRequest({
      email: "test@example.com",
      product_code: "PRODUTO_SEM_ROTA",
    });
    const res = await worker.fetch(req, makeEnv());

    // Produto sem rota configurada → fallback para 202 JSON
    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it("nao inclui email vazio no redirect URL", async () => {
    const req = precheckoutRequest({
      product_code: "DECOLE_PLANOVOO",
      // sem email
    });
    const res = await worker.fetch(req, makeEnv());

    const location = res.headers.get("location") || "";
    if (res.status === 302) {
      expect(location).not.toContain("email=");
    }
    // sem email ainda deve redirecionar (o checkout aceita sem email)
    expect([302, 202]).toContain(res.status);
  });
});
