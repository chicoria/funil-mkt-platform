import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

type Env = {
  ALLOWED_ORIGIN: string;
  BREVO_API_KEY: string;
  BREVO_LIST_ID: string;
  BREVO_DOI_TEMPLATE_ID: string;
  BREVO_DOI_REDIRECT_URL: string;
  TURNSTILE_SECRET: string;
};

type RequestOptions = {
  method?: string;
  origin?: string | null;
  ajax?: boolean;
};

type BrevoPayload = {
  attributes?: {
    LEAD_ID?: string;
  };
  redirectionUrl?: string;
};

let fetchMock: any;

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ALLOWED_ORIGIN: "https://decolesuacarreiraesg.com.br",
    BREVO_API_KEY: "test_key",
    BREVO_LIST_ID: "7",
    BREVO_DOI_TEMPLATE_ID: "1",
    BREVO_DOI_REDIRECT_URL: "https://decolesuacarreiraesg.com.br/confirmacao.html",
    TURNSTILE_SECRET: "",
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown> | null, options: RequestOptions = {}): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(options.ajax ? { "x-brevo-ajax": "1", accept: "application/json" } : {}),
  };
  const origin = options.origin === undefined ? "https://decolesuacarreiraesg.com.br" : options.origin;
  if (origin !== null) headers.origin = origin;

  return new Request("https://forms.decolesuacarreiraesg.com.br/brevo", {
    method: options.method || "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeFetchResponse({
  ok = true,
  status = 200,
  jsonData = {},
  textData = "",
}: {
  ok?: boolean;
  status?: number;
  jsonData?: unknown;
  textData?: string;
} = {}): Response {
  return {
    ok,
    status,
    json: async () => jsonData,
    text: async () => textData,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: RequestInfo | URL) => {
    const urlStr = String(url || "");
    if (urlStr.includes("challenges.cloudflare.com/turnstile")) {
      return makeFetchResponse({ jsonData: { success: true } });
    }
    if (urlStr.includes("api.brevo.com")) {
      return makeFetchResponse();
    }
    return makeFetchResponse();
  });

  vi.stubGlobal("fetch", fetchMock);
});

