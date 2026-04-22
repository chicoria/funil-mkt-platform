import { isFunnelEvent, FunnelEvent } from "../../../packages/shared/src/funnel-event";
import { DispatcherEnv, runChain } from "./dispatcher";
import { createHandlers } from "./handlers";

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

const handlers = createHandlers();

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") {
      return jsonResponse({ ok: true, worker: "funnel-dispatcher" }, 200);
    }
    return jsonResponse({ ok: false, error: "not_found" }, 404);
  },

  async queue(batch: MessageBatch<unknown>, env: DispatcherEnv): Promise<void> {
    for (const message of batch.messages) {
      if (!isFunnelEvent(message.body)) {
        console.log(JSON.stringify({ stage: "skip", reason: "invalid_funnel_event" }));
        continue;
      }

      const event = message.body as FunnelEvent;
      const result = await runChain(event, env, handlers);
      console.log(
        JSON.stringify({
          stage: "processed",
          event_id: event.event_id,
          event_type: event.event_type,
          executed_handlers: result.executed,
          skipped_handlers: result.skipped,
        })
      );
    }
  },
};
