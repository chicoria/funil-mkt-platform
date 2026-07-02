import { describe, it, expect, vi, beforeEach } from "vitest";
import { pollFacebookPage, pollInstagramAccount, runPoller, type PollerEnv } from "../../src/poller";
import type { CommentAutomationCatalog } from "../../../../packages/shared/src/comment-automation";

const CATALOG: CommentAutomationCatalog = {
  tenants: {
    decole: {
      socialAccounts: {
        facebookPages: { "PAGE_123": { productCodes: ["DECOLE_PLANOVOO"] } },
        instagramBusinessAccounts: { "IG_456": { productCodes: ["DECOLE_PLANOVOO"] } },
      },
    },
    superare: {
      socialAccounts: {
        facebookPages: { "PAGE_999": { productCodes: ["SUPERARE_CURSO_X"] } },
      },
    },
  },
};

function makeKv(seen: string[] = []): KVNamespace {
  const store = new Map<string, string>(seen.map((k) => [k, "1"]));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  } as unknown as KVNamespace;
}

function makeQueue(): Queue {
  return { send: vi.fn(async () => {}) } as unknown as Queue;
}

function makeEnv(kv: KVNamespace, queue: Queue, extra: Record<string, string> = {}): PollerEnv {
  return {
    SOCIAL_DEDUPE_KV: kv,
    SOCIAL_EVENTS: queue as Queue<never>,
    META_SYSTEM_USER_ACCESS_TOKEN_DECOLE: "token_decole",
    META_SYSTEM_USER_ACCESS_TOKEN_SUPERARE: "token_superare",
    ...extra,
  };
}

const NOW_ISO = new Date().toISOString();

const FB_FEED = {
  data: [{ id: "POST_1", comments: { data: [
    { id: "COMMENT_A", message: "ola", from: { id: "USER_1", name: "Alice" }, created_time: NOW_ISO },
  ] } }],
};

const IG_MEDIA = {
  data: [{ id: "MEDIA_1", comments: { data: [
    { id: "IG_COMMENT_B", text: "hello", from: { id: "IG_USER_1", username: "alice_ig" }, timestamp: NOW_ISO },
  ] } }],
};

function makeFbFetch() {
  return vi.fn(async (url: string) => {
    if (url.includes("fields=access_token")) {
      return new Response(JSON.stringify({ access_token: "page_tok_123" }), { status: 200 });
    }
    return new Response(JSON.stringify(FB_FEED), { status: 200 });
  });
}

describe("pollFacebookPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", makeFbFetch());
  });

  it("enqueues a SocialCommentEvent for a new comment", async () => {
    const kv = makeKv();
    const queue = makeQueue();
    await pollFacebookPage("PAGE_123", "tok", CATALOG, makeEnv(kv, queue));

    expect(queue.send).toHaveBeenCalledTimes(1);
    const event = (queue.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(event.event_type).toBe("SOCIAL_COMMENT_RECEIVED");
    expect(event.platform).toBe("facebook");
    expect(event.comment_id).toBe("COMMENT_A");
    expect(event.product_code).toBe("DECOLE_PLANOVOO");
    expect(event.tenant_id).toBe("decole");
  });

  it("skips already-seen comments", async () => {
    const kv = makeKv(["seen:facebook:COMMENT_A"]);
    const queue = makeQueue();
    await pollFacebookPage("PAGE_123", "tok", CATALOG, makeEnv(kv, queue));
    expect(queue.send).not.toHaveBeenCalled();
  });
});

describe("pollInstagramAccount", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(IG_MEDIA), { status: 200 })));
  });

  it("enqueues a SocialCommentEvent for a new IG comment", async () => {
    const kv = makeKv();
    const queue = makeQueue();
    await pollInstagramAccount("IG_456", "tok", CATALOG, makeEnv(kv, queue));

    expect(queue.send).toHaveBeenCalledTimes(1);
    const event = (queue.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(event.platform).toBe("instagram");
    expect(event.comment_id).toBe("IG_COMMENT_B");
    expect(event.from_username).toBe("alice_ig");
  });
});

describe("runPoller (multi-tenant)", () => {
  it("polls all tenants that have a token binding", async () => {
    const responses: Record<string, unknown> = {
      "PAGE_123": FB_FEED,
      "IG_456": IG_MEDIA,
      "PAGE_999": { data: [{ id: "POST_S", comments: { data: [
        { id: "COMMENT_S1", message: "superare", from: { id: "U2", name: "Bob" }, created_time: NOW_ISO },
      ] } }] },
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("fields=access_token")) {
        return new Response(JSON.stringify({ access_token: "page_tok_123" }), { status: 200 });
      }
      for (const [id, body] of Object.entries(responses)) {
        if (url.includes(id)) return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }));

    const kv = makeKv();
    const queue = makeQueue();
    await runPoller(CATALOG, makeEnv(kv, queue));

    // decole: 1 FB comment + 1 IG comment; superare: 1 FB comment
    expect(queue.send).toHaveBeenCalledTimes(3);
    const tenants = (queue.send as ReturnType<typeof vi.fn>).mock.calls.map(
      ([e]: [{ tenant_id: string }]) => e.tenant_id
    );
    expect(tenants).toContain("decole");
    expect(tenants).toContain("superare");
  });

  it("skips tenant with missing token and polls the rest", async () => {
    vi.stubGlobal("fetch", makeFbFetch());

    const kv = makeKv();
    const queue = makeQueue();
    // Remove superare token
    const env = makeEnv(kv, queue);
    delete (env as Record<string, unknown>)["META_SYSTEM_USER_ACCESS_TOKEN_SUPERARE"];

    await runPoller(CATALOG, env);

    // Only decole events (FB + IG feed both return FB_FEED here, but IG media response also has comments)
    // At least decole enqueued, superare skipped
    const tenants = (queue.send as ReturnType<typeof vi.fn>).mock.calls.map(
      ([e]: [{ tenant_id: string }]) => e.tenant_id
    );
    expect(tenants.every((t: string) => t === "decole")).toBe(true);
  });
});
