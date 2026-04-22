import { isFunnelEvent, FunnelEvent } from "../../../packages/shared/src/funnel-event";
import { DispatcherEnv, runChain } from "./dispatcher";

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

const handlers = {
  async resolve_identity(event: FunnelEvent): Promise<void> {
    console.log(JSON.stringify({ stage: "handler", handler: "resolve_identity", event_id: event.event_id }));
  },
  async upsert_event_store(event: FunnelEvent): Promise<void> {
    console.log(JSON.stringify({ stage: "handler", handler: "upsert_event_store", event_id: event.event_id }));
  },
  async send_brevo_doi(event: FunnelEvent): Promise<void> {
    console.log(JSON.stringify({ stage: "handler", handler: "send_brevo_doi", event_id: event.event_id }));
  },
  async update_brevo_funnel(event: FunnelEvent): Promise<void> {
    console.log(JSON.stringify({ stage: "handler", handler: "update_brevo_funnel", event_id: event.event_id }));
  },
  async send_cart_abandonment_email(event: FunnelEvent): Promise<void> {
    console.log(JSON.stringify({ stage: "handler", handler: "send_cart_abandonment_email", event_id: event.event_id }));
  },
  async forward_n8n(event: FunnelEvent): Promise<void> {
    console.log(JSON.stringify({ stage: "handler", handler: "forward_n8n", event_id: event.event_id }));
  },
  async emit_tracking(event: FunnelEvent): Promise<void> {
    console.log(JSON.stringify({ stage: "handler", handler: "emit_tracking", event_id: event.event_id }));
  },
  async sync_brevo_segments(event: FunnelEvent): Promise<void> {
    console.log(JSON.stringify({ stage: "handler", handler: "sync_brevo_segments", event_id: event.event_id }));
  },
};

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
