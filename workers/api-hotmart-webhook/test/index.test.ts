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

describe("api-hotmart-webhook", () => {
  it("retorna healthcheck", async () => {
    const req = makeRequest("/health", { method: "GET" });
    const res = await worker.fetch(req, makeEnv() as any);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean };
    expect(json.ok).toBe(true);
  });

  it("recusa metodo diferente de POST", async () => {
    const req = makeRequest("/webhooks/hotmart", { method: "GET" });
    const res = await worker.fetch(req, makeEnv() as any);
    expect(res.status).toBe(405);
  });

  it("retorna 500 quando queue nao esta configurada", async () => {
    const req = makeRequest("/webhooks/hotmart", { body: '{"event":"PURCHASE_APPROVED"}' });
    const res = await worker.fetch(req, makeEnv({ HOTMART_EVENTS: undefined }) as any);
    expect(res.status).toBe(500);
  });

  it("retorna 400 quando payload nao possui tipo de evento", async () => {
    const queueSend = vi.fn(async () => undefined);
    const req = makeRequest("/webhooks/hotmart", { body: "{}" });
    const res = await worker.fetch(
      req,
      makeEnv({
        HOTMART_EVENTS: { send: queueSend },
      }) as any
    );

    expect(res.status).toBe(400);
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("enfileira evento quando token nao e exigido", async () => {
    const queueSend = vi.fn(async () => undefined);
    const req = makeRequest("/webhooks/hotmart", {
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
    };
    expect(payload.eventType).toBe("PURCHASE_APPROVED");
    expect(payload.eventId).toBe("evt-123");
    expect(payload.email).toBe("aluna@exemplo.com");
    expect(payload.productId).toBe("3526906");
    expect(payload.productName).toBe("Metodo DECOLE");
  });

  it("retorna 401 quando token e exigido e nao enviado", async () => {
    const req = makeRequest("/webhooks/hotmart", { body: "{}" });
    const res = await worker.fetch(req, makeEnv({ HOTMART_WEBHOOK_TOKEN: "segredo" }) as any);
    expect(res.status).toBe(401);
  });

  it("aceita quando token e enviado no header x-hotmart-hottok", async () => {
    const queueSend = vi.fn(async () => undefined);
    const req = makeRequest("/webhooks/hotmart", {
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
});
