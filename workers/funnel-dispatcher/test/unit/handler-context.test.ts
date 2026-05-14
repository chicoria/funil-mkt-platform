import { describe, expect, it } from "vitest";
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
    payload: {},
    ...overrides,
  };
}

const env = { SOME_VAR: "value" } as unknown as DispatcherEnv;

const credentials: ResolvedCredentials = {
  brevoApiKey: "xkeysib-test",
  hotmartToken: "hotmart-test",
  replyToEmail: "contato@decole.com.br",
};

// ---------------------------------------------------------------------------
// Constructor + basic accessors
// ---------------------------------------------------------------------------

describe("HandlerContext", () => {
  it("exposes event, env, tenant_id, and credentials", () => {
    const event = makeEvent();
    const ctx = new HandlerContext(event, env, "decole", credentials);

    expect(ctx.event).toBe(event);
    expect(ctx.env).toBe(env);
    expect(ctx.tenant_id).toBe("decole");
    expect(ctx.credentials).toBe(credentials);
  });

  it("exposes product_code from event", () => {
    const ctx = new HandlerContext(makeEvent({ product_code: "ESG_MENTORIA" }), env, "decole", credentials);
    expect(ctx.product_code).toBe("ESG_MENTORIA");
  });
});

// ---------------------------------------------------------------------------
// Context data store (set/get for inter-handler communication)
// ---------------------------------------------------------------------------

describe("HandlerContext data store", () => {
  it("stores and retrieves a value", () => {
    const ctx = new HandlerContext(makeEvent(), env, "decole", credentials);
    ctx.set("api_response", { token: "abc" });
    expect(ctx.get("api_response")).toEqual({ token: "abc" });
  });

  it("returns undefined for missing key", () => {
    const ctx = new HandlerContext(makeEvent(), env, "decole", credentials);
    expect(ctx.get("nonexistent")).toBeUndefined();
  });

  it("overwrites existing value", () => {
    const ctx = new HandlerContext(makeEvent(), env, "decole", credentials);
    ctx.set("key", "first");
    ctx.set("key", "second");
    expect(ctx.get("key")).toBe("second");
  });

  it("isolates data between separate contexts", () => {
    const ctx1 = new HandlerContext(makeEvent(), env, "decole", credentials);
    const ctx2 = new HandlerContext(makeEvent(), env, "superare", credentials);
    ctx1.set("token", "abc");
    expect(ctx2.get("token")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tenant-prefixed keys
// ---------------------------------------------------------------------------

describe("HandlerContext tenant-prefixed keys", () => {
  it("prefixes dedupeKey with tenant_id and event_id", () => {
    const ctx = new HandlerContext(makeEvent({ event_id: "evt-42" }), env, "decole", credentials);
    expect(ctx.dedupeKey("resolve_identity")).toBe("decole:evt-42:resolve_identity");
  });

  it("prefixes kvKey with tenant_id", () => {
    const ctx = new HandlerContext(makeEvent(), env, "decole", credentials);
    expect(ctx.kvKey("email_hash:abc123")).toBe("decole:email_hash:abc123");
  });

  it("uses superare tenant prefix", () => {
    const ctx = new HandlerContext(makeEvent({ event_id: "evt-99" }), env, "superare", credentials);
    expect(ctx.dedupeKey("handler_x")).toBe("superare:evt-99:handler_x");
    expect(ctx.kvKey("session:xyz")).toBe("superare:session:xyz");
  });
});
