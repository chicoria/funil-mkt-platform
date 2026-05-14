import { describe, expect, it, vi } from "vitest";
import { sendTemplateEmail, type TemplateEmailConfig } from "../../src/handlers/send-template-email";
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
        purchase: { transaction: "TRX-100", price: { value: 197 } },
        product: { name: "Plano de Voo" },
      },
    },
    ...overrides,
  };
}

function makeCtx(
  overrides: {
    event?: Partial<FunnelEvent>;
    creds?: Partial<ResolvedCredentials>;
    ctxData?: Record<string, unknown>;
  } = {}
): HandlerContext {
  const env = {} as unknown as DispatcherEnv;
  const creds: ResolvedCredentials = {
    brevoApiKey: "xkeysib-test",
    hotmartToken: "hotmart-test",
    replyToEmail: "contato@decole.com.br",
    ...overrides.creds,
  };

  const ctx = new HandlerContext(makeEvent(overrides.event), env, "decole", creds);
  if (overrides.ctxData) {
    for (const [k, v] of Object.entries(overrides.ctxData)) {
      ctx.set(k, v);
    }
  }
  return ctx;
}

const purchaseEmailConfig: TemplateEmailConfig = {
  templateId: 12,
  to_email: "$.data.buyer.email",
  params_mapping: {
    primeiroNome: "$.data.buyer.name | first_name",
    produto: "$.data.product.name",
    formUrl: "https://app.decole.com/formulario/{{response.token}}",
    transacao: "$.data.purchase.transaction",
  },
};

const refundEmailConfig: TemplateEmailConfig = {
  templateId: 13,
  to_email: "$.data.buyer.email",
  params_mapping: {
    primeiroNome: "$.data.buyer.name | first_name",
    produto: "$.data.product.name",
    transacao: "$.data.purchase.transaction",
  },
};

function mockFetch(status = 201) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ messageId: "msg-1" }), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sendTemplateEmail", () => {
  it("sends email via Brevo with mapped params", async () => {
    const fetchMock = mockFetch();
    const ctx = makeCtx();

    await sendTemplateEmail(ctx, refundEmailConfig, fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body);
    expect(body.templateId).toBe(13);
    expect(body.to).toEqual([{ email: "buyer@example.com" }]);
    expect(body.params.primeiroNome).toBe("Maria");
    expect(body.params.produto).toBe("Plano de Voo");
    expect(body.params.transacao).toBe("TRX-100");
  });

  it("interpolates {{response.token}} from HandlerContext api_response", async () => {
    const fetchMock = mockFetch();
    const ctx = makeCtx({
      ctxData: { api_response: { token: "abc-token-123" } },
    });

    await sendTemplateEmail(ctx, purchaseEmailConfig, fetchMock);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params.formUrl).toBe("https://app.decole.com/formulario/abc-token-123");
  });

  it("replaces {{response.X}} with empty string when api_response missing", async () => {
    const fetchMock = mockFetch();
    const ctx = makeCtx(); // no ctxData

    await sendTemplateEmail(ctx, purchaseEmailConfig, fetchMock);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params.formUrl).toBe("https://app.decole.com/formulario/");
  });

  it("includes replyTo from tenant credentials", async () => {
    const fetchMock = mockFetch();
    const ctx = makeCtx();

    await sendTemplateEmail(ctx, refundEmailConfig, fetchMock);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.replyTo).toEqual({ email: "contato@decole.com.br" });
  });

  it("omits replyTo when not set in credentials", async () => {
    const fetchMock = mockFetch();
    const ctx = makeCtx({ creds: { replyToEmail: undefined } });

    await sendTemplateEmail(ctx, refundEmailConfig, fetchMock);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.replyTo).toBeUndefined();
  });

  it("skips when to_email resolves to null", async () => {
    const fetchMock = mockFetch();
    const ctx = makeCtx({
      event: { payload: { data: { buyer: {}, purchase: {}, product: {} } } },
    });

    await sendTemplateEmail(ctx, refundEmailConfig, fetchMock);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when Brevo returns error (fatal for queue retry)", async () => {
    const fetchMock = mockFetch(429);
    const ctx = makeCtx();

    await expect(
      sendTemplateEmail(ctx, refundEmailConfig, fetchMock)
    ).rejects.toThrow(/Brevo.*429/i);
  });

  it("throws when Brevo API key is empty", async () => {
    const fetchMock = mockFetch();
    const ctx = makeCtx({ creds: { brevoApiKey: "" } });

    await expect(
      sendTemplateEmail(ctx, refundEmailConfig, fetchMock)
    ).rejects.toThrow(/brevo.*api.*key/i);
  });

  it("uses tenant Brevo API key in request header", async () => {
    const fetchMock = mockFetch();
    const ctx = makeCtx({ creds: { brevoApiKey: "xkeysib-tenant-specific" } });

    await sendTemplateEmail(ctx, refundEmailConfig, fetchMock);

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["api-key"]).toBe("xkeysib-tenant-specific");
  });

  it("throws on network failure (fatal for queue retry)", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    const ctx = makeCtx();

    await expect(
      sendTemplateEmail(ctx, refundEmailConfig, fetchMock)
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it("handles api_response with missing specific key in interpolation", async () => {
    const fetchMock = mockFetch();
    const ctx = makeCtx({
      ctxData: { api_response: { other: "x" } },
    });

    await sendTemplateEmail(ctx, purchaseEmailConfig, fetchMock);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params.formUrl).toBe("https://app.decole.com/formulario/");
  });
});
