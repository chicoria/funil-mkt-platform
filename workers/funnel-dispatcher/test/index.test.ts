import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

function makeEnv(overrides: Record<string, unknown> = {}): any {
  const kvStore = new Map<string, string>();
  return {
    DEDUPE_KV: {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kvStore.set(key, value);
      }),
    },
    ...overrides,
  };
}

describe("funnel-dispatcher", () => {
  it("retorna health", async () => {
    const res = await worker.fetch(new Request("https://x/health"));
    expect(res.status).toBe(200);
  });

  it("executa chain default e dedupe em reenvio", async () => {
    const env = makeEnv();
    const event = {
      event_id: "evt-1",
      event_type: "GENERATE_LEAD",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "site",
      occurred_at: new Date().toISOString(),
      payload: {},
    };

    await worker.queue({ messages: [{ body: event }] }, env);
    await worker.queue({ messages: [{ body: event }] }, env);

    expect(env.DEDUPE_KV.put).toHaveBeenCalled();
    const putCalls = (env.DEDUPE_KV.put as any).mock.calls.length;
    expect(putCalls).toBe(5);
  });

  it("usa chain do catalog_json quando presente", async () => {
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_ESG_MENTORIA: {
            funnelEventArchitecture: {
              events: [{ eventType: "GENERATE_LEAD", chain: ["update_brevo_funnel"] }],
            },
          },
        },
      }),
    });

    const event = {
      event_id: "evt-2",
      event_type: "GENERATE_LEAD",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "site",
      occurred_at: new Date().toISOString(),
      payload: {},
    };

    await worker.queue({ messages: [{ body: event }] }, env);
    expect((env.DEDUPE_KV.put as any).mock.calls.length).toBe(1);
  });
});
