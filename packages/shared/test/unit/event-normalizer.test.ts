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
