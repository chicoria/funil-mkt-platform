import { isSocialCommentEvent, type SocialCommentEvent } from "../../../packages/shared/src/social-comment-event";
import { runSocialChain, SocialChainError, type DispatcherEnv } from "./dispatcher";

interface QueueMessage<T> {
  body: T;
}

interface MessageBatch<T> {
  messages: Array<QueueMessage<T>>;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function logDispatch(data: Record<string, unknown>): void {
  console.log(JSON.stringify({ worker: "social-dispatcher", ...data }));
}

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") {
      return jsonResponse({ ok: true, worker: "social-dispatcher" }, 200);
    }
    return jsonResponse({ ok: false, error: "not_found" }, 404);
  },

  async queue(batch: MessageBatch<unknown>, env: DispatcherEnv): Promise<void> {
    for (const message of batch.messages) {
      if (!isSocialCommentEvent(message.body)) {
        logDispatch({ stage: "skip", reason: "invalid_social_comment_event" });
        continue;
      }

      const event = message.body as SocialCommentEvent;

      try {
        const result = await runSocialChain(event, env);
        logDispatch({
          stage: "processed",
          event_id: event.event_id,
          platform: event.platform,
          post_id: event.post_id,
          comment_id: event.comment_id,
          account_id: event.account_id,
          matched: result.matched,
          executed: result.executed,
          skipped: result.skipped,
        });
      } catch (err) {
        if (err instanceof SocialChainError) {
          logDispatch({
            stage: "error",
            event_id: event.event_id,
            platform: event.platform,
            post_id: event.post_id,
            comment_id: event.comment_id,
            account_id: event.account_id,
            matched: err.matched,
            executed: err.executed,
            skipped: err.skipped,
            error: err.message,
          });
        } else {
          logDispatch({
            stage: "error",
            event_id: event.event_id,
            platform: event.platform,
            post_id: event.post_id,
            comment_id: event.comment_id,
            account_id: event.account_id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        throw err;
      }
    }
  },
};
