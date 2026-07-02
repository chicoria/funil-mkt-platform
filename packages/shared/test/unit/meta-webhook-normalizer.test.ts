import { describe, expect, it } from "vitest";
import { fromMetaWebhookPayload, ResolveProductCode } from "../../src/meta-webhook-normalizer";

const resolveAll: ResolveProductCode = (_platform, accountId) =>
  accountId === "483391978198375" || accountId === "17841401638634396"
    ? [{ tenantId: "decole", productCode: "DECOLE_PLANOVOO" }]
    : [];

function facebookPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    object: "page",
    entry: [
      {
        id: "483391978198375",
        time: 1750000000,
        changes: [
          {
            field: "feed",
            value: {
              item: "comment",
              verb: "add",
              comment_id: "fb_comment_1",
              post_id: "483391978198375_999",
              message: "Comente tradução por favor",
              from: { id: "fb_user_1", name: "Maria" },
              created_time: 1750000000,
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function instagramPayload() {
  return {
    object: "instagram",
    entry: [
      {
        id: "17841401638634396",
        time: 1750000001,
        changes: [
          {
            field: "comments",
            value: {
              id: "ig_comment_1",
              text: "fala sobre tradução",
              media: { id: "ig_media_1" },
              from: { id: "ig_user_1", username: "joana" },
            },
          },
        ],
      },
    ],
  };
}

describe("fromMetaWebhookPayload", () => {
  it("normalizes a single Facebook comment entry", () => {
    const events = fromMetaWebhookPayload(facebookPayload(), resolveAll);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: "SOCIAL_COMMENT_RECEIVED",
      tenant_id: "decole",
      product_code: "DECOLE_PLANOVOO",
      platform: "facebook",
      comment_id: "fb_comment_1",
      post_id: "483391978198375_999",
      text: "Comente tradução por favor",
      from_id: "fb_user_1",
      account_id: "483391978198375",
    });
  });

  it("normalizes multiple entries in one Facebook payload", () => {
    const payload = facebookPayload();
    (payload.entry as Array<Record<string, unknown>>).push({
      id: "483391978198375",
      time: 1750000002,
      changes: [
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: "fb_comment_2",
            message: "outro comentário",
            from: { id: "fb_user_2" },
          },
        },
      ],
    });
    const events = fromMetaWebhookPayload(payload, resolveAll);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.comment_id)).toEqual(["fb_comment_1", "fb_comment_2"]);
  });

  it("normalizes a single Instagram comment entry", () => {
    const events = fromMetaWebhookPayload(instagramPayload(), resolveAll);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      platform: "instagram",
      comment_id: "ig_comment_1",
      text: "fala sobre tradução",
      from_id: "ig_user_1",
      from_username: "joana",
      account_id: "17841401638634396",
      tenant_id: "decole",
      product_code: "DECOLE_PLANOVOO",
    });
  });

  it("drops a comment when resolveProductCode returns empty array, without throwing", () => {
    const resolveNone: ResolveProductCode = () => [];
    expect(fromMetaWebhookPayload(facebookPayload(), resolveNone)).toEqual([]);
  });

  it("processes other entries even when one account_id does not resolve", () => {
    const payload = facebookPayload();
    (payload.entry as Array<Record<string, unknown>>).unshift({
      id: "unknown_page_id",
      changes: [
        {
          field: "feed",
          value: { item: "comment", verb: "add", comment_id: "orphan", message: "x", from: { id: "u" } },
        },
      ],
    });
    const events = fromMetaWebhookPayload(payload, resolveAll);
    expect(events).toHaveLength(1);
    expect(events[0].comment_id).toBe("fb_comment_1");
  });

  it("filters out non-comment feed changes (e.g. verb remove, or other items)", () => {
    const payload = facebookPayload();
    payload.entry[0].changes = [
      { field: "feed", value: { item: "comment", verb: "remove", comment_id: "x", message: "y", from: { id: "u" } } },
      { field: "feed", value: { item: "status", message: "not a comment" } },
    ];
    expect(fromMetaWebhookPayload(payload, resolveAll)).toEqual([]);
  });

  it("filters out non-comments instagram changes", () => {
    const payload = instagramPayload();
    payload.entry[0].changes = [{ field: "mentions", value: { id: "x" } }];
    expect(fromMetaWebhookPayload(payload, resolveAll)).toEqual([]);
  });

  it("returns empty array for an unknown object type", () => {
    expect(fromMetaWebhookPayload({ object: "whatsapp_business_account", entry: [] }, resolveAll)).toEqual([]);
  });

  it("emits one event per product when resolveProductCode returns multiple resolutions", () => {
    const resolveMulti: ResolveProductCode = (_platform, accountId) =>
      accountId === "483391978198375"
        ? [
            { tenantId: "decole", productCode: "DECOLE_PLANOVOO" },
            { tenantId: "decole", productCode: "DECOLE_ESG_MENTORIA" },
          ]
        : [];
    const events = fromMetaWebhookPayload(facebookPayload(), resolveMulti);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.product_code)).toEqual(["DECOLE_PLANOVOO", "DECOLE_ESG_MENTORIA"]);
    expect(events.map((e) => e.comment_id)).toEqual(["fb_comment_1", "fb_comment_1"]);
    expect(events[0].event_id).not.toBe(events[1].event_id);
  });

  it("returns empty array for malformed payloads without throwing", () => {
    expect(fromMetaWebhookPayload({}, resolveAll)).toEqual([]);
    expect(fromMetaWebhookPayload({ object: "page" }, resolveAll)).toEqual([]);
    expect(fromMetaWebhookPayload({ object: "page", entry: "not-an-array" }, resolveAll)).toEqual([]);
    expect(fromMetaWebhookPayload({ object: "page", entry: [{ id: "x", changes: "nope" }] }, resolveAll)).toEqual(
      []
    );
  });
});
