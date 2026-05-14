import { describe, expect, it, vi, beforeEach } from "vitest";
import type { FunnelEvent } from "../../../../packages/shared/src/funnel-event";
import type { DispatcherEnv } from "../../src/dispatcher";
import {
  callPlanoVooPurchase,
  callPlanoVooRefund,
  callPlanoVooProtest,
} from "../../src/handlers/call-plano-voo-api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<FunnelEvent> = {}): FunnelEvent {
  return {
    event_id: "evt-test-1",
    event_type: "PURCHASE_APPROVED",
    product_code: "DECOLE_PLANOVOO",
    source: "hotmart",
    occurred_at: new Date().toISOString(),
    lead: { email: "buyer@example.com" },
    payload: {
      data: {
        buyer: { email: "buyer@example.com", name: "Maria Silva" },
        purchase: {
          transaction: "TRX-100",
          offer_code: "OFFER-A",
          price: { value: 197 },
          payment: { type: "CREDIT_CARD" },
        },
        product: { name: "Decole Plano de Voo" },
      },
    },
    ...overrides,
  };
}

function makeEnv(overrides: Record<string, unknown> = {}): DispatcherEnv {
  return {
    PLANOVOO_API_BASE_URL: "https://app.decole.test",
    PLANOVOO_HOOK_SECRET: "test-secret-key",
    BREVO_API_KEY: "xkeysib-test-key",
    ...overrides,
  } as unknown as DispatcherEnv;
}

/**
 * Creates a fetch mock that tracks all calls and returns different responses
 * for API calls (first call) and email calls (second call).
 */
