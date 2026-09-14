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
          baseUrlEnv: "PLANOVOO_API_BASE_URL_DECOLE",
          hookSecretEnv: "PLANOVOO_HOOK_SECRET_DECOLE",
          statusSecretEnv: "PROMO_STATUS_SECRET_DECOLE",
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
  },
});

const DECOLE_HOST = "api.decolesuacarreiraesg.com.br";
const DECOLE_ORIGIN = "https://decolesuacarreiraesg.com.br";
const APP_BASE_URL = "https://plano.decolesuacarreiraesg.test";
const STATUS_SECRET = "status-secret-value";

function makeEnv(overrides: Record<string, unknown> = {}): any {
  return {
    FUNNEL_EVENTS: { send: vi.fn(async () => undefined) },
    CATALOG_JSON: TEST_CATALOG,
    PLANOVOO_API_BASE_URL_DECOLE: APP_BASE_URL,
    PROMO_STATUS_SECRET_DECOLE: STATUS_SECRET,
    ...overrides,
  };
}

describe("GET /funnel/promo-status/{code}", () => {
  afterEach(() => {
    clearSecretCache();
    vi.restoreAllMocks();
  });

  it("retorna preflight OPTIONS para origem permitida (CORS reaproveitado, sem lógica nova)", async () => {
    const req = new Request(`https://${DECOLE_HOST}/funnel/promo-status/ESG-PILOTO`, {
      method: "OPTIONS",
      headers: { origin: DECOLE_ORIGIN },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(DECOLE_ORIGIN);
  });

  it("bloqueia origem não permitida (403), nunca chama o app", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const req = new Request(`https://${DECOLE_HOST}/funnel/promo-status/ESG-PILOTO`, {
      method: "GET",
      headers: { origin: "https://outro-site.test" },
    });

    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chama o app com o header do segredo e repassa a resposta { valid: true }", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ valid: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const req = new Request(`https://${DECOLE_HOST}/funnel/promo-status/ESG-PILOTO`, {
      method: "GET",
      headers: { origin: DECOLE_ORIGIN },
    });

    const res = await worker.fetch(req, makeEnv());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ valid: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${APP_BASE_URL}/api/promo/ESG-PILOTO/status`);
    expect((calledInit.headers as Record<string, string>)["x-promo-status-secret"]).toBe(STATUS_SECRET);
  });

  it("repassa { valid: false, reason } do app sem alterar", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ valid: false, reason: "expired" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const req = new Request(`https://${DECOLE_HOST}/funnel/promo-status/ESG-PILOTO`, {
      method: "GET",
      headers: { origin: DECOLE_ORIGIN },
    });

    const res = await worker.fetch(req, makeEnv());
    const body = await res.json();
    expect(body).toEqual({ valid: false, reason: "expired" });
  });

  it("nunca inclui o segredo (x-promo-status-secret) na resposta ao browser", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ valid: true }), { status: 200 })
    );

    const req = new Request(`https://${DECOLE_HOST}/funnel/promo-status/ESG-PILOTO`, {
      method: "GET",
      headers: { origin: DECOLE_ORIGIN },
    });

    const res = await worker.fetch(req, makeEnv());
    expect(res.headers.get("x-promo-status-secret")).toBeNull();
    const bodyText = await res.text();
    expect(bodyText).not.toContain(STATUS_SECRET);
  });

  it("retorna 500 sem chamar o app quando a integração de status não está configurada no catálogo", async () => {
    const catalogSemStatus = JSON.stringify({
      schemaVersion: 5,
      tenants: {
        decole: {
          domains: ["api.decolesuacarreiraesg.com.br"],
          allowedOrigins: ["https://decolesuacarreiraesg.com.br"],
          integrations: {
            planovoo: {
              hookSecretEnv: "PLANOVOO_HOOK_SECRET_DECOLE",
            },
          },
        },
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const req = new Request(`https://${DECOLE_HOST}/funnel/promo-status/ESG-PILOTO`, {
      method: "GET",
      headers: { origin: DECOLE_ORIGIN },
    });

    const res = await worker.fetch(req, makeEnv({ CATALOG_JSON: catalogSemStatus }));
    expect(res.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("retorna 400 quando o tenant não pode ser resolvido pelo hostname", async () => {
    const req = new Request(`https://api.host-desconhecido.test/funnel/promo-status/ESG-PILOTO`, {
      method: "GET",
      headers: { origin: DECOLE_ORIGIN },
    });

    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(400);
  });
});
