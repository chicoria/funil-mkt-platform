import type { SocialCommentEvent } from "../../../packages/shared/src/social-comment-event";
import { matchCommentRuleForEvent } from "./handlers/match-comment-rule";
import { replyToCommentHandler, sendPrivateReplyHandler } from "./handlers/reply-handlers";
import { getCatalog, type DispatcherEnv } from "./env";

export type { DispatcherEnv, DispatcherCatalog } from "./env";

export const SOCIAL_DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 7;

type StepName = "reply_to_comment" | "send_private_reply";

export interface ChainResult {
  matched: boolean;
  executed: string[];
  skipped: string[];
}

export class SocialChainError extends Error {
  matched: boolean;
  executed: string[];
  skipped: string[];

  constructor(message: string, result: ChainResult) {
    super(message);
    this.name = "SocialChainError";
    this.matched = result.matched;
    this.executed = result.executed;
    this.skipped = result.skipped;
  }
}

function dedupeKeyFor(event: SocialCommentEvent, step: StepName): string {
  return `${event.tenant_id}:${event.product_code}:${event.event_id}:${step}`;
}

async function runDedupedStep(
  step: StepName,
  event: SocialCommentEvent,
  env: DispatcherEnv,
  executed: string[],
  skipped: string[],
  errors: Error[],
  run: () => Promise<void>
): Promise<void> {
  const kv = env.SOCIAL_DEDUPE_KV;
  if (!kv) throw new Error("social_dedupe_kv_not_configured");

  const dedupeKey = dedupeKeyFor(event, step);
  const existing = await kv.get(dedupeKey);
  if (existing) {
    skipped.push(step);
    return;
  }

  try {
    await run();
    await kv.put(dedupeKey, "1", { expirationTtl: SOCIAL_DEDUPE_TTL_SECONDS });
    executed.push(step);
  } catch (err) {
    errors.push(err instanceof Error ? err : new Error(String(err)));
  }
}

export async function runSocialChain(
  event: SocialCommentEvent,
  env: DispatcherEnv,
  fetchImpl: typeof fetch = fetch
): Promise<ChainResult> {
  if (!env.SOCIAL_DEDUPE_KV) {
    throw new Error("social_dedupe_kv_not_configured");
  }

  const catalog = getCatalog(env);
  const matchedRule = matchCommentRuleForEvent(event, catalog);
  if (!matchedRule) {
    return { matched: false, executed: [], skipped: [] };
  }

  const executed: string[] = [];
  const skipped: string[] = [];
  const errors: Error[] = [];

  if (matchedRule.publicReply?.enabled) {
    await runDedupedStep("reply_to_comment", event, env, executed, skipped, errors, () =>
      replyToCommentHandler(event, matchedRule, env, fetchImpl)
    );
  }

  if (matchedRule.privateReply?.enabled) {
    await runDedupedStep("send_private_reply", event, env, executed, skipped, errors, () =>
      sendPrivateReplyHandler(event, matchedRule, env, fetchImpl)
    );
  }

  const result: ChainResult = { matched: true, executed, skipped };

  if (errors.length) {
    throw new SocialChainError(
      `social_dispatcher: ${errors.length} step(s) failed — ${errors.map((e) => e.message).join("; ")}`,
      result
    );
  }

  return result;
}
