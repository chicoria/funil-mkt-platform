import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { clearSecretCache } from "../../../../packages/shared/src/secrets-store-wrapper";

const TEST_CATALOG = JSON.stringify({
  schemaVersion: 5,
  tenants: {
    decole: {
      domains: ["api.decolesuacarreiraesg.com.br"],
      allowedOrigins: ["https://decolesuacarreiraesg.com.br"],
      integrations: {
        planovoo: {
          hookSecretEnv: "PLANOVOO_HOOK_SECRET_DECOLE",
          appWebhooks: [
            {
              path: "/webhooks/v1/planovoo/app/event",
              productCode: "DECOLE_PLANOVOO",
              requiresHmac: true,
            },
          ],
        },
      },
    },
    superare: {
      domains: ["api.superare.test"],
      allowedOrigins: ["https://app.superare.test"],
      integrations: {
        superapp: {
          appWebhooks: [
            {
              path: "/webhooks/v1/superare/app/event",
              productCode: "SUPERARE_CURSO_X",
              requiresHmac: false,
            },
          ],
        },
      },
    },
  },
});

const DECOLE_HOST = "api.decolesuacarreiraesg.com.br";
const DECOLE_ORIGIN = "https://decolesuacarreiraesg.com.br";
const SUPERARE_HOST = "api.superare.test";
const SUPERARE_ORIGIN = "https://app.superare.test";
const PLANOVOO_HOOK_SECRET = "hook-secret";

function makeEnv(overrides: Record<string, unknown> = {}): any {
  return {
    FUNNEL_EVENTS: { send: vi.fn(async () => undefined) },
    CATALOG_JSON: TEST_CATALOG,
    PLANOVOO_HOOK_SECRET_DECOLE: PLANOVOO_HOOK_SECRET,
    ...overrides,
  };
}

