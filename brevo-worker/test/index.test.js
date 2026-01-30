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
      ...(options.ajax ? { "x-brevo-ajax": "1", accept: "application/json" } : {}),
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
    var res = await worker.fetch(req, makeEnv({ TURNSTILE_SECRET: "secret" }));
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

  it("retorna JSON quando ajax e ha redirect", async () => {
    var req = makeRequest({ email: "teste@exemplo.com" }, { ajax: true });
    var res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    var json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.redirectUrl).toContain("https://pay.hotmart.com/");
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

  it("inclui LEAD_ID nos atributos e na redirectionUrl (DOI)", async () => {
    var brevoBody;
    global.fetch.mockImplementation(async (url, options) => {
      var urlStr = String(url || "");
      if (urlStr.indexOf("challenges.cloudflare.com/turnstile") !== -1) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (urlStr.indexOf("api.brevo.com") !== -1) {
        brevoBody = JSON.parse(options.body);
        return { ok: true, status: 200, text: async () => "" };
      }
      return { ok: true, status: 200, text: async () => "" };
    });

    var req = makeRequest({ email: "teste@exemplo.com", LEAD_ID: "lead-123" });
    var res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(303);
    expect(brevoBody.attributes.LEAD_ID).toBe("lead-123");
    expect(brevoBody.redirectionUrl).toContain("lead_id=lead-123");
  });

  it("inclui LEAD_ID nos atributos quando DOI esta desativado", async () => {
    var brevoBody;
    global.fetch.mockImplementation(async (url, options) => {
      var urlStr = String(url || "");
      if (urlStr.indexOf("challenges.cloudflare.com/turnstile") !== -1) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (urlStr.indexOf("api.brevo.com") !== -1) {
        brevoBody = JSON.parse(options.body);
        return { ok: true, status: 200, text: async () => "" };
      }
      return { ok: true, status: 200, text: async () => "" };
    });

    var req = makeRequest({ email: "teste@exemplo.com", LEAD_ID: "lead-456" });
    var res = await worker.fetch(
      req,
      makeEnv({ BREVO_DOI_TEMPLATE_ID: "0", BREVO_DOI_REDIRECT_URL: "" })
    );
    expect(res.status).toBe(303);
    expect(brevoBody.attributes.LEAD_ID).toBe("lead-456");
    expect(brevoBody.redirectionUrl).toBeUndefined();
  });

  it("mapeia erro de sms ja associado", async () => {
    global.fetch.mockImplementationOnce(async (url) => {
      if (String(url).indexOf("challenges.cloudflare.com/turnstile") !== -1) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, status: 200, text: async () => "" };
    });
    global.fetch.mockImplementationOnce(async () => {
      return {
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            code: "invalid_parameter",
            message:
              "This sms number is already associated with another user. Please use a different sms number.",
          }),
      };
    });

    var req = makeRequest(
      {
        email: "teste@exemplo.com",
        SMS: "11999999999",
        SMS__COUNTRY_CODE: "+55",
        "cf-turnstile-response": "token"
      },
      { ajax: true }
    );
    var res = await worker.fetch(req, makeEnv({ TURNSTILE_SECRET: "secret" }));
    expect(res.status).toBe(409);
    var json = await res.json();
    expect(json.error).toBe("sms_already_used");
  });
});
