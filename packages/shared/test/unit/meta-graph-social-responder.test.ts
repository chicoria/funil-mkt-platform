import { describe, expect, it, vi } from "vitest";
import { MetaGraphSocialResponder } from "../../src/meta-graph-social-responder";
import type { SocialResponderRequest } from "../../src/social-respond";

const SYSTEM_TOKEN = "graph-access-token";
const PAGE_TOKEN = "page-access-token";

const FB_REQUEST: SocialResponderRequest = {
  platform: "facebook",
  postId: "post_1",
  commentId: "comment_1",
  accountId: "page_1",
  message: "Texto da resposta",
};

const IG_REQUEST: SocialResponderRequest = {
  ...FB_REQUEST,
  platform: "instagram",
  accountId: "ig_account_1",
};

function okResponse(body: unknown = {}): Response {
  const json = JSON.stringify(body);
  return { ok: true, status: 200, text: async () => json, json: async () => body } as unknown as Response;
}

function makeFbFetch() {
  return vi.fn(async (url: string) => {
    if (url.includes("fields=access_token")) {
      return okResponse({ access_token: PAGE_TOKEN });
    }
    return okResponse();
  });
}

describe("MetaGraphSocialResponder.replyToComment", () => {
  it("Facebook: troca System User Token por Page Access Token (NPE) antes de responder", async () => {
    const fetchImpl = makeFbFetch();
    const responder = new MetaGraphSocialResponder(SYSTEM_TOKEN, fetchImpl);
    await responder.replyToComment(FB_REQUEST);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/v21.0/comment_1/comments?access_token=${PAGE_TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ message: "Texto da resposta" });
  });

  it("Instagram: usa o System User Token diretamente (sem troca de token)", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const responder = new MetaGraphSocialResponder(SYSTEM_TOKEN, fetchImpl);
    await responder.replyToComment(IG_REQUEST);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`access_token=${SYSTEM_TOKEN}`);
  });

  it("cacheia o Page Access Token por instância — 2 chamadas na mesma página só trocam token 1x", async () => {
    const fetchImpl = makeFbFetch();
    const responder = new MetaGraphSocialResponder(SYSTEM_TOKEN, fetchImpl);
    await responder.replyToComment(FB_REQUEST);
    await responder.replyToComment({ ...FB_REQUEST, commentId: "comment_2" });

    const tokenExchangeCalls = fetchImpl.mock.calls.filter(([url]) => (url as string).includes("fields=access_token"));
    expect(tokenExchangeCalls).toHaveLength(1);
  });
});

describe("MetaGraphSocialResponder.sendPrivateReply", () => {
  it("Facebook: troca token e chama o edge de private_replies", async () => {
    const fetchImpl = makeFbFetch();
    const responder = new MetaGraphSocialResponder(SYSTEM_TOKEN, fetchImpl);
    await responder.sendPrivateReply(FB_REQUEST);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/v21.0/comment_1/private_replies?access_token=${PAGE_TOKEN}`);
    expect(JSON.parse(init.body as string)).toEqual({ message: "Texto da resposta" });
  });
});
