import { describe, expect, it, vi } from "vitest";
import { ZernioSocialResponder } from "../../src/zernio-social-responder";
import type { SocialResponderRequest } from "../../src/social-respond";

const API_KEY = "zernio-tenant-key";

const REQUEST: SocialResponderRequest = {
  platform: "facebook",
  postId: "post_1",
  commentId: "comment_1",
  accountId: "account_1",
  message: "Texto da resposta",
};

function okResponse(): Response {
  return { ok: true, status: 200, text: async () => "{}" } as unknown as Response;
}

function errorResponse(status: number, body: string): Response {
  return { ok: false, status, text: async () => body } as unknown as Response;
}

describe("ZernioSocialResponder.replyToComment", () => {
  it("chama POST /v1/inbox/comments/{postId} com accountId/message/commentId e Bearer auth", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const responder = new ZernioSocialResponder(API_KEY, fetchImpl);
    await responder.replyToComment(REQUEST);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.zernio.com/v1/inbox/comments/post_1");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({
      accountId: "account_1",
      message: "Texto da resposta",
      commentId: "comment_1",
    });
  });

  it("lança erro claro se postId estiver ausente, sem chamar fetch", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const responder = new ZernioSocialResponder(API_KEY, fetchImpl);
    await expect(responder.replyToComment({ ...REQUEST, postId: undefined })).rejects.toThrow(/postId is required/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propaga erro com status e corpo quando a API do Zernio responde com falha", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(403, "Inbox addon required"));
    const responder = new ZernioSocialResponder(API_KEY, fetchImpl);
    await expect(responder.replyToComment(REQUEST)).rejects.toThrow(/403.*Inbox addon required/);
  });
});

describe("ZernioSocialResponder.sendPrivateReply", () => {
  it("chama POST /v1/inbox/comments/{postId}/{commentId}/private-reply com accountId/message", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const responder = new ZernioSocialResponder(API_KEY, fetchImpl);
    await responder.sendPrivateReply(REQUEST);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.zernio.com/v1/inbox/comments/post_1/comment_1/private-reply");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${API_KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({
      accountId: "account_1",
      message: "Texto da resposta",
    });
  });

  it("lança erro claro se postId estiver ausente, sem chamar fetch", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    const responder = new ZernioSocialResponder(API_KEY, fetchImpl);
    await expect(responder.sendPrivateReply({ ...REQUEST, postId: undefined })).rejects.toThrow(/postId is required/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
