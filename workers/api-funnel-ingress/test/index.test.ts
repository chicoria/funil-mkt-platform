import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

function makeEnv(overrides: Record<string, unknown> = {}): any {
  return {
    FUNNEL_EVENTS: { send: vi.fn(async () => undefined) },
    APP_EVENTS_HMAC: "",
    ...overrides,
  };
}

describe("api-funnel-ingress", () => {
  it("retorna health", async () => {
    const res = await worker.fetch(new Request("https://x/health", { method: "GET" }), makeEnv());
    expect(res.status).toBe(200);
  });

  it("enfileira precheckout", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://x/funnel/precheckout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_type: "generate_lead", email: "lead@example.com", product_code: "DECOLE_PLANOVOO" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    const firstCall = send.mock.calls[0] as unknown[] | undefined;
    const evt = (firstCall?.[0] ?? {}) as { event_type?: string; product_code?: string };
    expect(evt.event_type).toBe("GENERATE_LEAD");
    expect(evt.product_code).toBe("DECOLE_PLANOVOO");
  });

  it("valida assinatura no app ingress", async () => {
    const req = new Request("https://x/webhooks/v1/planovoo/app/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_type: "app_plano_view" }),
    });

    const res = await worker.fetch(req, makeEnv({ APP_EVENTS_HMAC: "abc" }));
    expect(res.status).toBe(401);
  });
});
