import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

function makeEnv(overrides: Record<string, unknown> = {}): any {
  return {
    HOTMART_EVENTS: {
      send: vi.fn(async () => undefined),
    },
    HOTMART_WEBHOOK_TOKEN: "",
    ...overrides,
  };
}

function makeRequest(path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Request {
  return new Request(`https://api.decolesuacarreiraesg.com.br${path}`, {
    method: options.method || "POST",
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("api-external-webhooks", () => {
  it("retorna healthcheck", async () => {
    const req = makeRequest("/health", { method: "GET" });
    const res = await worker.fetch(req, makeEnv() as any);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; worker?: string };
    expect(json.ok).toBe(true);
    expect(json.worker).toBe("api-external-webhooks");
  });

  it("recusa metodo diferente de POST", async () => {
    const req = makeRequest("/webhooks/v1/decole-esg/hotmart/events", { method: "GET" });
    const res = await worker.fetch(req, makeEnv() as any);
    expect(res.status).toBe(405);
  });

  it("retorna 500 quando queue nao esta configurada", async () => {
    const req = makeRequest("/webhooks/v1/decole-esg/hotmart/events", {
      body: '{"event":"PURCHASE_APPROVED"}',
    });
    const res = await worker.fetch(req, makeEnv({ HOTMART_EVENTS: undefined }) as any);
    expect(res.status).toBe(500);
  });

  it("usa operacao do path como fallback quando payload nao possui tipo de evento", async () => {
    const queueSend = vi.fn(async () => undefined);
    const req = makeRequest("/webhooks/v1/decole-esg/hotmart/events", { body: "{}" });
    const res = await worker.fetch(
      req,
      makeEnv({
        HOTMART_EVENTS: { send: queueSend },
      }) as any
    );

    expect(res.status).toBe(202);
    expect(queueSend).toHaveBeenCalledTimes(1);
    const payload = ((queueSend as any).mock.calls[0] || [])[0] as { eventType?: string };
    expect(payload.eventType).toBe("EVENTS");
  });

  it("enfileira evento quando token nao e exigido", async () => {
    const queueSend = vi.fn(async () => undefined);
    const req = makeRequest("/webhooks/v1/decole-esg/hotmart/events", {
      body: JSON.stringify({
        event: "PURCHASE_APPROVED",
        id: "evt-123",
        buyer: { email: "aluna@exemplo.com" },
        data: {
          product: {
            id: 3526906,
            name: "Metodo DECOLE",
          },
        },
      }),
    });

    const res = await worker.fetch(
      req,
      makeEnv({
        HOTMART_EVENTS: { send: queueSend },
      }) as any
    );

    expect(res.status).toBe(202);
    expect(queueSend).toHaveBeenCalledTimes(1);
    const firstCall = (queueSend as any).mock.calls[0] || [];
    const payload = (firstCall[0] || {}) as {
      eventType?: string;
      eventId?: string;
      email?: string;
      productId?: string;
      productName?: string;
      productSlug?: string;
      subsystem?: string;
      operation?: string;
    };
    expect(payload.eventType).toBe("PURCHASE_APPROVED");
    expect(payload.eventId).toBe("evt-123");
    expect(payload.email).toBe("aluna@exemplo.com");
    expect(payload.productId).toBe("3526906");
    expect(payload.productName).toBe("Metodo DECOLE");
    expect(payload.productSlug).toBe("decole-esg");
    expect(payload.subsystem).toBe("hotmart");
    expect(payload.operation).toBe("events");
  });

  it("retorna 401 quando token e exigido e nao enviado", async () => {
    const req = makeRequest("/webhooks/v1/decole-esg/hotmart/events", { body: "{}" });
    const res = await worker.fetch(req, makeEnv({ HOTMART_WEBHOOK_TOKEN: "segredo" }) as any);
    expect(res.status).toBe(401);
  });

  it("aceita quando token e enviado no header x-hotmart-hottok", async () => {
    const queueSend = vi.fn(async () => undefined);
    const req = makeRequest("/webhooks/v1/decole-esg/hotmart/events", {
      headers: {
        "x-hotmart-hottok": "segredo",
      },
      body: '{"event":"PURCHASE_APPROVED"}',
    });

    const res = await worker.fetch(
      req,
      makeEnv({
        HOTMART_WEBHOOK_TOKEN: "segredo",
        HOTMART_EVENTS: { send: queueSend },
      }) as any
    );

    expect(res.status).toBe(202);
    expect(queueSend).toHaveBeenCalledTimes(1);
  });

  it("aceita rota legada /webhooks/hotmart", async () => {
    const queueSend = vi.fn(async () => undefined);
    const req = makeRequest("/webhooks/hotmart", {
      body: '{"event":"PURCHASE_APPROVED"}',
    });
    const res = await worker.fetch(req, makeEnv({ HOTMART_EVENTS: { send: queueSend } }) as any);
    expect(res.status).toBe(202);
    expect(queueSend).toHaveBeenCalledTimes(1);
  });

  it("usa operacao do path como fallback de eventType", async () => {
    const queueSend = vi.fn(async () => undefined);
    const req = makeRequest("/webhooks/v1/planodevoo/hotmart/purchase-approved", {
      body: "{}",
    });
    const res = await worker.fetch(req, makeEnv({ HOTMART_EVENTS: { send: queueSend } }) as any);
    expect(res.status).toBe(202);
    const payload = ((queueSend as any).mock.calls[0] || [])[0] as { eventType?: string; operation?: string };
    expect(payload.eventType).toBe("PURCHASE_APPROVED");
    expect(payload.operation).toBe("purchase-approved");
  });

  it("retorna 404 quando rota nao segue o padrao", async () => {
    const req = makeRequest("/webhooks/v1/decole-esg/hotmart", {
      body: '{"event":"PURCHASE_APPROVED"}',
    });
    const res = await worker.fetch(req, makeEnv() as any);
    expect(res.status).toBe(404);
  });

  it("faz forward para n8n quando regra de forwarding existe", async () => {
    const queueSend = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => "",
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest("/webhooks/v1/planodevoo/hotmart/purchase-approved", {
      body: '{"event":"PURCHASE_APPROVED"}',
    });

    const res = await worker.fetch(
      req,
      makeEnv({
        HOTMART_EVENTS: { send: queueSend },
        WEBHOOK_FORWARDING_RULES: JSON.stringify([
          {
            productSlug: "planodevoo",
            subsystem: "hotmart",
            targetUrl: "https://n8n.decolesuacarreiraesg.com.br/webhook/plano-de-voo/hotmart",
            required: true,
          },
        ]),
      }) as any
    );

    expect(res.status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstForwardCall = (fetchMock.mock.calls as unknown[][])[0];
    expect(firstForwardCall).toBeDefined();
    const forwardUrl = String(firstForwardCall?.[0] ?? "");
    const options = firstForwardCall?.[1] as RequestInit | undefined;
    expect(forwardUrl).toBe("https://n8n.decolesuacarreiraesg.com.br/webhook/plano-de-voo/hotmart");
    expect(options?.method).toBe("POST");
    expect(queueSend).toHaveBeenCalledTimes(1);
  });

  it("retorna 502 quando forwarding obrigatorio falha", async () => {
    const queueSend = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        text: async () => "n8n_down",
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeRequest("/webhooks/v1/planodevoo/hotmart/purchase-approved", {
      body: '{"event":"PURCHASE_APPROVED"}',
    });

    const res = await worker.fetch(
      req,
      makeEnv({
        HOTMART_EVENTS: { send: queueSend },
        WEBHOOK_FORWARDING_RULES: JSON.stringify([
          {
            productSlug: "planodevoo",
            subsystem: "hotmart",
            targetUrl: "https://n8n.decolesuacarreiraesg.com.br/webhook/plano-de-voo/hotmart",
            required: true,
          },
        ]),
      }) as any
    );

    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queueSend).not.toHaveBeenCalled();
  });
});
