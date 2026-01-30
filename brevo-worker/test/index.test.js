import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";

function makeEnv(overrides = {}) {
  return {
    ALLOWED_ORIGIN: "https://decolesuacarreiraesg.com.br",
    BREVO_API_KEY: "test_key",
    BREVO_LIST_ID: "7",
    BREVO_DOI_TEMPLATE_ID: "1",
    BREVO_DOI_REDIRECT_URL: "https://decolesuacarreiraesg.com.br/confirmacao.html",
    POST_SUBMIT_REDIRECT_URL: "https://pay.hotmart.com/K98068530F?off=1myrvww7",
    TURNSTILE_SECRET: "",
    ...overrides,
  };
}

function makeRequest(body, options = {}) {
  return new Request("https://forms.decolesuacarreiraesg.com.br/brevo", {
    method: options.method || "POST",
    headers: {
      origin: options.origin || "https://decolesuacarreiraesg.com.br",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      var urlStr = String(url || "");
      if (urlStr.indexOf("challenges.cloudflare.com/turnstile") !== -1) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (urlStr.indexOf("api.brevo.com") !== -1) {
        return { ok: true, status: 200, text: async () => "" };
      }
      return { ok: true, status: 200, text: async () => "" };
    })
  );
});

describe("brevo worker", () => {
  it("recusa metodos nao POST", async () => {
    var req = makeRequest(null, { method: "GET" });
    var res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(405);
  });

  it("recusa origem nao permitida", async () => {
    var req = makeRequest({ email: "teste@exemplo.com" }, { origin: "https://malicioso.com" });
    var res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });

  it("exige email", async () => {
    var req = makeRequest({});
    var res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it("falha captcha quando turnstile retorna false", async () => {
    global.fetch.mockImplementationOnce(async (url) => {
      if (String(url).indexOf("challenges.cloudflare.com/turnstile") !== -1) {
        return { ok: true, json: async () => ({ success: false }) };
      }
      return { ok: true, status: 200, text: async () => "" };
    });

    var req = makeRequest({ email: "teste@exemplo.com", "cf-turnstile-response": "token" });
    var res = await worker.fetch(req, makeEnv({ TURNSTILE_SECRET: "secret" }));
    expect(res.status).toBe(400);
  });

  it("redireciona quando ha POST_SUBMIT_REDIRECT_URL", async () => {
    var req = makeRequest({ email: "teste@exemplo.com" });
    var res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("https://pay.hotmart.com/");
  });

  it("retorna JSON quando nao ha redirect", async () => {
    var req = makeRequest({ email: "teste@exemplo.com" });
    var res = await worker.fetch(
      req,
      makeEnv({ POST_SUBMIT_REDIRECT_URL: "", BREVO_DOI_REDIRECT_URL: "" })
    );
    expect(res.status).toBe(200);
    var json = await res.json();
    expect(json.ok).toBe(true);
  });
});
