/**
 * update_brevo_funnel + brevoConfig.directListIds
 *
 * Inscrições transacionais (ex.: workshop pago à parte) entram numa lista Brevo sem DOI.
 * A lista vem só de `directListIds`; `listId`/`listIds` continuam exclusivos do fluxo DOI,
 * para que nenhum produto com DOI passe a inscrever contactos sem confirmação.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";

function makeEnv(catalog: unknown): Record<string, unknown> {
  const store = new Map<string, string>();
  const kv = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
  };
  const d1 = {
    prepare: vi.fn(() => {
      const stmt = { run: vi.fn(async () => ({})), first: vi.fn(async () => null), all: vi.fn(async () => ({ results: [] })) };
      return { ...stmt, bind: vi.fn(() => stmt) };
    }),
  };
  return { CATALOG_JSON: JSON.stringify(catalog), BREVO_API_KEY_T: "key-t", DEDUPE_KV: kv, IDENTITY_KV: kv, IDENTITY_DB: d1, EVENT_STORE_DB: d1 };
}

function catalogWith(brevoConfig: Record<string, unknown>) {
  return {
    tenants: {
      t: {
        name: "T",
        domains: ["api.t.example"],
        credentials: { brevo_api_key_env: "BREVO_API_KEY_T" },
        products: {
          T_WORKSHOP: {
            brevo: { funnelFields: { steps: "T_WS_STEPS", lastStep: "T_WS_LAST", lastStepTimestamp: "T_WS_TS" } },
            funnelEventArchitecture: { events: [{ eventType: "GENERATE_LEAD", chain: ["update_brevo_funnel"], brevoConfig }] },
          },
        },
      },
    },
  };
}

function queueOne(brevoConfig: Record<string, unknown>, chain = ["update_brevo_funnel"]) {
  const catalog = catalogWith(brevoConfig);
  catalog.tenants.t.products.T_WORKSHOP.funnelEventArchitecture.events[0].chain = chain;
  return worker.queue(
    { messages: [{ body: {
      event_id: "ws-1", event_type: "GENERATE_LEAD", tenant_id: "t", product_code: "T_WORKSHOP",
      source: "site", occurred_at: "2026-11-02T10:00:00.000Z", payload: {}, lead: { email: "pessoa@example.com" },
    } }] } as never,
    makeEnv(catalog) as never
  );
}

async function run(brevoConfig: Record<string, unknown>) {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({}), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await worker.queue(
    { messages: [{ body: {
      event_id: "ws-1", event_type: "GENERATE_LEAD", tenant_id: "t", product_code: "T_WORKSHOP",
      source: "site", occurred_at: "2026-11-02T10:00:00.000Z", payload: {}, lead: { email: "pessoa@example.com" },
    } }] } as never,
    makeEnv(catalogWith(brevoConfig)) as never
  );
  const upsert = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/contacts") && init?.method === "POST");
  expect(upsert).toBeDefined();
  return JSON.parse(String(upsert![1]?.body)) as Record<string, unknown>;
}

describe("update_brevo_funnel — directListIds", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("inscreve na lista de directListIds sem DOI", async () => {
    const body = await run({ directListIds: ["5"] });
    expect(body.listIds).toEqual([5]);
    expect(body.attributes).toMatchObject({ T_WS_STEPS: expect.any(String), T_WS_LAST: "GENERATE_LEAD" });
  });

  it("não usa listId do DOI como lista direta", async () => {
    const body = await run({ listId: "2" });
    expect(body).not.toHaveProperty("listIds");
  });

  it("ignora ids inválidos", async () => {
    const body = await run({ directListIds: ["abc", 0] });
    expect(body).not.toHaveProperty("listIds");
  });

  // Inscrição direta é a ação principal: falha da Brevo vai para retry da fila (dedupe por handler).
  it("lança erro quando a Brevo falha e há directListIds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(queueOne({ directListIds: ["5"] })).rejects.toThrow();
  });

  it("mantém falha da Brevo não fatal sem directListIds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(queueOne({ listId: "2" })).resolves.toBeUndefined();
  });

  it("DOI continua só com listId, mesmo com directListIds no mesmo evento", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await queueOne({ listId: "2", doiTemplateId: "1", doiRedirectUrl: "https://t.example/ok", directListIds: ["5"] }, ["send_brevo_doi"]);
    const doi = fetchMock.mock.calls.find(([url]) => String(url).includes("doubleOptinConfirmation"));
    expect(doi).toBeDefined();
    expect(JSON.parse(String(doi![1]?.body)).includeListIds).toEqual([2]);
  });
});