describe("brevo worker", () => {
  it("recusa metodos nao POST", async () => {
    const req = makeRequest(null, { method: "GET" });
    const res = await worker.fetch(req, makeEnv({ TURNSTILE_SECRET: "secret" }));
    expect(res.status).toBe(405);
  });

  it("recusa origem nao permitida", async () => {
    const req = makeRequest({ email: "teste@exemplo.com" }, { origin: "https://malicioso.com" });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });

  it("recusa requisicao sem header origin", async () => {
    const req = makeRequest({ email: "teste@exemplo.com" }, { origin: null });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });

  it("recusa preflight com origem nao permitida", async () => {
    const req = makeRequest(null, { method: "OPTIONS", origin: "https://malicioso.com" });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });

  it("exige email", async () => {
    const req = makeRequest({});
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it("falha captcha quando turnstile retorna false", async () => {
    fetchMock.mockImplementationOnce(async (url: RequestInfo | URL) => {
      if (String(url).includes("challenges.cloudflare.com/turnstile")) {
        return makeFetchResponse({ jsonData: { success: false } });
      }
      return makeFetchResponse();
    });

    const req = makeRequest({ email: "teste@exemplo.com", "cf-turnstile-response": "token" });
    const res = await worker.fetch(req, makeEnv({ TURNSTILE_SECRET: "secret" }));
    expect(res.status).toBe(400);
  });

  it("retorna JSON quando nao ha redirect", async () => {
    const req = makeRequest({ email: "teste@exemplo.com" });
    const res = await worker.fetch(req, makeEnv({ BREVO_DOI_REDIRECT_URL: "" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean };
    expect(json.ok).toBe(true);
  });

  it("inclui LEAD_ID e identificadores da Meta na redirectionUrl (DOI)", async () => {
    let brevoBody: BrevoPayload | undefined;

    fetchMock.mockImplementation(async (url: RequestInfo | URL, options?: RequestInit) => {
      const urlStr = String(url || "");
      if (urlStr.includes("challenges.cloudflare.com/turnstile")) {
        return makeFetchResponse({ jsonData: { success: true } });
      }
      if (urlStr.includes("api.brevo.com")) {
        brevoBody = JSON.parse(String(options?.body || "{}")) as BrevoPayload;
        return makeFetchResponse();
      }
      return makeFetchResponse();
    });

    const req = makeRequest({
      email: "teste@exemplo.com",
      LEAD_ID: "lead-123",
      FBP: "fb.1.1234567890.1111111111",
      FBC: "fb.1.1234567890.ABCDEF1234567890",
      FBCLID: "ABCDEF1234567890",
    });
    const res = await worker.fetch(req, makeEnv());

    expect(res.status).toBe(200);
    expect(brevoBody?.attributes?.LEAD_ID).toBe("lead-123");
    expect(brevoBody?.redirectionUrl).toContain("lead_id=lead-123");
    expect(brevoBody?.redirectionUrl).toContain("fbp=fb.1.1234567890.1111111111");
    expect(brevoBody?.redirectionUrl).toContain("fbc=fb.1.1234567890.ABCDEF1234567890");
    expect(brevoBody?.redirectionUrl).toContain("fbclid=ABCDEF1234567890");
  });

  it("inclui LEAD_ID nos atributos quando DOI esta desativado", async () => {
    let brevoBody: BrevoPayload | undefined;

    fetchMock.mockImplementation(async (url: RequestInfo | URL, options?: RequestInit) => {
      const urlStr = String(url || "");
      if (urlStr.includes("challenges.cloudflare.com/turnstile")) {
        return makeFetchResponse({ jsonData: { success: true } });
      }
      if (urlStr.includes("api.brevo.com")) {
        brevoBody = JSON.parse(String(options?.body || "{}")) as BrevoPayload;
        return makeFetchResponse();
      }
      return makeFetchResponse();
    });

    const req = makeRequest({ email: "teste@exemplo.com", LEAD_ID: "lead-456" });
    const res = await worker.fetch(
      req,
      makeEnv({ BREVO_DOI_TEMPLATE_ID: "0", BREVO_DOI_REDIRECT_URL: "" })
    );

    expect(res.status).toBe(200);
    expect(brevoBody?.attributes?.LEAD_ID).toBe("lead-456");
    expect(brevoBody?.redirectionUrl).toBeUndefined();
  });

  it("propaga erro do brevo (sms ja associado)", async () => {
    fetchMock.mockImplementationOnce(async (url: RequestInfo | URL) => {
      if (String(url).includes("challenges.cloudflare.com/turnstile")) {
        return makeFetchResponse({ jsonData: { success: true } });
      }
      return makeFetchResponse();
    });

    fetchMock.mockImplementationOnce(async () => {
      return makeFetchResponse({
        ok: false,
        status: 400,
        textData: JSON.stringify({
          code: "invalid_parameter",
          message:
            "This sms number is already associated with another user. Please use a different sms number.",
        }),
      });
    });

    const req = makeRequest(
      {
        email: "teste@exemplo.com",
        SMS: "11999999999",
        SMS__COUNTRY_CODE: "+55",
        "cf-turnstile-response": "token",
      },
      { ajax: true }
    );

    const res = await worker.fetch(req, makeEnv({ TURNSTILE_SECRET: "secret" }));
    expect(res.status).toBe(400);

    const json = (await res.json()) as { error?: string; code?: string; message?: string };
    expect(json.error).toBe("brevo_error");
    expect(json.code).toBe("invalid_parameter");
    expect(json.message).toMatch(/sms number is already associated/i);
  });

  it("propaga erro do brevo (telefone invalido)", async () => {
    fetchMock.mockImplementationOnce(async (url: RequestInfo | URL) => {
      if (String(url).includes("challenges.cloudflare.com/turnstile")) {
        return makeFetchResponse({ jsonData: { success: true } });
      }
      return makeFetchResponse();
    });

    fetchMock.mockImplementationOnce(async () => {
      return makeFetchResponse({
        ok: false,
        status: 400,
        textData: JSON.stringify({
          code: "invalid_parameter",
          message: "Invalid phone number",
        }),
      });
    });

    const req = makeRequest(
      {
        email: "teste@exemplo.com",
        SMS: "123",
        SMS__COUNTRY_CODE: "+55",
        "cf-turnstile-response": "token",
      },
      { ajax: true }
    );

    const res = await worker.fetch(req, makeEnv({ TURNSTILE_SECRET: "secret" }));
    expect(res.status).toBe(400);

    const json = (await res.json()) as { error?: string; code?: string; message?: string };
    expect(json.error).toBe("brevo_error");
    expect(json.code).toBe("invalid_parameter");
    expect(json.message).toMatch(/invalid phone number/i);
  });
});
