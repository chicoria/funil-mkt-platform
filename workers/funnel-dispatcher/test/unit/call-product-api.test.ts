import { describe, expect, it, vi } from "vitest";
import { callProductApi, type ProductApiConfig } from "../../src/handlers/call-product-api";
import { HandlerContext } from "../../src/handler-context";
import type { FunnelEvent } from "../../../../packages/shared/src/funnel-event";
import type { DispatcherEnv } from "../../src/dispatcher";
import type { ResolvedCredentials } from "../../src/tenant-resolver";

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
  );
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
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.decole.test/api/hooks/purchase");
    expect(init.method).toBe("POST");
    expect(init.headers["x-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(init.headers["content-type"]).toBe("application/json");

    const body = JSON.parse(init.body);
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

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.email).toBe("a@b.com");
    expect(body).not.toHaveProperty("transacao");
    expect(body).not.toHaveProperty("valor");
  });

  it("preserves URL as configured (no trailing slash stripping)", async () => {
    const fetchMock = mockFetch({ token: "t" });
    const ctx = makeCtx();
    const config = { ...purchaseApiConfig, url: "https://app.decole.test/" };

    await callProductApi(ctx, config, fetchMock);

    expect(fetchMock.mock.calls[0][0]).toBe("https://app.decole.test/");
  });

  it("throws on network failure (fatal for queue retry)", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
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
