import { describe, expect, it, vi } from "vitest";
import worker from "../../src/index";

function makeEnv(overrides: Record<string, unknown> = {}): any {
  return {
    FUNNEL_EVENTS: { send: vi.fn(async () => undefined) },
    APP_EVENTS_HMAC: "",
    ALLOWED_ORIGINS: "https://decolesuacarreiraesg.com.br",
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
      headers: { "content-type": "application/json", origin: "https://decolesuacarreiraesg.com.br" },
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

  it("retorna preflight para origem permitida", async () => {
    const req = new Request("https://x/funnel/precheckout", {
      method: "OPTIONS",
      headers: { origin: "https://decolesuacarreiraesg.com.br" },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://decolesuacarreiraesg.com.br");
  });

  it("bloqueia origem nao permitida nos endpoints /funnel", async () => {
    const req = new Request("https://x/funnel/event", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ event_type: "page_view", product_code: "DECOLE_PLANOVOO" }),
    });

    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
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

  it("captura CF-Connecting-IP e inclui client_ip na attribution", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://x/funnel/precheckout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://decolesuacarreiraesg.com.br",
        "cf-connecting-ip": "1.2.3.4",
      },
      body: JSON.stringify({ email: "lead@example.com", product_code: "DECOLE_ESG_MENTORIA" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = send.mock.calls[0]?.[0] as { attribution?: { client_ip?: string } };
    expect(evt?.attribution?.client_ip).toBe("1.2.3.4");
  });

  it("usa x-forwarded-for como fallback quando CF-Connecting-IP ausente", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://x/funnel/precheckout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://decolesuacarreiraesg.com.br",
        "x-forwarded-for": "5.6.7.8, 10.0.0.1",
      },
      body: JSON.stringify({ email: "lead@example.com", product_code: "DECOLE_ESG_MENTORIA" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = send.mock.calls[0]?.[0] as { attribution?: { client_ip?: string } };
    expect(evt?.attribution?.client_ip).toBe("5.6.7.8");
  });

  it("popula tenant_id em /funnel/precheckout por hostname conhecido", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://api.decolesuacarreiraesg.com.br/funnel/precheckout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "lead@example.com", product_code: "DECOLE_PLANOVOO" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = send.mock.calls[0]?.[0] as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });

  it("popula tenant_id em /funnel/event", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://decolesuacarreiraesg.com.br/funnel/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "PAGE_VIEW", product_code: "DECOLE_PLANOVOO" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = send.mock.calls[0]?.[0] as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });

  it("popula tenant_id em /webhooks/v1/planovoo/app/event", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://api.decolesuacarreiraesg.com.br/webhooks/v1/planovoo/app/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "PLAN_READY", email: "x@y.com" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = send.mock.calls[0]?.[0] as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });

  it("hostname tem prioridade sobre tenant_id do payload", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://api.decolesuacarreiraesg.com.br/funnel/precheckout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@y.com", product_code: "DECOLE_PLANOVOO", tenant_id: "superare" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = send.mock.calls[0]?.[0] as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });

  it("usa tenant_id do payload quando hostname desconhecido", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://preview.pages.dev/funnel/precheckout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@y.com", product_code: "DECOLE_PLANOVOO", tenant_id: "decole" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send }, ALLOWED_ORIGINS: "" }));
    expect(res.status).toBe(202);
    const evt = send.mock.calls[0]?.[0] as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });

  it("ignora payload.tenant_id desconhecido e cai no DEFAULT_TENANT_ID", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://preview.pages.dev/funnel/precheckout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@y.com", product_code: "DECOLE_PLANOVOO", tenant_id: "evil-tenant" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send }, ALLOWED_ORIGINS: "", DEFAULT_TENANT_ID: "decole" }));
    expect(res.status).toBe(202);
    const evt = send.mock.calls[0]?.[0] as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });

  it("hostname tem prioridade sobre payload em /funnel/event também", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://api.decolesuacarreiraesg.com.br/funnel/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "PAGE_VIEW", product_code: "DECOLE_PLANOVOO", tenant_id: "superare" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = send.mock.calls[0]?.[0] as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });
});
