import { describe, expect, it, vi } from "vitest";
import { callProductApi, type ProductApiConfig } from "../../src/handlers/call-product-api";
import { HandlerContext } from "../../src/handler-context";
import type { FunnelEvent } from "../../../../packages/shared/src/funnel-event";
import type { DispatcherEnv } from "../../src/dispatcher";
import type { ResolvedCredentials } from "../../src/tenant-resolver";

type FetchMock = typeof fetch & {
  mock: { calls: Array<[RequestInfo | URL, RequestInit?]> };
};

function getFetchCall(fetchMock: FetchMock, index: number): [string, RequestInit] {
  const call = fetchMock.mock.calls[index];
  expect(call).toBeDefined();
  const [input, init] = call as [RequestInfo | URL, RequestInit?];
  expect(init).toBeDefined();
  return [String(input), init as RequestInit];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<FunnelEvent> = {}): FunnelEvent {
  return {
    event_id: "evt-1",
    event_type: "PURCHASE_APPROVED",
    product_code: "PLANOVOO",
    source: "hotmart",
    occurred_at: new Date().toISOString(),
    lead: { email: "buyer@example.com" },
    payload: {
      data: {
        buyer: { email: "buyer@example.com", name: "Maria Silva" },
        purchase: {
          transaction: "TRX-100",
          price: { value: 197 },
          payment: { type: "CREDIT_CARD" },
        },
        product: { name: "Plano de Voo" },
      },
    },
    ...overrides,
  };
}

function makeCtx(
  overrides: {
    event?: Partial<FunnelEvent>;
    envOverrides?: Record<string, unknown>;
  } = {}
): HandlerContext {
  const env = {
    PLANOVOO_HOOK_SECRET: "test-secret",
    ...overrides.envOverrides,
  } as unknown as DispatcherEnv;

  const creds: ResolvedCredentials = {
    brevoApiKey: "xkeysib-test",
    hotmartToken: "hotmart-test",
    replyToEmail: "contato@test.com",
  };

  return new HandlerContext(makeEvent(overrides.event), env, "decole", creds);
}

const purchaseApiConfig: ProductApiConfig = {
  url: "https://app.decole.test/api/hooks/purchase",
  method: "POST",
  hmac_secret_env: "PLANOVOO_HOOK_SECRET",
  request_mapping: {
    email: "$.data.buyer.email",
    nome: "$.data.buyer.name",
    transacao: "$.data.purchase.transaction",
    produto: "$.data.product.name",
    valor: "$.data.purchase.price.value",
    pagamento: "$.data.purchase.payment.type",
  },
  response_key: "token",
};

const purchaseApiConfigWithFallbacks: ProductApiConfig = {
  ...purchaseApiConfig,
  request_mapping: {
    email: "$.data.buyer.email ?? $.buyer.email ?? $.lead.email",
    nome: "$.data.buyer.name ?? $.buyer.name",
    transacao: "$.data.purchase.transaction ?? $.purchase.transaction",
    produto: "$.data.product.name ?? $.product.name ?? $.product_code",
    valor: "$.data.purchase.price.value ?? $.purchase.price.value",
    pagamento: "$.data.purchase.payment.type ?? $.purchase.payment.type",
  },
  skip_if_missing: ["email"],
};

const refundApiConfig: ProductApiConfig = {
  url: "https://app.decole.test/api/hooks/refund",
  method: "POST",
  hmac_secret_env: "PLANOVOO_HOOK_SECRET",
  request_mapping: {
    transacao: "$.data.purchase.transaction",
  },
};

