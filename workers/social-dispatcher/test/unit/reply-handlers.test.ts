import { describe, expect, it, vi } from "vitest";
import { replyToCommentHandler, sendPrivateReplyHandler } from "../../src/handlers/reply-handlers";
import type { SocialCommentEvent } from "../../../../packages/shared/src/social-comment-event";
import type { CommentAutomationRule } from "../../../../packages/shared/src/comment-automation";
import type { SocialCommentResponder, SocialResponderRequest } from "../../../../packages/shared/src/social-respond";

const EVENT: SocialCommentEvent = {
  event_id: "facebook_comment_1",
  event_type: "SOCIAL_COMMENT_RECEIVED",
  tenant_id: "decole",
  product_code: "DECOLE_PLANOVOO",
  platform: "facebook",
  comment_id: "comment_1",
  post_id: "post_1",
  text: "tradução",
  from_id: "user_1",
  account_id: "page_1",
  occurred_at: new Date().toISOString(),
  payload: {},
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

function makeFakeResponder(): SocialCommentResponder & {
  replyCalls: SocialResponderRequest[];
  dmCalls: SocialResponderRequest[];
} {
  const replyCalls: SocialResponderRequest[] = [];
  const dmCalls: SocialResponderRequest[] = [];
  return {
    replyCalls,
    dmCalls,
    replyToComment: vi.fn(async (request: SocialResponderRequest) => {
      replyCalls.push(request);
    }),
    sendPrivateReply: vi.fn(async (request: SocialResponderRequest) => {
      dmCalls.push(request);
    }),
  };
}

describe("replyToCommentHandler", () => {
  it("chama responder.replyToComment com os dados do evento, o accountId resolvido pelo dispatcher e o texto da regra casada", async () => {
    const responder = makeFakeResponder();
    await replyToCommentHandler(EVENT, RULE, responder, "zernio_acc_resolved");

    expect(responder.replyToComment).toHaveBeenCalledTimes(1);
    expect(responder.replyCalls[0]).toEqual({
      platform: "facebook",
      postId: "post_1",
      commentId: "comment_1",
      accountId: "zernio_acc_resolved",
      message: "Texto da resposta pública",
    });
    expect(responder.sendPrivateReply).not.toHaveBeenCalled();
  });

  it("textByPlatform sobrepõe text para a plataforma correta", async () => {
    const responder = makeFakeResponder();
    const regraComOverride: CommentAutomationRule = {
      ...RULE,
      publicReply: {
        enabled: true,
        text: "Texto genérico",
        textByPlatform: { facebook: "Texto Facebook com link 👉 https://example.com" },
      },
    };
    await replyToCommentHandler(EVENT, regraComOverride, responder, "page_1");
    expect(responder.replyCalls[0].message).toBe("Texto Facebook com link 👉 https://example.com");

    const igResponder = makeFakeResponder();
    await replyToCommentHandler({ ...EVENT, platform: "instagram" }, regraComOverride, igResponder, "page_1");
    expect(igResponder.replyCalls[0].message).toBe("Texto genérico");
  });
});

describe("sendPrivateReplyHandler", () => {
  it("chama responder.sendPrivateReply com os dados do evento, o accountId resolvido pelo dispatcher e o texto da regra casada", async () => {
    const responder = makeFakeResponder();
    await sendPrivateReplyHandler(EVENT, RULE, responder, "zernio_acc_resolved");

    expect(responder.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(responder.dmCalls[0]).toEqual({
      platform: "facebook",
      postId: "post_1",
      commentId: "comment_1",
      accountId: "zernio_acc_resolved",
      message: "Texto da DM privada",
    });
    expect(responder.replyToComment).not.toHaveBeenCalled();
  });

  it("usa o texto da regra casada, não um texto fixo no código", async () => {
    const responder = makeFakeResponder();
    const outraRegra: CommentAutomationRule = {
      ...RULE,
      privateReply: { enabled: true, text: "Outra DM completamente diferente" },
    };
    await sendPrivateReplyHandler(EVENT, outraRegra, responder, "page_1");
    expect(responder.dmCalls[0].message).toBe("Outra DM completamente diferente");
  });
});