describe("api-funnel-ingress", () => {
  afterEach(() => {
    clearSecretCache();
    vi.clearAllMocks();
  });

  it("retorna health", async () => {
    const res = await worker.fetch(new Request("https://x/health", { method: "GET" }), makeEnv());
    expect(res.status).toBe(200);
  });

  it("enfileira precheckout", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/funnel/precheckout`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: DECOLE_ORIGIN },
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
    const req = new Request(`https://${DECOLE_HOST}/funnel/precheckout`, {
      method: "OPTIONS",
      headers: { origin: DECOLE_ORIGIN },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(DECOLE_ORIGIN);
  });

  it("bloqueia origem de outro tenant nos endpoints /funnel", async () => {
    const req = new Request(`https://${SUPERARE_HOST}/funnel/event`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: DECOLE_ORIGIN },
      body: JSON.stringify({ event_type: "page_view", product_code: "SUPERARE_CURSO_X" }),
    });

    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("valida assinatura no app webhook declarado no catalogo", async () => {
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/planovoo/app/event`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-signature": "wrong" },
      body: JSON.stringify({ event_type: "app_plano_view" }),
    });

    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it("captura CF-Connecting-IP e inclui client_ip na attribution", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/funnel/precheckout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: DECOLE_ORIGIN,
        "cf-connecting-ip": "1.2.3.4",
      },
      body: JSON.stringify({ email: "lead@example.com", product_code: "DECOLE_ESG_MENTORIA" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = ((send.mock.calls as unknown[][])[0]?.[0] as unknown) as { attribution?: { client_ip?: string } };
    expect(evt?.attribution?.client_ip).toBe("1.2.3.4");
  });

  it("usa x-forwarded-for como fallback quando CF-Connecting-IP ausente", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/funnel/precheckout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: DECOLE_ORIGIN,
        "x-forwarded-for": "5.6.7.8, 10.0.0.1",
      },
      body: JSON.stringify({ email: "lead@example.com", product_code: "DECOLE_ESG_MENTORIA" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = ((send.mock.calls as unknown[][])[0]?.[0] as unknown) as { attribution?: { client_ip?: string } };
    expect(evt?.attribution?.client_ip).toBe("5.6.7.8");
  });

  it("popula tenant_id em /funnel/precheckout por hostname conhecido", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/funnel/precheckout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "lead@example.com", product_code: "DECOLE_PLANOVOO" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = ((send.mock.calls as unknown[][])[0]?.[0] as unknown) as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });

  it("popula tenant_id em /funnel/event", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/funnel/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "PAGE_VIEW", product_code: "DECOLE_PLANOVOO" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = ((send.mock.calls as unknown[][])[0]?.[0] as unknown) as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });

  it("popula tenant_id em app webhook declarado no catalogo", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/planovoo/app/event`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-signature": PLANOVOO_HOOK_SECRET },
      body: JSON.stringify({ event: "PLAN_READY", email: "x@y.com" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = ((send.mock.calls as unknown[][])[0]?.[0] as unknown) as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });

  it("hostname tem prioridade sobre tenant_id do payload", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/funnel/precheckout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@y.com", product_code: "DECOLE_PLANOVOO", tenant_id: "superare" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = ((send.mock.calls as unknown[][])[0]?.[0] as unknown) as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });

  it("usa tenant_id do payload quando hostname desconhecido", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://preview.pages.dev/funnel/precheckout", {
      method: "POST",
      headers: { "content-type": "application/json", origin: DECOLE_ORIGIN },
      body: JSON.stringify({ email: "x@y.com", product_code: "DECOLE_PLANOVOO", tenant_id: "decole" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = ((send.mock.calls as unknown[][])[0]?.[0] as unknown) as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });

  it("retorna 400 quando nenhum metodo resolve tenant", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://preview.pages.dev/funnel/precheckout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@y.com", product_code: "DECOLE_PLANOVOO", tenant_id: "evil-tenant" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send }, DEFAULT_TENANT_ID: "decole" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unknown_tenant" });
    expect(send).not.toHaveBeenCalled();
  });

  it("hostname tem prioridade sobre payload em /funnel/event também", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/funnel/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "PAGE_VIEW", product_code: "DECOLE_PLANOVOO", tenant_id: "superare" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = ((send.mock.calls as unknown[][])[0]?.[0] as unknown) as { tenant_id?: string };
    expect(evt?.tenant_id).toBe("decole");
  });

  it("usa app webhook de outro tenant via catalogo sem rota hardcoded", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${SUPERARE_HOST}/webhooks/v1/superare/app/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "SUPERARE_READY", email: "x@y.com" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const evt = ((send.mock.calls as unknown[][])[0]?.[0] as unknown) as { tenant_id?: string; product_code?: string };
    expect(evt?.tenant_id).toBe("superare");
    expect(evt?.product_code).toBe("SUPERARE_CURSO_X");
  });

  it("retorna 404 para app webhook ausente do catalogo", async () => {
    const send = vi.fn(async () => undefined);
    const catalogWithoutAppWebhook = JSON.stringify({
      schemaVersion: 5,
      tenants: {
        decole: {
          domains: [DECOLE_HOST],
          allowedOrigins: [DECOLE_ORIGIN],
          integrations: {},
        },
      },
    });
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/planovoo/app/event`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-signature": PLANOVOO_HOOK_SECRET },
      body: JSON.stringify({ event: "PLAN_READY", email: "x@y.com" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send }, CATALOG_JSON: catalogWithoutAppWebhook }));
    expect(res.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("aceita assinatura de app webhook via Secrets Store binding", async () => {
    const send = vi.fn(async () => undefined);
    const get = vi.fn(async () => PLANOVOO_HOOK_SECRET);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/planovoo/app/event`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-signature": PLANOVOO_HOOK_SECRET },
      body: JSON.stringify({ event: "PLAN_READY", email: "x@y.com" }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send }, PLANOVOO_HOOK_SECRET_DECOLE: { get } }));
    expect(res.status).toBe(202);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
