import { afterEach, describe, expect, it, vi } from "vitest";
import { replyToCommentHandler, sendPrivateReplyHandler, clearPageTokenCache } from "../../src/handlers/reply-handlers";
import { clearSecretCache } from "../../../../packages/shared/src/secrets-store-wrapper";
import type { SocialCommentEvent } from "../../../../packages/shared/src/social-comment-event";
import type { CommentAutomationRule } from "../../../../packages/shared/src/comment-automation";
import type { DispatcherEnv } from "../../src/dispatcher";

const SYSTEM_TOKEN = "graph-access-token";
const PAGE_TOKEN = "page-access-token";

const EVENT: SocialCommentEvent = {
  event_id: "facebook_comment_1",
  event_type: "SOCIAL_COMMENT_RECEIVED",
  tenant_id: "decole",
  product_code: "DECOLE_PLANOVOO",
  platform: "facebook",
  comment_id: "comment_1",
  text: "tradução",
  from_id: "user_1",
  account_id: "page_1",
  occurred_at: new Date().toISOString(),
  payload: {},
};

const IG_EVENT: SocialCommentEvent = {
  ...EVENT,
  event_id: "instagram_comment_1",
  platform: "instagram",
  account_id: "ig_account_1",
};

const RULE: CommentAutomationRule = {
  id: "planovoo_traducao",
  keyword: "tradução",
  matchType: "contains",
  caseSensitive: false,
  platforms: ["facebook", "instagram"],
  publicReply: { enabled: true, text: "Texto da resposta pública" },
  privateReply: { enabled: true, text: "Texto da DM privada" },
};

function makeEnv(overrides: Record<string, unknown> = {}): DispatcherEnv {
  return {
    CATALOG_JSON: JSON.stringify({
      tenants: { decole: { credentials: { meta_access_token_env: "META_SYSTEM_USER_ACCESS_TOKEN_DECOLE" } } },
    }),
    META_SYSTEM_USER_ACCESS_TOKEN_DECOLE: SYSTEM_TOKEN,
    ...overrides,
  };
}

function okResponse(body: unknown = {}): Response {
  const json = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    text: async () => json,
    json: async () => body,
  } as unknown as Response;
}

// Facebook: first call returns page token, second call returns OK
function makeFbFetch() {
  return vi.fn(async (url: string) => {
    if ((url as string).includes("fields=access_token")) {
      return okResponse({ access_token: PAGE_TOKEN });
    }
    return okResponse();
  });
}

afterEach(() => {
  clearSecretCache();
  clearPageTokenCache();
});

describe("replyToCommentHandler", () => {
  it("5. chama replyToComment com page access token correto (Facebook NPE)", async () => {
    const fetchImpl = makeFbFetch();
    await replyToCommentHandler(EVENT, RULE, makeEnv(), fetchImpl);


    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/v21.0/comment_1/comments?access_token=${PAGE_TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ message: "Texto da resposta pública" });
  });

  it("5b. Instagram usa system token diretamente (sem troca de token)", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await replyToCommentHandler(IG_EVENT, RULE, makeEnv(), fetchImpl);


    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`access_token=${SYSTEM_TOKEN}`);
  });

  it("7a. lança erro claro quando access_token não está configurado, sem chamar fetch", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({ tenants: { decole: { credentials: {} } } }),
    });

    await expect(replyToCommentHandler(EVENT, RULE, env, fetchImpl)).rejects.toThrow();

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("sendPrivateReplyHandler", () => {
  it("6. chama sendDirectMessage com page access token correto", async () => {
    const fetchImpl = makeFbFetch();
    await sendPrivateReplyHandler(EVENT, RULE, makeEnv(), fetchImpl);


    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/v21.0/comment_1/private_replies?access_token=${PAGE_TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ message: "Texto da DM privada" });
  });

  it("7b. lança erro claro quando access_token não está configurado, sem chamar fetch", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const env = makeEnv({
      CATALOG_JSON: JSON.stringify({ tenants: { decole: { credentials: {} } } }),
    });

    await expect(sendPrivateReplyHandler(EVENT, RULE, env, fetchImpl)).rejects.toThrow();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("8b. textByPlatform sobrepõe text para a plataforma correta", async () => {
    const regraComOverride: CommentAutomationRule = {
      ...RULE,
      publicReply: {
        enabled: true,
        text: "Texto genérico",
        textByPlatform: { facebook: "Texto Facebook com link 👉 https://example.com" },
      },
      privateReply: { enabled: true, text: "DM genérica" },
    };
    const fbFetch = makeFbFetch();
    await replyToCommentHandler(EVENT, regraComOverride, makeEnv(), fbFetch);
    const [, init] = fbFetch.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ message: "Texto Facebook com link 👉 https://example.com" });

    const igFetch = vi.fn(async () => okResponse());
    await replyToCommentHandler(IG_EVENT, regraComOverride, makeEnv(), igFetch);
    const [, igInit] = igFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(igInit.body as string)).toEqual({ message: "Texto genérico" });
  });

  it("8. usa o texto da regra casada, não um texto fixo no código", async () => {
    const outraRegra: CommentAutomationRule = {
      ...RULE,
      publicReply: { enabled: true, text: "Outro texto completamente diferente" },
      privateReply: { enabled: true, text: "Outra DM completamente diferente" },
    };
    const fetchImpl = makeFbFetch();
    await sendPrivateReplyHandler(EVENT, outraRegra, makeEnv(), fetchImpl);


    const [, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ message: "Outra DM completamente diferente" });
  });
});
