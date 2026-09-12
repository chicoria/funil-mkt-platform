import { describe, expect, it, vi } from "vitest";
import worker, { resolvePromoConfirmation } from "../../src/index";

type Env = {
  FUNNEL_EVENTS?: { send(body: unknown): Promise<void> };
  IDENTITY_KV?: { get(key: string): Promise<string | null> };
  PROMO_SIGNUP_SECRET?: string;
};

const TEST_SECRET = "test-secret-nao-usar-em-produção";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { PROMO_SIGNUP_SECRET: TEST_SECRET, ...overrides };
}

// Espelha a verificação que decole-plano-de-voo-app faz (lib/promo/promo-token.ts)
// — usado só nos testes, pra confirmar que o token assinado por
// signPromoToken é de fato verificável do outro lado com o mesmo segredo.
function base64UrlDecode(str: string): string {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

function hexToBuf(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes.buffer;
}

async function verifyTokenForTest(secret: string, code: string, token: string): Promise<{ email: string } | null> {
  const [payloadB64, sigHex] = token.split(".");
  if (!payloadB64 || !sigHex) return null;
  const payload = JSON.parse(base64UrlDecode(payloadB64)) as { c?: string; e?: string; exp?: number };
  if (payload.c !== code) return null;
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, hexToBuf(sigHex), new TextEncoder().encode(payloadB64));
  return valid && payload.e ? { email: payload.e } : null;
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
  // Achado CRITICAL do G.12 (2ª rodada): mesmo com as duas correções
  // anteriores, o app final (decole-plano-de-voo-app) sempre aceitou
  // qualquer "email" cru na query string do domínio público — permitindo
  // resgate direto sem nunca confirmar DOI, bastando conhecer o domínio +
  // promo_code. Fix: em vez de "?email=", esta rota agora emite um token
  // assinado (HMAC-SHA256, segredo compartilhado PROMO_SIGNUP_SECRET) que
  // amarra email+code+expiração — o app só resgata com um token válido,
  // nunca mais aceita email cru.
  it("rid valido -> redireciona pra /promo/{code}?token={token assinado}, sem email na query", async () => {
    const env = makeEnv({ IDENTITY_KV: kvWith({ email: "ana@example.com", promo_code: "ESG-PILOTO" }) });
    const res = await worker.fetch(makeRequest("planodevoo/promo-signup?rid=rid-123"), env);

    expect(res.status).toBe(302);
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.origin).toBe("https://plano.decolesuacarreiraesg.com.br");
    expect(url.pathname).toBe("/promo/ESG-PILOTO");
    expect(url.searchParams.get("email")).toBeNull();
    const token = url.searchParams.get("token") || "";
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]+$/);
  });

  it("token emitido e verificavel com o mesmo segredo e resolve pro email correto", async () => {
    const env = makeEnv({ IDENTITY_KV: kvWith({ email: "ana@example.com", promo_code: "ESG-PILOTO" }) });
    const res = await worker.fetch(makeRequest("planodevoo/promo-signup?rid=rid-123"), env);
    const url = new URL(res.headers.get("location") || "");
    const token = url.searchParams.get("token") || "";

    const verified = await verifyTokenForTest(TEST_SECRET, "ESG-PILOTO", token);
    expect(verified).toEqual({ email: "ana@example.com" });

    // segredo errado -> nao verifica (assinatura nao bate)
    const wrongSecret = await verifyTokenForTest("segredo-errado", "ESG-PILOTO", token);
    expect(wrongSecret).toBeNull();

    // code errado -> nao verifica (token amarrado ao code correto)
    const wrongCode = await verifyTokenForTest(TEST_SECRET, "OUTRO-CODE", token);
    expect(wrongCode).toBeNull();
  });

  it("sem PROMO_SIGNUP_SECRET configurado -> 500, nunca cai pra email cru", async () => {
    const env = makeEnv({
      IDENTITY_KV: kvWith({ email: "ana@example.com", promo_code: "ESG-PILOTO" }),
      PROMO_SIGNUP_SECRET: undefined,
    });
    const res = await worker.fetch(makeRequest("planodevoo/promo-signup?rid=rid-123"), env);
    expect(res.status).toBe(500);
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
