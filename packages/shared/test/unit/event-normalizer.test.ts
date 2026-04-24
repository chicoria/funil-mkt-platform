import { describe, expect, it } from "vitest";
import { fromAppEvent, fromBrowserTracking, fromHotmartWebhook, fromPrecheckoutForm } from "../../src/event-normalizer";

describe("event-normalizer", () => {
  it("normaliza webhook hotmart", () => {
    const evt = fromHotmartWebhook(
      {
        event: "PURCHASE_APPROVED",
        id: "evt-1",
        buyer: { email: "buyer@example.com" },
      },
      "DECOLE_ESG_MENTORIA"
    );

    expect(evt.event_type).toBe("PURCHASE_APPROVED");
    expect(evt.event_id).toBe("evt-1");
    expect(evt.source).toBe("hotmart");
    expect(evt.lead?.email).toBe("buyer@example.com");
  });

  it("projeta campos aninhados do webhook Hotmart v2 para payload canonico", () => {
    const evt = fromHotmartWebhook(
      {
        id: "d4366093-936c-4bf9-b4ee-8ec64fd560d7",
        creation_date: 1777044436358,
        event: "PURCHASE_APPROVED",
        data: {
          buyer: {
            email: "testeComprador271101postman15@example.com",
            checkout_phone: "99999999900",
          },
          purchase: {
            transaction: "HP16015479281022",
            price: {
              value: 1500,
              currency_value: "BRL",
            },
          },
        },
      },
      "DECOLE_ESG_MENTORIA"
    );

    expect(evt.event_id).toBe("d4366093-936c-4bf9-b4ee-8ec64fd560d7");
    expect(evt.occurred_at).toBe(new Date(1777044436358).toISOString());
    expect(evt.lead?.email).toBe("testeComprador271101postman15@example.com");
    expect(evt.lead?.phone).toBe("99999999900");
    expect(evt.payload.occurred_at).toBe(new Date(1777044436358).toISOString());
    expect(evt.payload.value).toBe(1500);
    expect(evt.payload.currency).toBe("BRL");
    expect(evt.payload.transaction).toBe("HP16015479281022");
  });

  it("normaliza precheckout", () => {
    const evt = fromPrecheckoutForm(
      {
        event_type: "generate_lead",
        email: "lead@example.com",
        anonymous_id: "anon-1",
      },
      "DECOLE_PLANOVOO"
    );

    expect(evt.event_type).toBe("GENERATE_LEAD");
    expect(evt.product_code).toBe("DECOLE_PLANOVOO");
    expect(evt.identity?.anonymous_id).toBe("anon-1");
    expect(evt.lead?.email).toBe("lead@example.com");
  });

  it("normaliza browser tracking", () => {
    const evt = fromBrowserTracking({ event: "section_engaged", anonymous_id: "anon-x" }, "DECOLE_ESG_MENTORIA");
    expect(evt.event_type).toBe("SECTION_ENGAGED");
    expect(evt.identity?.anonymous_id).toBe("anon-x");
  });

  it("normaliza app event", () => {
    const evt = fromAppEvent({ event_type: "app_plano_view", user: { email: "app@example.com" } }, "DECOLE_PLANOVOO");
    expect(evt.event_type).toBe("APP_PLANO_VIEW");
    expect(evt.source).toBe("app");
    expect(evt.lead?.email).toBe("app@example.com");
  });
});
