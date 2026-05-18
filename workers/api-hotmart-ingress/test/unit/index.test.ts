import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { clearSecretCache } from "../../../../packages/shared/src/secrets-store-wrapper";

const TEST_CATALOG = JSON.stringify({
  schemaVersion: 5,
  tenants: {
    decole: {
      domains: ["api.decolesuacarreiraesg.com.br"],
      credentials: { hotmart_token_env: "HOTMART_WEBHOOK_TOKEN_DECOLE" },
      products: {
        DECOLE_ESG_MENTORIA: {
          hotmart: { urlSlugs: ["decole-esg"] },
        },
        DECOLE_PLANOVOO: {
          hotmart: { urlSlugs: ["planovoo", "plano-de-voo"] },
        },
      },
    },
    superare: {
      domains: ["api.superare.test"],
      credentials: { hotmart_token_env: "HOTMART_WEBHOOK_TOKEN_SUPERARE" },
      products: {
        SUPERARE_CURSO_X: {
          hotmart: { urlSlugs: ["superare-x"] },
        },
      },
    },
  },
});

const DECOLE_HOST = "api.decolesuacarreiraesg.com.br";
const DECOLE_TOKEN = "decole-token";
const SUPERARE_TOKEN = "superare-token";

function makeEnv(overrides: Record<string, unknown> = {}): any {
  return {
    FUNNEL_EVENTS: { send: vi.fn(async () => undefined) },
    CATALOG_JSON: TEST_CATALOG,
    HOTMART_WEBHOOK_TOKEN_DECOLE: DECOLE_TOKEN,
    HOTMART_WEBHOOK_TOKEN_SUPERARE: SUPERARE_TOKEN,
    ...overrides,
  };
}

function hotmartHeaders(token = DECOLE_TOKEN): HeadersInit {
  return { "content-type": "application/json", "x-hotmart-hottok": token };
}

async function responseJson(res: Response): Promise<{ error?: string }> {
  return (await res.json()) as { error?: string };
}

describe("api-hotmart-ingress", () => {
  afterEach(() => {
    clearSecretCache();
    vi.clearAllMocks();
  });

  it("retorna health", async () => {
    const res = await worker.fetch(new Request("https://x/health", { method: "GET" }), makeEnv());
    expect(res.status).toBe(200);
  });

  it("enfileira evento normalizado", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/decole-esg/hotmart/purchase-approved`, {
      method: "POST",
      headers: hotmartHeaders(),
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
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/decole-esg/hotmart/purchase`, {
      method: "POST",
      headers: hotmartHeaders(),
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
      const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/planovoo/hotmart/purchase`, {
        method: "POST",
        headers: hotmartHeaders(),
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
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/planovoo/hotmart/purchase`, {
      method: "POST",
      headers: hotmartHeaders(),
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

  it("bloqueia request sem token por tenant", async () => {
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/decole-esg/hotmart/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it("popula tenant_id por hostname conhecido (decole)", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/planovoo/hotmart/purchase`, {
      method: "POST",
      headers: hotmartHeaders(),
      body: JSON.stringify({ id: "evt-tenant-1", event: "PURCHASE_APPROVED", data: { buyer: { email: "x@y.com" } } }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(202);
    const firstCall = send.mock.calls[0] as unknown[] | undefined;
    const payload = (firstCall?.[0] ?? {}) as { tenant_id?: string; product_code?: string };
    expect(payload.tenant_id).toBe("decole");
  });

  it("retorna 400 quando hostname nao resolve tenant, mesmo com DEFAULT_TENANT_ID", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://preview.workers.dev/webhooks/v1/planovoo/hotmart/purchase", {
      method: "POST",
      headers: hotmartHeaders(),
      body: JSON.stringify({ id: "evt-tenant-2", event: "PURCHASE_APPROVED", data: { buyer: { email: "x@y.com" } } }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send }, DEFAULT_TENANT_ID: "decole" }));
    expect(res.status).toBe(400);
    expect(await responseJson(res)).toMatchObject({ error: "unknown_tenant" });
    expect(send).not.toHaveBeenCalled();
  });

  it("retorna 404 quando slug pertence a outro tenant", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request("https://api.superare.test/webhooks/v1/decole-esg/hotmart/purchase", {
      method: "POST",
      headers: hotmartHeaders(SUPERARE_TOKEN),
      body: JSON.stringify({ id: "evt-cross-tenant-1", event: "PURCHASE_APPROVED", data: { buyer: { email: "x@y.com" } } }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(404);
    expect(await responseJson(res)).toMatchObject({ error: "unknown_product_slug" });
    expect(send).not.toHaveBeenCalled();
  });

  it("nao autentica com HOTMART_WEBHOOK_TOKEN legado", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/decole-esg/hotmart/purchase`, {
      method: "POST",
      headers: hotmartHeaders("legacy-token"),
      body: JSON.stringify({ id: "evt-legacy-token-1", event: "PURCHASE_APPROVED", data: { buyer: { email: "x@y.com" } } }),
    });

    const res = await worker.fetch(
      req,
      makeEnv({ FUNNEL_EVENTS: { send }, HOTMART_WEBHOOK_TOKEN: "legacy-token", HOTMART_WEBHOOK_TOKEN_DECOLE: DECOLE_TOKEN })
    );
    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("aceita token por tenant via Secrets Store binding", async () => {
    const send = vi.fn(async () => undefined);
    const get = vi.fn(async () => DECOLE_TOKEN);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/decole-esg/hotmart/purchase`, {
      method: "POST",
      headers: hotmartHeaders(),
      body: JSON.stringify({ id: "evt-binding-token-1", event: "PURCHASE_APPROVED", data: { buyer: { email: "x@y.com" } } }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send }, HOTMART_WEBHOOK_TOKEN_DECOLE: { get } }));
    expect(res.status).toBe(202);
    expect(get).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("nao autentica tenant resolvido com token de outro tenant", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/decole-esg/hotmart/purchase`, {
      method: "POST",
      headers: hotmartHeaders(SUPERARE_TOKEN),
      body: JSON.stringify({ id: "evt-wrong-token-1", event: "PURCHASE_APPROVED", data: { buyer: { email: "x@y.com" } } }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send } }));
    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("retorna 500 quando secret do tenant esta ausente", async () => {
    const send = vi.fn(async () => undefined);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/decole-esg/hotmart/purchase`, {
      method: "POST",
      headers: hotmartHeaders(),
      body: JSON.stringify({ id: "evt-missing-secret-1", event: "PURCHASE_APPROVED", data: { buyer: { email: "x@y.com" } } }),
    });

    const res = await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send }, HOTMART_WEBHOOK_TOKEN_DECOLE: undefined }));
    expect(res.status).toBe(500);
    expect(await responseJson(res)).toMatchObject({ error: "secret_misconfigured" });
    expect(send).not.toHaveBeenCalled();
  });
});
