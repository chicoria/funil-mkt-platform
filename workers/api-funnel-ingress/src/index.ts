import { fromAppEvent, fromBrowserTracking, fromPrecheckoutForm } from "../../../packages/shared/src/event-normalizer";
import { tryResolveTenantIdFromHostname } from "../../../packages/shared/src/tenant-from-hostname";
import bundledCatalog from "../../../config/products.catalog.json";
import type { FunnelEvent } from "../../../packages/shared/src/funnel-event";

interface QueueBinding {
  send(message: unknown): Promise<void>;
}

interface Env {
  FUNNEL_EVENTS?: QueueBinding;
  /** @deprecated APP_EVENTS_HMAC nunca foi usado pelo app Plano de Voo —
   *  o endpoint /webhooks/v1/planovoo/app/event nunca recebe chamadas da app.
   *  Remover em 2.11A.9 (Fase 4) junto com verifyAppSignature() e a rota. */
  APP_EVENTS_HMAC?: string;
  ALLOWED_ORIGINS?: string;
  DEFAULT_TENANT_ID?: string;
}

const KNOWN_TENANT_IDS = new Set(Object.keys(bundledCatalog.tenants || {}));

function withTenantId(event: FunnelEvent, request: Request, env: Env, payload: Record<string, unknown>): FunnelEvent {
  const hostname = new URL(request.url).hostname;
  const fromHostname = tryResolveTenantIdFromHostname(hostname, bundledCatalog);
  const candidate = typeof payload.tenant_id === "string" ? payload.tenant_id.trim() : "";
  const fromPayload = candidate && KNOWN_TENANT_IDS.has(candidate) ? candidate : undefined;
  event.tenant_id = fromHostname ?? fromPayload ?? env.DEFAULT_TENANT_ID ?? "decole";
  return event;
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isOriginAllowed(request: Request, env: Env): boolean {
  const origin = asString(request.headers.get("origin"));
  if (!origin) return true;
  const configured = parseAllowedOrigins(asString(env.ALLOWED_ORIGINS));
  if (!configured.length) return true;
  return configured.includes(origin);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = asString(request.headers.get("origin"));
  const configured = parseAllowedOrigins(asString(env.ALLOWED_ORIGINS));
  const allowOrigin =
    origin && configured.includes(origin) ? origin : configured[0] || "https://decolesuacarreiraesg.com.br";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-app-signature",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request, env);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function logIngress(data: Record<string, unknown>): void {
  console.log(JSON.stringify({ worker: "api-funnel-ingress", ...data }));
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

/** @deprecated Nunca chamado pelo app Plano de Voo. Remover em 2.11A.9. */
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

    if (request.method === "OPTIONS" && pathname.startsWith("/funnel/")) {
      if (!isOriginAllowed(request, env)) {
        logIngress({ stage: "preflight_blocked", pathname, status: 403 });
        return withCors(jsonResponse({ ok: false, error: "origin_not_allowed" }, 403), request, env);
      }
      logIngress({ stage: "preflight_ok", pathname, status: 204 });
      return withCors(new Response(null, { status: 204 }), request, env);
    }

    if (pathname === "/health") {
      return jsonResponse({ ok: true, worker: "api-funnel-ingress" }, 200);
    }

    if (request.method !== "POST") {
      return withCors(jsonResponse({ ok: false, error: "method_not_allowed" }, 405), request, env);
    }

    if (!env.FUNNEL_EVENTS) {
      logIngress({ stage: "error", pathname, error: "queue_not_configured", status: 500 });
      return withCors(jsonResponse({ ok: false, error: "queue_not_configured" }, 500), request, env);
    }

    if (pathname.startsWith("/funnel/") && !isOriginAllowed(request, env)) {
      logIngress({ stage: "blocked", pathname, error: "origin_not_allowed", status: 403 });
      return withCors(jsonResponse({ ok: false, error: "origin_not_allowed" }, 403), request, env);
    }

    const payload = await parseBody(request);

    if (pathname === "/funnel/precheckout") {
      const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "";
      if (clientIp) payload.client_ip = clientIp;
      const event = withTenantId(fromPrecheckoutForm(payload, productCodeFromBody(payload, "UNKNOWN_PRODUCT")), request, env, payload);
      await env.FUNNEL_EVENTS.send(event);
      logIngress({
        stage: "queued",
        pathname,
        tenant_id: event.tenant_id,
        event_id: event.event_id,
        event_type: event.event_type,
        product_code: event.product_code,
        status: 202,
      });
      return withCors(jsonResponse({ ok: true, event_id: event.event_id, event_type: event.event_type }, 202), request, env);
    }

    if (pathname === "/funnel/event") {
      const event = withTenantId(fromBrowserTracking(payload, productCodeFromBody(payload, "UNKNOWN_PRODUCT")), request, env, payload);
      await env.FUNNEL_EVENTS.send(event);
      logIngress({
        stage: "queued",
        pathname,
        tenant_id: event.tenant_id,
        event_id: event.event_id,
        event_type: event.event_type,
        product_code: event.product_code,
        status: 202,
      });
      return withCors(jsonResponse({ ok: true, event_id: event.event_id, event_type: event.event_type }, 202), request, env);
    }

    // @deprecated: app Plano de Voo nunca chama este endpoint (não envia eventos ao funil).
    // APP_EVENTS_HMAC, verifyAppSignature() e esta rota programados para remoção em 2.11A.9.
    if (pathname === "/webhooks/v1/planovoo/app/event") {
      if (!verifyAppSignature(request, env)) {
        logIngress({ stage: "blocked", pathname, error: "unauthorized", status: 401 });
        return withCors(jsonResponse({ ok: false, error: "unauthorized" }, 401), request, env);
      }
      const event = withTenantId(fromAppEvent(payload, productCodeFromBody(payload, "DECOLE_PLANOVOO")), request, env, payload);
      await env.FUNNEL_EVENTS.send(event);
      logIngress({
        stage: "queued",
        pathname,
        tenant_id: event.tenant_id,
        event_id: event.event_id,
        event_type: event.event_type,
        product_code: event.product_code,
        status: 202,
      });
      return withCors(jsonResponse({ ok: true, event_id: event.event_id, event_type: event.event_type }, 202), request, env);
    }

    return withCors(jsonResponse({ ok: false, error: "not_found" }, 404), request, env);
  },
};
