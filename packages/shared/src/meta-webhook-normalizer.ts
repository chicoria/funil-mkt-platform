import { SocialCommentEvent, SocialPlatform } from "./social-comment-event";

export interface ProductResolution {
  tenantId: string;
  productCode: string;
}

export type ResolveProductCode = (
  platform: SocialPlatform,
  accountId: string
) => ProductResolution[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function buildEvent(
  platform: SocialPlatform,
  accountId: string,
  resolution: ProductResolution,
  commentId: string,
  text: string,
  fromId: string,
  fromUsername: string | undefined,
  postId: string | undefined,
  createdAtSeconds: unknown,
  rawChangeValue: Record<string, unknown>
): SocialCommentEvent {
  const occurredAt =
    typeof createdAtSeconds === "number"
      ? new Date(createdAtSeconds * 1000).toISOString()
      : new Date().toISOString();

  return {
    event_id: `${platform}_${commentId}_${resolution.productCode}`,
    event_type: "SOCIAL_COMMENT_RECEIVED",
    tenant_id: resolution.tenantId,
    product_code: resolution.productCode,
    platform,
    comment_id: commentId,
    post_id: postId || undefined,
    text,
    from_id: fromId,
    from_username: fromUsername || undefined,
    account_id: accountId,
    occurred_at: occurredAt,
    payload: rawChangeValue,
  };
}

function fromFacebookEntries(
  entries: unknown[],
  resolveProductCode: ResolveProductCode
): SocialCommentEvent[] {
  const events: SocialCommentEvent[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const accountId = asString(entry.id);
    if (!accountId) continue;
    const changes = entry.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      if (!isRecord(change) || change.field !== "feed") continue;
      const value = change.value;
      if (!isRecord(value)) continue;
      if (value.item !== "comment" || value.verb === "remove") continue;

      const commentId = asString(value.comment_id);
      if (!commentId) continue;
      const resolutions = resolveProductCode("facebook", accountId);
      if (resolutions.length === 0) continue;

      const from = isRecord(value.from) ? value.from : {};
      for (const resolution of resolutions) {
        events.push(
          buildEvent(
            "facebook",
            accountId,
            resolution,
            commentId,
            asString(value.message),
            asString(from.id),
            asString(from.name) || undefined,
            asString(value.post_id) || undefined,
            value.created_time,
            value
          )
        );
      }
    }
  }

  return events;
}

function fromInstagramEntries(
  entries: unknown[],
  resolveProductCode: ResolveProductCode
): SocialCommentEvent[] {
  const events: SocialCommentEvent[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const accountId = asString(entry.id);
    if (!accountId) continue;
    const changes = entry.changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      if (!isRecord(change) || change.field !== "comments") continue;
      const value = change.value;
      if (!isRecord(value)) continue;

      const commentId = asString(value.id);
      if (!commentId) continue;
      const resolutions = resolveProductCode("instagram", accountId);
      if (resolutions.length === 0) continue;

      const from = isRecord(value.from) ? value.from : {};
      const media = isRecord(value.media) ? value.media : {};
      for (const resolution of resolutions) {
        events.push(
          buildEvent(
            "instagram",
            accountId,
            resolution,
            commentId,
            asString(value.text),
            asString(from.id),
            asString(from.username) || undefined,
            asString(media.id) || undefined,
            undefined,
            value
          )
        );
      }
    }
  }

  return events;
}

/**
 * Normaliza um payload de webhook da Meta (Facebook Page ou Instagram
 * Business Account) em eventos de comentário. Nomes de campo confirmados
 * contra a Graph API v21.0 em 2026-06-22 — revalidar se a Meta mudar o
 * shape do webhook `feed`/`comments`.
 */
export function fromMetaWebhookPayload(
  payload: unknown,
  resolveProductCode: ResolveProductCode
): SocialCommentEvent[] {
  if (!isRecord(payload)) return [];
  const entries = payload.entry;
  if (!Array.isArray(entries)) return [];

  if (payload.object === "page") return fromFacebookEntries(entries, resolveProductCode);
  if (payload.object === "instagram") return fromInstagramEntries(entries, resolveProductCode);
  return [];
}