function mockFetch(body: Record<string, unknown>, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  ) as unknown as FetchMock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("callProductApi", () => {
  it("calls the configured URL with mapped payload and HMAC", async () => {
    const fetchMock = mockFetch({ token: "new-token-uuid" });
    const ctx = makeCtx();

    await callProductApi(ctx, purchaseApiConfig, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = getFetchCall(fetchMock, 0);
    expect(url).toBe("https://app.decole.test/api/hooks/purchase");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");

    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      email: "buyer@example.com",
      nome: "Maria Silva",
      transacao: "TRX-100",
      produto: "Plano de Voo",
      valor: 197,
      pagamento: "CREDIT_CARD",
    });
  });

  it("stores full API response in HandlerContext as api_response", async () => {
    const fetchMock = mockFetch({ token: "abc", updated: 1 });
    const ctx = makeCtx();

    await callProductApi(ctx, purchaseApiConfig, fetchMock);

    expect(ctx.get("api_response")).toEqual({ token: "abc", updated: 1 });
  });

  it("extracts response_key value and stores it separately", async () => {
    const fetchMock = mockFetch({ token: "extracted-token" });
    const ctx = makeCtx();

    await callProductApi(ctx, purchaseApiConfig, fetchMock);

    expect(ctx.get("api_response_key")).toBe("extracted-token");
  });

  it("does not store response_key when not configured", async () => {
    const fetchMock = mockFetch({ updated: 1 });
    const ctx = makeCtx();

    await callProductApi(ctx, refundApiConfig, fetchMock);

    expect(ctx.get("api_response")).toEqual({ updated: 1 });
    expect(ctx.get("api_response_key")).toBeUndefined();
  });

  it("throws when API returns 4xx (fatal for queue retry)", async () => {
    const fetchMock = mockFetch({ error: "bad request" }, 400);
    const ctx = makeCtx();

    await expect(
      callProductApi(ctx, purchaseApiConfig, fetchMock)
    ).rejects.toThrow(/product API error: 400/i);
  });

  it("throws when API returns 5xx (fatal for queue retry)", async () => {
    const fetchMock = mockFetch({ error: "internal" }, 500);
    const ctx = makeCtx();

    await expect(
      callProductApi(ctx, purchaseApiConfig, fetchMock)
    ).rejects.toThrow(/product API error: 500/i);
  });

  it("throws when HMAC secret env var is missing", async () => {
    const fetchMock = mockFetch({});
    const ctx = makeCtx({ envOverrides: { PLANOVOO_HOOK_SECRET: undefined } });

    await expect(
      callProductApi(ctx, purchaseApiConfig, fetchMock)
    ).rejects.toThrow(/PLANOVOO_HOOK_SECRET/);
  });

  it("maps only non-null fields to request body", async () => {
    const fetchMock = mockFetch({ token: "t" });
    const ctx = makeCtx({
      event: {
        payload: {
          data: {
            buyer: { email: "a@b.com" },
            purchase: {},
            product: {},
          },
        },
      },
    });

    await callProductApi(ctx, purchaseApiConfig, fetchMock);

    const [, init] = getFetchCall(fetchMock, 0);
    const body = JSON.parse(String(init.body));
    expect(body.email).toBe("a@b.com");
    expect(body).not.toHaveProperty("transacao");
    expect(body).not.toHaveProperty("valor");
  });

  it("supports flat Hotmart payload mappings", async () => {
    const fetchMock = mockFetch({ token: "t" });
    const ctx = makeCtx({
      event: {
        payload: {
          buyer: { email: "flat@example.com", name: "Flat User" },
          purchase: { transaction: "TRX-FLAT", price: { value: 99 }, payment: { type: "PIX" } },
          product: { name: "Flat Product" },
        },
      },
    });

    await callProductApi(ctx, purchaseApiConfigWithFallbacks, fetchMock);

    const [, init] = getFetchCall(fetchMock, 0);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      email: "flat@example.com",
      nome: "Flat User",
      transacao: "TRX-FLAT",
      produto: "Flat Product",
      valor: 99,
      pagamento: "PIX",
    });
  });

  it("falls back to event.lead.email for generic mappings", async () => {
    const fetchMock = mockFetch({ token: "t" });
    const ctx = makeCtx({
      event: {
        lead: { email: "lead@example.com" },
        payload: {
          data: {
            buyer: { name: "Lead User" },
            purchase: { transaction: "TRX-LEAD" },
            product: { name: "Plano de Voo" },
          },
        },
      },
    });

    await callProductApi(ctx, purchaseApiConfigWithFallbacks, fetchMock);

    const [, init] = getFetchCall(fetchMock, 0);
    const body = JSON.parse(String(init.body));
    expect(body.email).toBe("lead@example.com");
  });

  it("skips API call when configured required mapped field is missing", async () => {
    const fetchMock = mockFetch({ token: "t" });
    const ctx = makeCtx({
      event: {
        lead: undefined,
        payload: { data: { buyer: {}, purchase: {}, product: {} } },
      },
    });

    await callProductApi(ctx, purchaseApiConfigWithFallbacks, fetchMock);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.get("api_response")).toBeUndefined();
  });

  it("preserves URL as configured (no trailing slash stripping)", async () => {
    const fetchMock = mockFetch({ token: "t" });
    const ctx = makeCtx();
    const config = { ...purchaseApiConfig, url: "https://app.decole.test/" };

    await callProductApi(ctx, config, fetchMock);

    const [url] = getFetchCall(fetchMock, 0);
    expect(url).toBe("https://app.decole.test/");
  });

  it("builds URL from configured env var and path", async () => {
    const fetchMock = mockFetch({ token: "t" });
    const ctx = makeCtx({
      envOverrides: {
        PLANOVOO_API_BASE_URL: "https://staging.planovoo.test/",
      },
    });
    const config: ProductApiConfig = {
      ...purchaseApiConfig,
      url: undefined,
      url_env: "PLANOVOO_API_BASE_URL",
      path: "/api/hooks/purchase",
    };

    await callProductApi(ctx, config, fetchMock);

    const [url] = getFetchCall(fetchMock, 0);
    expect(url).toBe("https://staging.planovoo.test/api/hooks/purchase");
  });

  it("throws when neither URL nor configured URL env var is available", async () => {
    const fetchMock = mockFetch({ token: "t" });
    const ctx = makeCtx();
    const config: ProductApiConfig = {
      ...purchaseApiConfig,
      url: undefined,
      url_env: "PLANOVOO_API_BASE_URL",
      path: "/api/hooks/purchase",
    };

    await expect(callProductApi(ctx, config, fetchMock)).rejects.toThrow(/PLANOVOO_API_BASE_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on network failure (fatal for queue retry)", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as FetchMock;
    const ctx = makeCtx();

    await expect(
      callProductApi(ctx, purchaseApiConfig, fetchMock)
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it("does not set api_response_key when response_key field is absent from response", async () => {
    const fetchMock = mockFetch({ other: "value" });
    const ctx = makeCtx();

    await callProductApi(ctx, purchaseApiConfig, fetchMock);

    expect(ctx.get("api_response")).toEqual({ other: "value" });
    expect(ctx.get("api_response_key")).toBeUndefined();
  });
});
