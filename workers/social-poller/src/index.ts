import type { CommentAutomationCatalog } from "../../../packages/shared/src/comment-automation";
import { runPoller, type PollerEnv } from "./poller";

// eslint-disable-next-line @typescript-eslint/no-var-requires
import catalog from "../../../config/products.catalog.json";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(_request: Request, _env: PollerEnv): Promise<Response> {
    return jsonResponse({ ok: true, worker: "social-poller" }, 200);
  },

  async scheduled(_event: ScheduledEvent, env: PollerEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPoller(catalog as unknown as CommentAutomationCatalog, env));
  },
};
