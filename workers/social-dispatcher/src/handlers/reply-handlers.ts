import { replyToComment, sendDirectMessage } from "../../../../packages/shared/src/social-send";
import { resolveSecret, type SecretValue } from "../../../../packages/shared/src/secrets-store-wrapper";
import type { SocialCommentEvent } from "../../../../packages/shared/src/social-comment-event";
import { resolveReplyText, type CommentAutomationRule } from "../../../../packages/shared/src/comment-automation";
import { getCatalog, type DispatcherEnv } from "../env";

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

const GRAPH = "https://graph.facebook.com/v21.0";

const pageTokenCache = new Map<string, string>();

export function clearPageTokenCache(): void {
  pageTokenCache.clear();
}

async function getPageAccessToken(pageId: string, systemToken: string, fetchImpl: typeof fetch): Promise<string> {
  const cacheKey = `${pageId}:${systemToken.slice(-8)}`;
  const cached = pageTokenCache.get(cacheKey);
  if (cached) return cached;

  const url = `${GRAPH}/${pageId}?fields=access_token&access_token=${systemToken}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Failed to get page access token for ${pageId}: ${await res.text()}`);
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error(`No page access token returned for page ${pageId}`);
  pageTokenCache.set(cacheKey, data.access_token);
  return data.access_token;
}

async function resolveAccessToken(
  event: SocialCommentEvent,
  env: DispatcherEnv,
  fetchImpl: typeof fetch
): Promise<string> {
  const catalog = getCatalog(env);
  const tenant = catalog.tenants?.[event.tenant_id];
  const envName = asString(tenant?.credentials?.meta_access_token_env);
  if (!envName) {
    throw new Error(`missing tenant.credentials.meta_access_token_env for tenant ${event.tenant_id}`);
  }
  const systemToken = await resolveSecret(env[envName] as SecretValue, envName);

  // NPE (New Page Experience) pages reject System User Tokens — exchange for Page Access Token
  if (event.platform === "facebook" && event.account_id) {
    return getPageAccessToken(event.account_id, systemToken, fetchImpl);
  }
  return systemToken;
}

export async function replyToCommentHandler(
  event: SocialCommentEvent,
  rule: CommentAutomationRule,
  env: DispatcherEnv,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const accessToken = await resolveAccessToken(event, env, fetchImpl);
  await replyToComment({
    platform: event.platform,
    commentId: event.comment_id,
    message: rule.publicReply ? resolveReplyText(rule.publicReply, event.platform) : "",
    accessToken,
    fetchImpl,
  });
}

export async function sendPrivateReplyHandler(
  event: SocialCommentEvent,
  rule: CommentAutomationRule,
  env: DispatcherEnv,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const accessToken = await resolveAccessToken(event, env, fetchImpl);
  await sendDirectMessage({
    platform: event.platform,
    commentId: event.comment_id,
    message: rule.privateReply ? resolveReplyText(rule.privateReply, event.platform) : "",
    accessToken,
    fetchImpl,
  });
}
