import type { SocialCommentEvent } from "../../../packages/shared/src/social-comment-event";
import { resolveSecret, type SecretValue } from "../../../packages/shared/src/secrets-store-wrapper";
import { MetaGraphSocialResponder } from "../../../packages/shared/src/meta-graph-social-responder";
import { ZernioSocialResponder } from "../../../packages/shared/src/zernio-social-responder";
import { resolveSocialResponderProvider } from "../../../packages/shared/src/social-responder-selection";
import { resolveZernioAccountId, type CommentAutomationCatalog } from "../../../packages/shared/src/comment-automation";
import type { SocialCommentResponder } from "../../../packages/shared/src/social-respond";
import { matchCommentRuleForEvent } from "./handlers/match-comment-rule";
import { replyToCommentHandler, sendPrivateReplyHandler } from "./handlers/reply-handlers";
import { getCatalog, type DispatcherEnv } from "./env";

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

interface ResolvedResponder {
  responder: SocialCommentResponder;
  /**
   * accountId a usar nas chamadas ao responder — semântica depende do
   * provider: pra Meta é o pageId/IG account id do Graph API (usado pra
   * troca de Page Access Token); pra Zernio é o accountId INTERNO da
   * Zernio (formato deles, ex.: ObjectId hex), nunca o ID do Meta — a
   * Zernio rejeita o ID do Meta com 400 "Invalid accountId format" (bug
   * real de produção, decole, 2026-07-10). Resolvido via
   * `resolveZernioAccountId` a partir de `tenant.socialAccounts`.
   */
  accountId: string;
}

/**
 * Constrói o SocialCommentResponder certo pro evento — Meta ou Zernio,
 * conforme resolveSocialResponderProvider (default Zernio nas duas
 * plataformas; override por produto via
 * commentAutomation.responderProvider no catálogo). Credencial sempre
 * resolvida por tenant (nunca um nome de secret fixo) — cada tenant tem
 * sua própria Zernio API key/conta.
 */
async function resolveResponder(
  event: SocialCommentEvent,
  env: DispatcherEnv,
  fetchImpl: typeof fetch
): Promise<ResolvedResponder> {
  const catalog = getCatalog(env);
  const tenant = catalog.tenants?.[event.tenant_id];
  const overrides = tenant?.products?.[event.product_code]?.commentAutomation?.responderProvider;
  const provider = resolveSocialResponderProvider(event.platform, overrides);

  if (provider === "zernio") {
    const envName = asString(tenant?.credentials?.zernio_api_key_env);
    if (!envName) {
      throw new Error(`missing tenant.credentials.zernio_api_key_env for tenant ${event.tenant_id}`);
    }
    const apiKey = await resolveSecret(env[envName] as SecretValue, envName);
    const zernioAccountId = resolveZernioAccountId(
      catalog as unknown as CommentAutomationCatalog,
      event.tenant_id,
      event.platform,
      event.account_id
    );
    if (!zernioAccountId) {
      throw new Error(
        `missing zernioAccountId in catalog.tenants.${event.tenant_id}.socialAccounts for platform ${event.platform} account ${event.account_id} — connect the account in Zernio and set socialAccounts.*.zernioAccountId`
      );
    }
    return { responder: new ZernioSocialResponder(apiKey, fetchImpl), accountId: zernioAccountId };
  }

  const envName = asString(tenant?.credentials?.meta_access_token_env);
  if (!envName) {
    throw new Error(`missing tenant.credentials.meta_access_token_env for tenant ${event.tenant_id}`);
  }
  const systemToken = await resolveSecret(env[envName] as SecretValue, envName);
  return { responder: new MetaGraphSocialResponder(systemToken, fetchImpl), accountId: event.account_id };
}

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

  if (matchedRule.publicReply?.enabled || matchedRule.privateReply?.enabled) {
    let responder: SocialCommentResponder;
    let accountId: string;
    try {
      ({ responder, accountId } = await resolveResponder(event, env, fetchImpl));
    } catch (err) {
      // Erro de resolução de credencial/provider precisa virar SocialChainError
      // (não um Error genérico) — index.ts loga matched/executed/skipped só
      // quando `err instanceof SocialChainError` (ver index.ts:52-58).
      throw new SocialChainError(
        `social_dispatcher: failed to resolve responder — ${err instanceof Error ? err.message : String(err)}`,
        { matched: true, executed: [], skipped: [] }
      );
    }

    if (matchedRule.publicReply?.enabled) {
      await runDedupedStep("reply_to_comment", event, env, executed, skipped, errors, () =>
        replyToCommentHandler(event, matchedRule, responder, accountId)
      );
    }

    if (matchedRule.privateReply?.enabled) {
      await runDedupedStep("send_private_reply", event, env, executed, skipped, errors, () =>
        sendPrivateReplyHandler(event, matchedRule, responder, accountId)
      );
    }
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
