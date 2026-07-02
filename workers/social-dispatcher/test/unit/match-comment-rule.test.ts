import { describe, expect, it } from "vitest";
import { matchCommentRuleForEvent } from "../../src/handlers/match-comment-rule";
import type { SocialCommentEvent } from "../../../../packages/shared/src/social-comment-event";
import type { DispatcherCatalog } from "../../src/dispatcher";

function makeEvent(overrides: Partial<SocialCommentEvent> = {}): SocialCommentEvent {
  return {
    event_id: "facebook_comment_1",
    event_type: "SOCIAL_COMMENT_RECEIVED",
    tenant_id: "decole",
    product_code: "DECOLE_PLANOVOO",
    platform: "facebook",
    comment_id: "comment_1",
    text: "quero saber sobre a tradução",
    from_id: "user_1",
    account_id: "page_1",
    occurred_at: new Date().toISOString(),
    payload: {},
    ...overrides,
  };
}

const CATALOG: DispatcherCatalog = {
  tenants: {
    decole: {
      products: {
        DECOLE_PLANOVOO: {
          commentAutomation: {
            rules: [
              {
                id: "planovoo_traducao",
                keyword: "tradução",
                matchType: "contains",
                caseSensitive: false,
                platforms: ["facebook", "instagram"],
                publicReply: { enabled: true, text: "Oi! Te mandei uma mensagem no privado" },
                privateReply: { enabled: true, text: "Aqui está o material: https://example.com" },
              },
            ],
          },
        },
      },
    },
  },
};

describe("matchCommentRuleForEvent", () => {
  it("1. retorna a regra quando o texto do evento casa", () => {
    const rule = matchCommentRuleForEvent(makeEvent(), CATALOG);
    expect(rule?.id).toBe("planovoo_traducao");
  });

  it("2. retorna null quando o texto não casa nenhuma regra", () => {
    const rule = matchCommentRuleForEvent(makeEvent({ text: "oi, tudo bem?" }), CATALOG);
    expect(rule).toBeNull();
  });

  it("3. retorna null sem lançar quando o produto não tem commentAutomation.rules", () => {
    const catalogSemRegras: DispatcherCatalog = {
      tenants: { decole: { products: { DECOLE_PLANOVOO: {} } } },
    };
    const rule = matchCommentRuleForEvent(makeEvent(), catalogSemRegras);
    expect(rule).toBeNull();
  });

  it("4. retorna null sem lançar quando o tenant não existe no catalog", () => {
    const rule = matchCommentRuleForEvent(makeEvent({ tenant_id: "tenant_inexistente" }), CATALOG);
    expect(rule).toBeNull();
  });
});
