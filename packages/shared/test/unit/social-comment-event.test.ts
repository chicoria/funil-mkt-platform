import { describe, expect, it } from "vitest";
import { isSocialCommentEvent, SocialCommentEvent } from "../../src/social-comment-event";

const valid: SocialCommentEvent = {
  event_id: "fb_comment_123",
  event_type: "SOCIAL_COMMENT_RECEIVED",
  tenant_id: "decole",
  product_code: "DECOLE_PLANOVOO",
  platform: "facebook",
  comment_id: "comment_123",
  text: "tradução por favor",
  from_id: "user_456",
  account_id: "483391978198375",
  occurred_at: "2026-06-21T00:00:00.000Z",
  payload: { raw: true },
};

describe("isSocialCommentEvent", () => {
  it("accepts a valid event", () => {
    expect(isSocialCommentEvent(valid)).toBe(true);
  });

  it("rejects non-object values", () => {
    expect(isSocialCommentEvent(null)).toBe(false);
    expect(isSocialCommentEvent(undefined)).toBe(false);
    expect(isSocialCommentEvent("string")).toBe(false);
    expect(isSocialCommentEvent(42)).toBe(false);
  });

  it("rejects when required string fields are missing", () => {
    const { comment_id, ...withoutCommentId } = valid;
    expect(isSocialCommentEvent(withoutCommentId)).toBe(false);

    const { from_id, ...withoutFromId } = valid;
    expect(isSocialCommentEvent(withoutFromId)).toBe(false);

    const { account_id, ...withoutAccountId } = valid;
    expect(isSocialCommentEvent(withoutAccountId)).toBe(false);
  });

  it("rejects platform outside facebook|instagram", () => {
    expect(isSocialCommentEvent({ ...valid, platform: "whatsapp" })).toBe(false);
    expect(isSocialCommentEvent({ ...valid, platform: "" })).toBe(false);
  });

  it("accepts instagram platform", () => {
    expect(isSocialCommentEvent({ ...valid, platform: "instagram" })).toBe(true);
  });

  it("rejects when payload is missing or not an object", () => {
    const { payload, ...withoutPayload } = valid;
    expect(isSocialCommentEvent(withoutPayload)).toBe(false);
    expect(isSocialCommentEvent({ ...valid, payload: "not-an-object" })).toBe(false);
  });

  it("rejects when event_type is not SOCIAL_COMMENT_RECEIVED", () => {
    expect(isSocialCommentEvent({ ...valid, event_type: "OTHER" })).toBe(false);
  });
});
