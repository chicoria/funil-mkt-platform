import { SocialCommentEvent, SocialPlatform } from "./social-comment-event";

export type CommentMatchType = "exact" | "contains";

export interface CommentAutomationReplyConfig {
  enabled: boolean;
  text: string;
  textByPlatform?: Partial<Record<SocialPlatform, string>>;
}

export interface CommentAutomationRule {
  id: string;
  keyword: string;
  matchType: CommentMatchType;
  caseSensitive?: boolean;
  platforms: SocialPlatform[];
  publicReply?: CommentAutomationReplyConfig;
  privateReply?: CommentAutomationReplyConfig;
}

export interface SocialAccountMapping {
  productCodes: string[];
}

export interface CommentAutomationCatalog {
  tenants?: Record<
    string,
    {
      socialAccounts?: {
        facebookPages?: Record<string, SocialAccountMapping>;
        instagramBusinessAccounts?: Record<string, SocialAccountMapping>;
      };
      products?: Record<
        string,
        {
          commentAutomation?: {
            rules?: CommentAutomationRule[];
          };
        }
      >;
    }
  >;
}

export interface ProductResolution {
  tenantId: string;
  productCode: string;
}

function normalize(value: string, caseSensitive: boolean): string {
  const trimmed = value.trim();
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

function ruleMatchesText(rule: CommentAutomationRule, text: string): boolean {
  const caseSensitive = rule.caseSensitive ?? false;
  const normalizedKeyword = normalize(rule.keyword, caseSensitive);
  const normalizedText = normalize(text, caseSensitive);

  if (rule.matchType === "exact") return normalizedText === normalizedKeyword;
  return normalizedText.includes(normalizedKeyword);
}

export function resolveReplyText(
  config: CommentAutomationReplyConfig,
  platform: SocialPlatform
): string {
  return config.textByPlatform?.[platform] ?? config.text;
}

export function matchCommentRule(
  comment: SocialCommentEvent,
  rules: CommentAutomationRule[]
): CommentAutomationRule | null {
  for (const rule of rules) {
    if (!rule.platforms.includes(comment.platform)) continue;
    if (ruleMatchesText(rule, comment.text)) return rule;
  }
  return null;
}

export function resolveCommentAutomationRules(
  catalog: CommentAutomationCatalog,
  tenantId: string,
  productCode: string
): CommentAutomationRule[] {
  return catalog.tenants?.[tenantId]?.products?.[productCode]?.commentAutomation?.rules ?? [];
}

export function resolveProductCodeForSocialAccount(
  catalog: CommentAutomationCatalog,
  platform: SocialPlatform,
  accountId: string
): ProductResolution[] {
  for (const [tenantId, tenant] of Object.entries(catalog.tenants || {})) {
    const accounts =
      platform === "facebook"
        ? tenant.socialAccounts?.facebookPages
        : tenant.socialAccounts?.instagramBusinessAccounts;
    const mapping = accounts?.[accountId];
    if (mapping) return mapping.productCodes.map((productCode) => ({ tenantId, productCode }));
  }
  return [];
}
