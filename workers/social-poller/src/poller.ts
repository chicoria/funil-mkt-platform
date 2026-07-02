import type { SocialCommentEvent, SocialPlatform } from "../../../packages/shared/src/social-comment-event";
import type { CommentAutomationCatalog } from "../../../packages/shared/src/comment-automation";
import { resolveProductCodeForSocialAccount } from "../../../packages/shared/src/comment-automation";
import { resolveSecret, type SecretValue } from "../../../packages/shared/src/secrets-store-wrapper";

export interface PollerEnv {
  SOCIAL_DEDUPE_KV: KVNamespace;
  SOCIAL_EVENTS: Queue<SocialCommentEvent>;
  // One binding per tenant: META_SYSTEM_USER_ACCESS_TOKEN_<TENANT_ID_UPPERCASE>
  [key: string]: unknown;
}

const GRAPH = "https://graph.facebook.com/v19.0";
const KV_TTL_SECONDS = 7 * 24 * 3600;
// Lookback slightly wider than the cron interval to avoid gaps between runs
const LOOKBACK_SECONDS = 6 * 60; // 6 minutes

async function tenantToken(env: PollerEnv, tenantId: string): Promise<string> {
  const key = `META_SYSTEM_USER_ACCESS_TOKEN_${tenantId.toUpperCase()}`;
  return resolveSecret(env[key] as SecretValue, key);
}

function dedupeKey(platform: SocialPlatform, commentId: string): string {
  return `seen:${platform}:${commentId}`;
}

async function isSeen(kv: KVNamespace, platform: SocialPlatform, commentId: string): Promise<boolean> {
  return (await kv.get(dedupeKey(platform, commentId))) !== null;
}

async function markSeen(kv: KVNamespace, platform: SocialPlatform, commentId: string): Promise<void> {
  await kv.put(dedupeKey(platform, commentId), "1", { expirationTtl: KV_TTL_SECONDS });
}

function log(data: Record<string, unknown>): void {
  console.log(JSON.stringify({ worker: "social-poller", ...data }));
}

async function graphGet(path: string, token: string, params: Record<string, string> = {}): Promise<unknown> {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Graph API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// NPE (New Page Experience) pages require a Page Access Token, not a System User Token.
async function getPageAccessToken(pageId: string, systemUserToken: string): Promise<string> {
  const data = await graphGet(pageId, systemUserToken, { fields: "access_token" }) as { access_token?: string };
  if (!data.access_token) throw new Error(`No page access token returned for page ${pageId}`);
  return data.access_token;
}

function buildEvent(
  platform: SocialPlatform,
  accountId: string,
  tenantId: string,
  productCode: string,
  commentId: string,
  postId: string,
  text: string,
  fromId: string,
  fromUsername: string | undefined,
  occurredAt: string,
  raw: unknown
): SocialCommentEvent {
  return {
    event_id: `${platform}_${commentId}_${productCode}`,
    event_type: "SOCIAL_COMMENT_RECEIVED",
    tenant_id: tenantId,
    product_code: productCode,
    platform,
    comment_id: commentId,
    post_id: postId,
    text,
    from_id: fromId,
    from_username: fromUsername,
    account_id: accountId,
    occurred_at: occurredAt,
    payload: raw as Record<string, unknown>,
  };
}

export async function pollFacebookPage(
  pageId: string,
  token: string,
  catalog: CommentAutomationCatalog,
  env: PollerEnv
): Promise<void> {
  const sinceMs = Date.now() - LOOKBACK_SECONDS * 1000;
  const pageToken = await getPageAccessToken(pageId, token);
  const data = await graphGet(`${pageId}/feed`, pageToken, {
    fields: "id,comments{id,message,from,created_time}",
    limit: "10",
  }) as { data?: Array<{ id: string; comments?: { data: Array<{ id: string; message: string; from?: { id: string; name?: string }; created_time: string }> } }> };

  for (const post of data.data ?? []) {
    for (const comment of post.comments?.data ?? []) {
      if (new Date(comment.created_time).getTime() < sinceMs) continue;
      if (await isSeen(env.SOCIAL_DEDUPE_KV, "facebook", comment.id)) continue;

      const resolutions = resolveProductCodeForSocialAccount(catalog, "facebook", pageId);
      if (resolutions.length === 0) {
        log({ stage: "skip", reason: "no_product_mapping", platform: "facebook", account_id: pageId });
        await markSeen(env.SOCIAL_DEDUPE_KV, "facebook", comment.id);
        continue;
      }

      for (const { tenantId, productCode } of resolutions) {
        const event = buildEvent(
          "facebook", pageId, tenantId, productCode,
          comment.id, post.id, comment.message ?? "",
          comment.from?.id ?? "", comment.from?.name,
          comment.created_time, comment
        );
        await env.SOCIAL_EVENTS.send(event);
        log({ stage: "enqueued", event_id: event.event_id });
      }
      await markSeen(env.SOCIAL_DEDUPE_KV, "facebook", comment.id);
    }
  }
}

export async function pollInstagramAccount(
  igUserId: string,
  token: string,
  catalog: CommentAutomationCatalog,
  env: PollerEnv
): Promise<void> {
  const sinceMs = Date.now() - LOOKBACK_SECONDS * 1000;
  const data = await graphGet(`${igUserId}/media`, token, {
    fields: "id,comments{id,text,from,timestamp}",
    limit: "10",
  }) as { data?: Array<{ id: string; comments?: { data: Array<{ id: string; text: string; from?: { id: string; username?: string }; timestamp: string }> } }> };

  for (const media of data.data ?? []) {
    for (const comment of media.comments?.data ?? []) {
      if (new Date(comment.timestamp).getTime() < sinceMs) continue;
      if (await isSeen(env.SOCIAL_DEDUPE_KV, "instagram", comment.id)) continue;

      const resolutions = resolveProductCodeForSocialAccount(catalog, "instagram", igUserId);
      if (resolutions.length === 0) {
        log({ stage: "skip", reason: "no_product_mapping", platform: "instagram", account_id: igUserId });
        await markSeen(env.SOCIAL_DEDUPE_KV, "instagram", comment.id);
        continue;
      }

      for (const { tenantId, productCode } of resolutions) {
        const event = buildEvent(
          "instagram", igUserId, tenantId, productCode,
          comment.id, media.id, comment.text ?? "",
          comment.from?.id ?? "", comment.from?.username,
          comment.timestamp, comment
        );
        await env.SOCIAL_EVENTS.send(event);
        log({ stage: "enqueued", event_id: event.event_id });
      }
      await markSeen(env.SOCIAL_DEDUPE_KV, "instagram", comment.id);
    }
  }
}

export async function runPoller(catalog: CommentAutomationCatalog, env: PollerEnv): Promise<void> {
  const tasks: Promise<void>[] = [];

  for (const [tenantId, tenant] of Object.entries(catalog.tenants ?? {})) {
    let token: string;
    try {
      token = await tenantToken(env, tenantId);
    } catch {
      log({ stage: "skip_tenant", reason: "missing_token", tenant_id: tenantId });
      continue;
    }

    const fbPages = Object.keys(tenant.socialAccounts?.facebookPages ?? {});
    const igAccounts = Object.keys(tenant.socialAccounts?.instagramBusinessAccounts ?? {});

    tasks.push(
      ...fbPages.map((id) => pollFacebookPage(id, token, catalog, env)),
      ...igAccounts.map((id) => pollInstagramAccount(id, token, catalog, env)),
    );
  }

  await Promise.all(tasks);
}
