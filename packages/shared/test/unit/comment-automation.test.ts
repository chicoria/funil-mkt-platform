import { describe, expect, it } from "vitest";
import {
  CommentAutomationCatalog,
  CommentAutomationRule,
  matchCommentRule,
  resolveCommentAutomationRules,
  resolveProductCodeForSocialAccount,
  resolveZernioAccountId,
} from "../../src/comment-automation";
import { SocialCommentEvent } from "../../src/social-comment-event";

function buildComment(overrides: Partial<SocialCommentEvent> = {}): SocialCommentEvent {
  return {
    event_id: "evt_1",
    event_type: "SOCIAL_COMMENT_RECEIVED",
    tenant_id: "decole",
    product_code: "DECOLE_PLANOVOO",
    platform: "facebook",
    comment_id: "comment_1",
    text: "Comente tradução aqui",
    from_id: "user_1",
    account_id: "483391978198375",
    occurred_at: "2026-06-21T00:00:00.000Z",
    payload: {},
    ...overrides,
  };
}

const traducaoRule: CommentAutomationRule = {
  id: "planovoo_traducao_esg",
  keyword: "tradução",
  matchType: "contains",
  caseSensitive: false,
  platforms: ["facebook", "instagram"],
  publicReply: { enabled: true, text: "public" },
  privateReply: { enabled: true, text: "private" },
};

describe("matchCommentRule", () => {
  it("matches contains, case-insensitive by default", () => {
    expect(matchCommentRule(buildComment({ text: "Sobre TRADUÇÃO, me conta" }), [traducaoRule])).toEqual(
      traducaoRule
    );
  });

  it("does not match accented keyword against unaccented text", () => {
    expect(matchCommentRule(buildComment({ text: "fala sobre traducao" }), [traducaoRule])).toBeNull();
  });

  it("matches exact only on full trimmed equality", () => {
    const exactRule: CommentAutomationRule = { ...traducaoRule, matchType: "exact" };
    expect(matchCommentRule(buildComment({ text: "tradução" }), [exactRule])).toEqual(exactRule);
    expect(matchCommentRule(buildComment({ text: "  tradução  " }), [exactRule])).toEqual(exactRule);
    expect(matchCommentRule(buildComment({ text: "fala sobre tradução" }), [exactRule])).toBeNull();
  });

  it("respects caseSensitive: true", () => {
    const strictRule: CommentAutomationRule = { ...traducaoRule, caseSensitive: true };
    expect(matchCommentRule(buildComment({ text: "TRADUÇÃO" }), [strictRule])).toBeNull();
    expect(matchCommentRule(buildComment({ text: "tradução" }), [strictRule])).toEqual(strictRule);
  });

  it("filters by platform", () => {
    const igOnly: CommentAutomationRule = { ...traducaoRule, platforms: ["instagram"] };
    expect(matchCommentRule(buildComment({ platform: "facebook", text: "tradução" }), [igOnly])).toBeNull();
    expect(matchCommentRule(buildComment({ platform: "instagram", text: "tradução" }), [igOnly])).toEqual(
      igOnly
    );
  });

  it("returns null when no rule matches", () => {
    expect(matchCommentRule(buildComment({ text: "nada a ver" }), [traducaoRule])).toBeNull();
  });

  it("returns null for an empty rules array", () => {
    expect(matchCommentRule(buildComment(), [])).toBeNull();
  });

  it("first match wins among multiple candidate rules", () => {
    const first: CommentAutomationRule = { ...traducaoRule, id: "first" };
    const second: CommentAutomationRule = { ...traducaoRule, id: "second" };
    expect(matchCommentRule(buildComment({ text: "tradução" }), [first, second])?.id).toBe("first");
  });

  it("trims keyword and comment text symmetrically before comparing", () => {
    const paddedRule: CommentAutomationRule = { ...traducaoRule, matchType: "exact", keyword: "  tradução  " };
    expect(matchCommentRule(buildComment({ text: "tradução" }), [paddedRule])).toEqual(paddedRule);
  });
});

