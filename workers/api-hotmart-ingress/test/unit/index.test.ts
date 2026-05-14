import { describe, expect, it, vi } from "vitest";
import worker from "../../src/index";

function makeEnv(overrides: Record<string, unknown> = {}): any {
  return {
    FUNNEL_EVENTS: { send: vi.fn(async () => undefined) },
    HOTMART_WEBHOOK_TOKEN: "",
    ...overrides,
  };
}

describe("api-hotmart-ingress", () => {
  it("retorna health", async () => {
    const res = await worker.fetch(new Request("https://x/health", { method: "GET" }), makeEnv());
    expect(res.status).toBe(200);
  });

  it("enfileira evento normalizado", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://x/webhooks/v1/decole-esg/hotmart/purchase-approved", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt-1", buyer: { email: "lead@example.com" } }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    const firstCall = send.mock.calls[0] as unknown[] | undefined;
    const payload = (firstCall?.[0] ?? {}) as { event_type?: string; product_code?: string };
    expect(payload.event_type).toBe("PURCHASE_APPROVED");
    expect(payload.product_code).toBe("DECOLE_ESG_MENTORIA");
  });

  it("preserva PURCHASE_COMPLETE como evento proprio", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://x/webhooks/v1/decole-esg/hotmart/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt-2", event: "PURCHASE_COMPLETE", data: { buyer: { email: "lead@example.com" } } }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    const firstCall = send.mock.calls[0] as unknown[] | undefined;
    const payload = (firstCall?.[0] ?? {}) as { event_type?: string; product_code?: string };
    expect(payload.event_type).toBe("PURCHASE_COMPLETE");
    expect(payload.product_code).toBe("DECOLE_ESG_MENTORIA");
  });

  it("preserva eventos Hotmart de lifecycle de compra", async () => {
    const events = [
      "PURCHASE_CANCELED",
      "PURCHASE_COMPLETE",
      "PURCHASE_BILLET_PRINTED",
      "PURCHASE_APPROVED",
      "PURCHASE_PROTEST",
      "PURCHASE_REFUNDED",
      "PURCHASE_CHARGEBACK",
      "PURCHASE_EXPIRED",
      "PURCHASE_DELAYED",
    ];

    for (const eventName of events) {
      const send = vi.fn(async () => undefined);
      const req = new Request("https://x/webhooks/v1/planovoo/hotmart/purchase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: `evt-${eventName.toLowerCase()}`,
          event: eventName,
          data: {
            buyer: { email: "lead@example.com" },
            purchase: { transaction: `HP-${eventName}` },
          },
        }),
      });

      const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
      expect(res.status).toBe(202);
      const firstCall = send.mock.calls[0] as unknown[] | undefined;
      const payload = (firstCall?.[0] ?? {}) as { event_type?: string; product_code?: string };
      expect(payload.event_type).toBe(eventName);
      expect(payload.product_code).toBe("DECOLE_PLANOVOO");
    }
  });

  it("mapeia slug planovoo para o produto canonico", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://x/webhooks/v1/planovoo/hotmart/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt-planovoo-1", event: "PURCHASE_COMPLETE", data: { buyer: { email: "lead@example.com" } } }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    const firstCall = send.mock.calls[0] as unknown[] | undefined;
    const payload = (firstCall?.[0] ?? {}) as { event_type?: string; product_code?: string };
    expect(payload.event_type).toBe("PURCHASE_COMPLETE");
    expect(payload.product_code).toBe("DECOLE_PLANOVOO");
  });

  it("valida token quando configurado", async () => {
    const req = new Request("https://x/webhooks/v1/decole-esg/hotmart/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    const res = await worker.fetch(req, makeEnv({ HOTMART_WEBHOOK_TOKEN: "secret" }));
    expect(res.status).toBe(401);
  });

  it("popula tenant_id por hostname conhecido (decole)", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://api.decolesuacarreiraesg.com.br/webhooks/v1/planovoo/hotmart/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt-tenant-1", event: "PURCHASE_APPROVED", data: { buyer: { email: "x@y.com" } } }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const firstCall = send.mock.calls[0] as unknown[] | undefined;
    const payload = (firstCall?.[0] ?? {}) as { tenant_id?: string; product_code?: string };
    expect(payload.tenant_id).toBe("decole");
  });

  it("aplica fallback DEFAULT_TENANT_ID para hostname desconhecido", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://preview.workers.dev/webhooks/v1/planovoo/hotmart/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt-tenant-2", event: "PURCHASE_APPROVED", data: { buyer: { email: "x@y.com" } } }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send }, DEFAULT_TENANT_ID: "decole" }));
    expect(res.status).toBe(202);
    const firstCall = send.mock.calls[0] as unknown[] | undefined;
    const payload = (firstCall?.[0] ?? {}) as { tenant_id?: string };
    expect(payload.tenant_id).toBe("decole");
  });

  it("usa fallback 'decole' quando DEFAULT_TENANT_ID e hostname desconhecidos", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://preview.workers.dev/webhooks/v1/planovoo/hotmart/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "evt-tenant-3", event: "PURCHASE_APPROVED", data: { buyer: { email: "x@y.com" } } }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const firstCall = send.mock.calls[0] as unknown[] | undefined;
    const payload = (firstCall?.[0] ?? {}) as { tenant_id?: string };
    expect(payload.tenant_id).toBe("decole");
  });
});
