import { describe, expect, it, vi } from "vitest";
import { replyToComment, sendDirectMessage } from "../../src/social-send";

function okResponse(): Response {
  return { ok: true, status: 200, text: async () => "{}" } as unknown as Response;
}

function errorResponse(status: number, body: string): Response {
  return { ok: false, status, text: async () => body } as unknown as Response;
}

describe("replyToComment", () => {
  it("posts to /{comment-id}/comments with message body and access_token query param", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await replyToComment({
      platform: "facebook",
      commentId: "comment_123",
      message: "Oi! Te mandei uma mensagem no privado",
      accessToken: "TOKEN_ABC",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      "https://graph.facebook.com/v21.0/comment_123/comments?access_token=TOKEN_ABC"
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(init.body as string)).toEqual({ message: "Oi! Te mandei uma mensagem no privado" });
  });

  it("posts to /{comment-id}/replies for instagram (not /comments)", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await replyToComment({
      platform: "instagram",
      commentId: "comment_ig_1",
      message: "Veja o link da bio",
      accessToken: "TOKEN_IG",
      fetchImpl,
    });
    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      "https://graph.facebook.com/v21.0/comment_ig_1/replies?access_token=TOKEN_IG"
    );
  });

  it("throws with the response body on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(400, '{"error":"invalid_token"}'));
    await expect(
      replyToComment({
        platform: "instagram",
        commentId: "comment_456",
        message: "x",
        accessToken: "TOKEN",
        fetchImpl,
      })
    ).rejects.toThrow(/invalid_token/);
  });

  it("does not throw when the response body cannot be read", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: false,
          status: 500,
          text: async () => {
            throw new Error("body already consumed");
          },
        }) as unknown as Response
    );
    await expect(
      replyToComment({ platform: "facebook", commentId: "c", message: "x", accessToken: "t", fetchImpl })
    ).rejects.toThrow(/500/);
  });

  it("truncates a very long error body to exactly 300 chars", async () => {
    const longBody = "x".repeat(1000);
    const fetchImpl = vi.fn(async () => errorResponse(400, longBody));
    let captured = "";
    try {
      await replyToComment({ platform: "facebook", commentId: "c", message: "x", accessToken: "t", fetchImpl });
    } catch (error) {
      captured = (error as Error).message;
    }
    const bodyPortion = captured.split(": ").slice(1).join(": ");
    expect(bodyPortion).toHaveLength(300);
    expect(bodyPortion).toBe("x".repeat(300));
  });
});

describe("sendDirectMessage", () => {
  it("posts to /{comment-id}/private_replies for facebook", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await sendDirectMessage({
      platform: "facebook",
      commentId: "comment_789",
      message: "DM de teste",
      accessToken: "TOKEN_XYZ",
      fetchImpl,
    });
    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      "https://graph.facebook.com/v21.0/comment_789/private_replies?access_token=TOKEN_XYZ"
    );
  });

  it("posts to the same /{comment-id}/private_replies endpoint for instagram (no platform-specific URL)", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await sendDirectMessage({
      platform: "instagram",
      commentId: "comment_789",
      message: "DM de teste",
      accessToken: "TOKEN_XYZ",
      fetchImpl,
    });
    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      "https://graph.facebook.com/v21.0/comment_789/private_replies?access_token=TOKEN_XYZ"
    );
  });

  it("throws with the response body on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(403, '{"error":"permission_denied"}'));
    await expect(
      sendDirectMessage({ platform: "facebook", commentId: "c", message: "x", accessToken: "t", fetchImpl })
    ).rejects.toThrow(/permission_denied/);
  });

  it("calls fetchImpl exactly once, no built-in retry", async () => {
    const fetchImpl = vi.fn(async () => okResponse());
    await sendDirectMessage({ platform: "instagram", commentId: "c", message: "x", accessToken: "t", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