const catalog: CommentAutomationCatalog = {
  tenants: {
    decole: {
      socialAccounts: {
        facebookPages: { "483391978198375": { productCodes: ["DECOLE_PLANOVOO"] } },
        instagramBusinessAccounts: { "17841401638634396": { productCodes: ["DECOLE_PLANOVOO"] } },
      },
      products: {
        DECOLE_PLANOVOO: {
          commentAutomation: { rules: [traducaoRule] },
        },
        DECOLE_ESG_MENTORIA: {},
      },
    },
  },
};

describe("resolveCommentAutomationRules", () => {
  it("returns rules for an existing product", () => {
    expect(resolveCommentAutomationRules(catalog, "decole", "DECOLE_PLANOVOO")).toEqual([traducaoRule]);
  });

  it("returns empty array for a product without commentAutomation", () => {
    expect(resolveCommentAutomationRules(catalog, "decole", "DECOLE_ESG_MENTORIA")).toEqual([]);
  });

  it("returns empty array for an unknown tenant", () => {
    expect(resolveCommentAutomationRules(catalog, "unknown", "DECOLE_PLANOVOO")).toEqual([]);
  });

  it("returns empty array for an unknown product", () => {
    expect(resolveCommentAutomationRules(catalog, "decole", "UNKNOWN")).toEqual([]);
  });
});

describe("resolveProductCodeForSocialAccount", () => {
  it("resolves a known facebook page id", () => {
    expect(resolveProductCodeForSocialAccount(catalog, "facebook", "483391978198375")).toEqual([
      { tenantId: "decole", productCode: "DECOLE_PLANOVOO" },
    ]);
  });

  it("resolves a known instagram business account id", () => {
    expect(resolveProductCodeForSocialAccount(catalog, "instagram", "17841401638634396")).toEqual([
      { tenantId: "decole", productCode: "DECOLE_PLANOVOO" },
    ]);
  });

  it("returns empty array for an unknown account id", () => {
    expect(resolveProductCodeForSocialAccount(catalog, "facebook", "unknown_id")).toEqual([]);
  });

  it("returns empty array when catalog has no socialAccounts at all", () => {
    expect(resolveProductCodeForSocialAccount({}, "facebook", "483391978198375")).toEqual([]);
    expect(resolveProductCodeForSocialAccount({ tenants: {} }, "facebook", "483391978198375")).toEqual([]);
  });

  it("returns one resolution per product when account maps to multiple products", () => {
    const multiCatalog: CommentAutomationCatalog = {
      tenants: {
        decole: {
          socialAccounts: {
            facebookPages: {
              "483391978198375": { productCodes: ["DECOLE_PLANOVOO", "DECOLE_ESG_MENTORIA"] },
            },
          },
        },
      },
    };
    expect(resolveProductCodeForSocialAccount(multiCatalog, "facebook", "483391978198375")).toEqual([
      { tenantId: "decole", productCode: "DECOLE_PLANOVOO" },
      { tenantId: "decole", productCode: "DECOLE_ESG_MENTORIA" },
    ]);
  });
});

describe("resolveZernioAccountId", () => {
  const catalogWithZernio: CommentAutomationCatalog = {
    tenants: {
      decole: {
        socialAccounts: {
          facebookPages: { "483391978198375": { productCodes: ["DECOLE_PLANOVOO"] } },
          instagramBusinessAccounts: {
            "17841401638634396": {
              productCodes: ["DECOLE_PLANOVOO"],
              zernioAccountId: "6a513aa13ecd8aa344a06780",
            },
          },
        },
      },
    },
  };

  it("resolves the Zernio-internal accountId for a connected instagram account, not the Meta id", () => {
    expect(resolveZernioAccountId(catalogWithZernio, "decole", "instagram", "17841401638634396")).toBe(
      "6a513aa13ecd8aa344a06780"
    );
  });

  it("returns undefined when the account is mapped but has no zernioAccountId (not connected in Zernio yet)", () => {
    expect(resolveZernioAccountId(catalogWithZernio, "decole", "facebook", "483391978198375")).toBeUndefined();
  });

  it("returns undefined for an unknown tenant or account id", () => {
    expect(resolveZernioAccountId(catalogWithZernio, "unknown_tenant", "instagram", "17841401638634396")).toBeUndefined();
    expect(resolveZernioAccountId(catalogWithZernio, "decole", "instagram", "unknown_account")).toBeUndefined();
  });
});
