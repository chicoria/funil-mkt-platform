import { describe, expect, it, vi } from "vitest";
import worker, { resolvePromoConfirmation } from "../../src/index";

type Env = {
  FUNNEL_EVENTS?: { send(body: unknown): Promise<void> };
  IDENTITY_KV?: { get(key: string): Promise<string | null> };
};

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { ...overrides };
}

function makeRequest(path: string): Request {
  return new Request(`https://links.decolesuacarreiraesg.com.br/${path}`, { method: "GET" });
}

function kvWith(record: Record<string, unknown> | null, forRid = "rid-123"): Env["IDENTITY_KV"] {
  return {
    get: vi.fn(async (key: string) => {
      if (key !== `promo_confirmation:${forRid}`) return null;
      return record ? JSON.stringify(record) : null;
    }),
  };
}

describe("resolvePromoConfirmation", () => {
  it("resolve email/promoCode quando o rid existe no KV", async () => {
    const env = makeEnv({ IDENTITY_KV: kvWith({ email: "a@b.com", nome: "Ana", promo_code: "ESG-PILOTO" }) });
    const result = await resolvePromoConfirmation(env as any, "rid-123");
    expect(result).toEqual({ email: "a@b.com", promoCode: "ESG-PILOTO" });
  });

  it("retorna null quando rid vazio", async () => {
    const env = makeEnv({ IDENTITY_KV: kvWith({ email: "a@b.com", promo_code: "X" }) });
    const result = await resolvePromoConfirmation(env as any, "");
    expect(result).toBeNull();
  });

  it("retorna null quando KV nao tem o rid (expirado/inexistente)", async () => {
    const env = makeEnv({ IDENTITY_KV: kvWith(null) });
    const result = await resolvePromoConfirmation(env as any, "rid-inexistente");
    expect(result).toBeNull();
  });

  it("retorna null quando registro no KV esta incompleto", async () => {
    const env = makeEnv({ IDENTITY_KV: kvWith({ email: "a@b.com" }) });
    const result = await resolvePromoConfirmation(env as any, "rid-incompleto");
    expect(result).toBeNull();
  });

  it("retorna null sem IDENTITY_KV bindado", async () => {
    const result = await resolvePromoConfirmation(makeEnv() as any, "rid-123");
    expect(result).toBeNull();
  });
});

describe("links-redirect worker — /{produto}/promo-signup", () => {
  it("rid valido -> redireciona pra /promo/{code}?email={email}", async () => {
    const env = makeEnv({ IDENTITY_KV: kvWith({ email: "ana@example.com", promo_code: "ESG-PILOTO" }) });
    const res = await worker.fetch(makeRequest("planodevoo/promo-signup?rid=rid-123"), env);

    expect(res.status).toBe(302);
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.origin).toBe("https://plano.decolesuacarreiraesg.com.br");
    expect(url.pathname).toBe("/promo/ESG-PILOTO");
    expect(url.searchParams.get("email")).toBe("ana@example.com");
  });

  it("usa cache-control: no-store", async () => {
    const env = makeEnv({ IDENTITY_KV: kvWith({ email: "ana@example.com", promo_code: "ESG-PILOTO" }) });
    const res = await worker.fetch(makeRequest("planodevoo/promo-signup?rid=rid-123"), env);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rid ausente -> 404, nao 500", async () => {
    const env = makeEnv({ IDENTITY_KV: kvWith({ email: "ana@example.com", promo_code: "ESG-PILOTO" }) });
    const res = await worker.fetch(makeRequest("planodevoo/promo-signup"), env);
    expect(res.status).toBe(404);
  });

  it("rid expirado/inexistente no KV -> 404, nao 500", async () => {
    const env = makeEnv({ IDENTITY_KV: kvWith(null) });
    const res = await worker.fetch(makeRequest("planodevoo/promo-signup?rid=rid-expirado"), env);
    expect(res.status).toBe(404);
  });

  it("prefixo de produto desconhecido -> 404", async () => {
    const env = makeEnv({ IDENTITY_KV: kvWith({ email: "ana@example.com", promo_code: "ESG-PILOTO" }) });
    const res = await worker.fetch(makeRequest("inexistente/promo-signup?rid=rid-123"), env);
    expect(res.status).toBe(404);
  });

  it("destino nao e influenciavel por query param do usuario (sem open redirect via rid)", async () => {
    const env = makeEnv({ IDENTITY_KV: kvWith({ email: "ana@example.com", promo_code: "ESG-PILOTO" }) });
    const res = await worker.fetch(
      makeRequest("planodevoo/promo-signup?rid=" + encodeURIComponent("https://evil.example.com")),
      env
    );
    // rid malicioso so e usado como chave de KV — nao existe essa chave, cai em 404
    expect(res.status).toBe(404);
  });
});
