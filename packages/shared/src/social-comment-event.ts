export type SocialPlatform = "facebook" | "instagram";

export interface SocialCommentEvent {
  event_id: string;
  event_type: "SOCIAL_COMMENT_RECEIVED";
  tenant_id: string;
  product_code: string;
  platform: SocialPlatform;
  comment_id: string;
  post_id?: string;
  text: string;
  from_id: string;
  from_username?: string;
  account_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

const VALID_PLATFORMS: SocialPlatform[] = ["facebook", "instagram"];

export function isSocialCommentEvent(value: unknown): value is SocialCommentEvent {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.event_id === "string" &&
    data.event_type === "SOCIAL_COMMENT_RECEIVED" &&
    typeof data.tenant_id === "string" &&
    typeof data.product_code === "string" &&
    typeof data.platform === "string" &&
    VALID_PLATFORMS.includes(data.platform as SocialPlatform) &&
    typeof data.comment_id === "string" &&
    typeof data.text === "string" &&
    typeof data.from_id === "string" &&
    typeof data.account_id === "string" &&
    typeof data.occurred_at === "string" &&
    !!data.payload &&
    typeof data.payload === "object"
  );
}
