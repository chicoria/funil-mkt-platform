import { fromHotmartWebhook } from "../../../packages/shared/src/event-normalizer";

interface QueueBinding {
  send(message: unknown): Promise<void>;
}

interface Env {
  FUNNEL_EVENTS?: QueueBinding;
  HOTMART_WEBHOOK_TOKEN?: string;
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parsePath(pathname: string): { ok: boolean; productSlug: string; operation: string } {
  const parts = pathname.replace(/^\/+|\/+$/g, "").toLowerCase().split("/").filter(Boolean);
  if (parts.length !== 5 || parts[0] !== "webhooks" || parts[1] !== "v1" || parts[3] !== "hotmart") {
    return { ok: false, productSlug: "", operation: "" };
  }
  return { ok: true, productSlug: parts[2], operation: parts[4] };
}

function tokenFromRequest(request: Request): string[] {
  const url = new URL(request.url);
  const auth = asString(request.headers.get("authorization"));
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  return [
    asString(request.headers.get("x-hotmart-hottok")),
    asString(request.headers.get("x-hotmart-token")),
    asString(request.headers.get("x-webhook-token")),
    asString(url.searchParams.get("hottok")),
    asString(url.searchParams.get("token")),
    asString(bearer),
  ].filter(Boolean);
}

function isAuthorized(request: Request, env: Env): boolean {
  const required = asString(env.HOTMART_WEBHOOK_TOKEN);
  if (!required) return true;
  return tokenFromRequest(request).some((candidate) => candidate === required);
}

function productCodeFromSlug(slug: string): string {
  if (slug === "decole-esg") return "DECOLE_ESG_MENTORIA";
  if (slug === "planodevoo" || slug === "plano-de-voo") return "DECOLE_PLANOVOO";
  return slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const payload = await request.json();
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") {
      return jsonResponse({ ok: true, worker: "api-hotmart-ingress" }, 200);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
    }

    const parsed = parsePath(pathname);
    if (!parsed.ok) {
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }

    if (!isAuthorized(request, env)) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    if (!env.FUNNEL_EVENTS) {
      return jsonResponse({ ok: false, error: "queue_not_configured" }, 500);
    }

    const raw = await parseBody(request);
    const fallbackEventType = parsed.operation.toUpperCase().replace(/-/g, "_");
    if (!asString(raw.event) && !asString(raw.event_name) && !asString(raw.type) && !asString(raw.name)) {
      raw.event = fallbackEventType;
    }

    const normalized = fromHotmartWebhook(raw, productCodeFromSlug(parsed.productSlug));
    await env.FUNNEL_EVENTS.send(normalized);

    return jsonResponse({ ok: true, event_id: normalized.event_id, event_type: normalized.event_type }, 202);
  },
};