function mockFetch(apiResponseBody: Record<string, unknown>, apiStatus = 200) {
  let callCount = 0;
  return vi.fn(async (url: string) => {
    callCount++;
    // First call is the Plano de Voo API, subsequent calls are Brevo email
    if (typeof url === "string" && url.includes("brevo.com")) {
      return new Response(JSON.stringify({ messageId: "msg-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(apiResponseBody), {
      status: apiStatus,
      headers: { "content-type": "application/json" },
    });
  });
}

/** Creates a fetch mock that only responds to API calls (no email expected) */
function mockFetchApiOnly(responseBody: Record<string, unknown>, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
}

// ---------------------------------------------------------------------------
// Tests — callPlanoVooPurchase
// ---------------------------------------------------------------------------

describe("callPlanoVooPurchase", () => {
  it("calls POST /api/hooks/purchase with extracted payload and HMAC", async () => {
    const fetchMock = mockFetch({ token: "new-token-uuid" });
    const event = makeEvent();
    const env = makeEnv();

    await callPlanoVooPurchase(event, env, fetchMock);

    // First call is API, second is Brevo email
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.decole.test/api/hooks/purchase");
    expect(init.method).toBe("POST");
    expect(init.headers["x-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);

    const body = JSON.parse(init.body);
    expect(body).toEqual({
      email: "buyer@example.com",
      nome: "Maria Silva",
      transacao: "TRX-100",
      produto: "Decole Plano de Voo",
      oferta: "OFFER-A",
      valor: 197,
      pagamento: "CREDIT_CARD",
    });
  });

  it("sends purchase link email via Brevo with correct template params", async () => {
    const fetchMock = mockFetch({ token: "abc-token" });
    const event = makeEvent();
    const env = makeEnv();

    await callPlanoVooPurchase(event, env, fetchMock);

    // Second call is the Brevo email
    const [emailUrl, emailInit] = fetchMock.mock.calls[1];
    expect(emailUrl).toBe("https://api.brevo.com/v3/smtp/email");
    expect(emailInit.method).toBe("POST");

    const emailBody = JSON.parse(emailInit.body);
    expect(emailBody.to).toEqual([{ email: "buyer@example.com" }]);
    expect(emailBody.templateId).toBe(12); // default purchaseLinkTemplateId
    expect(emailBody.params.primeiroNome).toBe("Maria");
    expect(emailBody.params.produto).toBe("Decole Plano de Voo");
    expect(emailBody.params.formUrl).toContain("/formulario/abc-token");
    expect(emailBody.params.transacao).toBe("TRX-100");
  });

  it("stores token in event.payload for downstream handlers", async () => {
    const fetchMock = mockFetch({ token: "returned-token" });
    const event = makeEvent();

    await callPlanoVooPurchase(event, makeEnv(), fetchMock);

    expect(event.payload.plano_voo_token).toBe("returned-token");
  });

  it("skips when no email found in payload", async () => {
    const fetchMock = mockFetch({});
    const event = makeEvent({
      lead: undefined,
      payload: { data: { buyer: {}, purchase: {}, product: {} } },
    });

    await callPlanoVooPurchase(event, makeEnv(), fetchMock);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when API returns error (fatal for queue retry)", async () => {
    const fetchMock = mockFetch({ error: "internal" }, 500);
    const event = makeEvent();

    await expect(
      callPlanoVooPurchase(event, makeEnv(), fetchMock)
    ).rejects.toThrow(/Plano de Voo API error: 500/);
  });

  it("throws when PLANOVOO_API_BASE_URL is not configured", async () => {
    await expect(
      callPlanoVooPurchase(makeEvent(), makeEnv({ PLANOVOO_API_BASE_URL: "" }), mockFetch({}))
    ).rejects.toThrow(/PLANOVOO_API_BASE_URL/);
  });

  it("throws when PLANOVOO_HOOK_SECRET is not configured", async () => {
    await expect(
      callPlanoVooPurchase(makeEvent(), makeEnv({ PLANOVOO_HOOK_SECRET: "" }), mockFetch({}))
    ).rejects.toThrow(/PLANOVOO_HOOK_SECRET/);
  });

  it("extracts from flat payload format (no data wrapper)", async () => {
    const fetchMock = mockFetch({ token: "flat-token" });
    const event = makeEvent({
      payload: {
        buyer: { email: "flat@example.com", name: "Flat User" },
        purchase: { transaction: "TRX-FLAT", price: { value: 99 }, payment: { type: "PIX" } },
        product: { name: "Flat Product" },
      },
    });

    await callPlanoVooPurchase(event, makeEnv(), fetchMock);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.email).toBe("flat@example.com");
    expect(body.transacao).toBe("TRX-FLAT");
    expect(body.pagamento).toBe("PIX");
  });

  it("strips trailing slash from base URL", async () => {
    const fetchMock = mockFetch({ token: "t" });
    const env = makeEnv({ PLANOVOO_API_BASE_URL: "https://app.decole.test/" });

    await callPlanoVooPurchase(makeEvent(), env, fetchMock);

    expect(fetchMock.mock.calls[0][0]).toBe("https://app.decole.test/api/hooks/purchase");
  });

  it("throws when Brevo email fails (fatal for queue retry)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("brevo.com")) {
        return new Response("rate limited", { status: 429 });
      }
      return new Response(JSON.stringify({ token: "t" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(
      callPlanoVooPurchase(makeEvent(), makeEnv(), fetchMock)
    ).rejects.toThrow(/Brevo transactional email failed \(429\)/);
  });

  it("uses primeiroNome (first word of name) in email params", async () => {
    const fetchMock = mockFetch({ token: "t" });
    const event = makeEvent();
    // buyer name is "Maria Silva" so primeiroNome should be "Maria"

    await callPlanoVooPurchase(event, makeEnv(), fetchMock);

    const emailBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(emailBody.params.primeiroNome).toBe("Maria");
  });

  it("defaults primeiroNome to 'Estudante' when name is empty", async () => {
    const fetchMock = mockFetch({ token: "t" });
    const event = makeEvent({
      payload: {
        data: {
          buyer: { email: "noname@example.com", name: "" },
          purchase: { transaction: "TRX-1" },
          product: {},
        },
      },
    });

    await callPlanoVooPurchase(event, makeEnv(), fetchMock);

    const emailBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(emailBody.params.primeiroNome).toBe("Estudante");
  });
});

// ---------------------------------------------------------------------------
// Tests — callPlanoVooRefund
// ---------------------------------------------------------------------------

describe("callPlanoVooRefund", () => {
  it("calls POST /api/hooks/refund with transacao and sends refund email", async () => {
    const fetchMock = mockFetch({ updated: 1 });
    const event = makeEvent({ event_type: "PURCHASE_REFUNDED" });

    await callPlanoVooRefund(event, makeEnv(), fetchMock);

    // First call: API
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.decole.test/api/hooks/refund");
    const body = JSON.parse(init.body);
    expect(body).toEqual({ transacao: "TRX-100" });
    expect(init.headers["x-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);

    // Second call: Brevo email
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [emailUrl, emailInit] = fetchMock.mock.calls[1];
    expect(emailUrl).toBe("https://api.brevo.com/v3/smtp/email");
    const emailBody = JSON.parse(emailInit.body);
    expect(emailBody.templateId).toBe(13); // default refundedTemplateId
    expect(emailBody.params.primeiroNome).toBe("Maria");
    expect(emailBody.params.transacao).toBe("TRX-100");
  });

  it("skips API call but still sends email when no transacao in payload", async () => {
    const fetchMock = mockFetch({});
    const event = makeEvent({
      payload: { data: { buyer: { email: "a@b.com", name: "Ana" }, purchase: {}, product: {} } },
    });

    await callPlanoVooRefund(event, makeEnv(), fetchMock);

    // Only the email call (no API call because transacao is empty)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [emailUrl] = fetchMock.mock.calls[0];
    expect(emailUrl).toBe("https://api.brevo.com/v3/smtp/email");
  });

  it("throws when API returns error", async () => {
    const fetchMock = mockFetch({ error: "fail" }, 401);
    const event = makeEvent();

    await expect(
      callPlanoVooRefund(event, makeEnv(), fetchMock)
    ).rejects.toThrow(/Plano de Voo API error: 401/);
  });

  it("includes valor formatted as BRL and data formatted in email params", async () => {
    const fetchMock = mockFetch({ updated: 1 });
    const event = makeEvent({ event_type: "PURCHASE_REFUNDED" });

    await callPlanoVooRefund(event, makeEnv(), fetchMock);

    const emailBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    // valor is 197 → should be formatted as BRL
    expect(emailBody.params.valor).toMatch(/197/);
    // data should be a formatted date
    expect(emailBody.params.data).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Tests — callPlanoVooProtest
// ---------------------------------------------------------------------------

describe("callPlanoVooProtest", () => {
  it("calls POST /api/hooks/protest with transacao and sends protest email", async () => {
    const fetchMock = mockFetch({ updated: 1 });
    const event = makeEvent({ event_type: "PURCHASE_PROTEST" });

    await callPlanoVooProtest(event, makeEnv(), fetchMock);

    // First call: API
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.decole.test/api/hooks/protest");
    const body = JSON.parse(init.body);
    expect(body).toEqual({ transacao: "TRX-100" });

    // Second call: Brevo email
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const emailBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(emailBody.templateId).toBe(14); // default protestTemplateId
  });

  it("skips API call but still sends email when no transacao in payload", async () => {
    const fetchMock = mockFetch({});
    const event = makeEvent({
      payload: { data: { buyer: { email: "a@b.com", name: "Ana" }, purchase: {}, product: {} } },
    });

    await callPlanoVooProtest(event, makeEnv(), fetchMock);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [emailUrl] = fetchMock.mock.calls[0];
    expect(emailUrl).toBe("https://api.brevo.com/v3/smtp/email");
  });

  it("throws when API returns error", async () => {
    const fetchMock = mockFetch({ error: "fail" }, 500);
    const event = makeEvent();

    await expect(
      callPlanoVooProtest(event, makeEnv(), fetchMock)
    ).rejects.toThrow(/Plano de Voo API error: 500/);
  });

  it("skips entirely when no email found in payload", async () => {
    const fetchMock = mockFetch({});
    const event = makeEvent({
      lead: undefined,
      payload: { data: { buyer: {}, purchase: {}, product: {} } },
    });

    await callPlanoVooProtest(event, makeEnv(), fetchMock);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
