import { fromAppEvent, fromBrowserTracking, fromPrecheckoutForm } from "../../../packages/shared/src/event-normalizer";

interface QueueBinding {
  send(message: unknown): Promise<void>;
}

interface Env {
  FUNNEL_EVENTS?: QueueBinding;
  APP_EVENTS_HMAC?: string;
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

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = asString(request.headers.get("content-type")).toLowerCase();

  if (contentType.includes("application/json")) {
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const payload: Record<string, unknown> = {};
    formData.forEach((value, key) => {
      payload[key] = typeof value === "string" ? value : value.name;
    });
    return payload;
  }

  return {};
}

function verifyAppSignature(request: Request, env: Env): boolean {
  const required = asString(env.APP_EVENTS_HMAC);
  if (!required) return true;
  const provided = asString(request.headers.get("x-app-signature"));
  return provided === required;
}

function productCodeFromBody(payload: Record<string, unknown>, fallback: string): string {
  const candidates = [payload.product_code, payload.productCode, payload.produto, payload.PRODUCT_CODE]
    .map((v) => asString(v))
    .filter(Boolean);
  return (candidates[0] || fallback).toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") {
      return jsonResponse({ ok: true, worker: "api-funnel-ingress" }, 200);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
    }

    if (!env.FUNNEL_EVENTS) {
      return jsonResponse({ ok: false, error: "queue_not_configured" }, 500);
    }

    const payload = await parseBody(request);

    if (pathname === "/funnel/precheckout") {
      const event = fromPrecheckoutForm(payload, productCodeFromBody(payload, "UNKNOWN_PRODUCT"));
      await env.FUNNEL_EVENTS.send(event);
      return jsonResponse({ ok: true, event_id: event.event_id, event_type: event.event_type }, 202);
    }

    if (pathname === "/funnel/event") {
      const event = fromBrowserTracking(payload, productCodeFromBody(payload, "UNKNOWN_PRODUCT"));
      await env.FUNNEL_EVENTS.send(event);
      return jsonResponse({ ok: true, event_id: event.event_id, event_type: event.event_type }, 202);
    }

    if (pathname === "/webhooks/v1/planovoo/app/event") {
      if (!verifyAppSignature(request, env)) {
        return jsonResponse({ ok: false, error: "unauthorized" }, 401);
      }
      const event = fromAppEvent(payload, productCodeFromBody(payload, "DECOLE_PLANOVOO"));
      await env.FUNNEL_EVENTS.send(event);
      return jsonResponse({ ok: true, event_id: event.event_id, event_type: event.event_type }, 202);
    }

    return jsonResponse({ ok: false, error: "not_found" }, 404);
  },
};
