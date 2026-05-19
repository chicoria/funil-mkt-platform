import { fromAppEvent, fromBrowserTracking, fromPrecheckoutForm } from "../../../packages/shared/src/event-normalizer";
import { resolveSecret, type SecretValue } from "../../../packages/shared/src/secrets-store-wrapper";
import { tryResolveTenantIdFromHostname } from "../../../packages/shared/src/tenant-from-hostname";
import {
  getTenantAllowedOrigins,
  type CatalogV5,
  type CatalogV5AppWebhook,
  type CatalogV5Integration,
} from "../../../packages/shared/src/catalog-v5";
import bundledCatalog from "../../../config/products.catalog.json";
import type { FunnelEvent } from "../../../packages/shared/src/funnel-event";

interface QueueBinding {
  send(message: unknown): Promise<void>;
}

interface Env {
  FUNNEL_EVENTS?: QueueBinding;
  CATALOG_JSON?: string;
  [key: string]: unknown;
}

interface ResolvedAppWebhook {
  webhook: CatalogV5AppWebhook;
  integration: CatalogV5Integration;
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function logIngress(data: Record<string, unknown>): void {
  console.log(JSON.stringify({ worker: "api-funnel-ingress", ...data }));
}

function getCatalog(env: Env): CatalogV5 {
  const raw = asString(env.CATALOG_JSON);
  if (!raw) return bundledCatalog as CatalogV5;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as CatalogV5;
    }
  } catch {
    logIngress({ stage: "warn", error: "catalog_json_invalid" });
  }
  return bundledCatalog as CatalogV5;
}

function resolveTenantId(request: Request, catalog: CatalogV5, payload?: Record<string, unknown>): string | undefined {
  const hostname = new URL(request.url).hostname;
  const fromHostname = tryResolveTenantIdFromHostname(hostname, catalog);
  if (fromHostname) return fromHostname;

  const candidate = typeof payload?.tenant_id === "string" ? payload.tenant_id.trim() : "";
  if (candidate && catalog.tenants?.[candidate]) return candidate;
  return undefined;
}

function withTenantId(event: FunnelEvent, tenantId: string): FunnelEvent {
  event.tenant_id = tenantId;
  return event;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isOriginAllowed(request: Request, catalog: CatalogV5, tenantId: string): boolean {
  const origin = asString(request.headers.get("origin"));
  if (!origin) return true;
  return getTenantAllowedOrigins(catalog, tenantId).includes(origin);
}

function corsHeaders(request: Request, catalog: CatalogV5, tenantId?: string): Record<string, string> {
  const origin = asString(request.headers.get("origin"));
  const headers: Record<string, string> = {
    "access-control-allow-methods": "POST, OPTIONS",
    // Header de protocolo comum; só integrações com appWebhook.requiresHmac validam x-app-signature.
    "access-control-allow-headers": "content-type, x-app-signature",
    "access-control-max-age": "86400",
    vary: "Origin",
  };

  if (origin && tenantId && getTenantAllowedOrigins(catalog, tenantId).includes(origin)) {
    headers["access-control-allow-origin"] = origin;
  }

  return headers;
}

function withCors(response: Response, request: Request, catalog: CatalogV5, tenantId?: string): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request, catalog, tenantId);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
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

function productCodeFromBody(payload: Record<string, unknown>, fallback: string): string {
  const candidates = [payload.product_code, payload.productCode, payload.produto, payload.PRODUCT_CODE]
    .map((v) => asString(v))
    .filter(Boolean);
  return (candidates[0] || fallback).toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
}

function findAppWebhook(catalog: CatalogV5, tenantId: string, pathname: string): ResolvedAppWebhook | undefined {
  const tenant = catalog.tenants?.[tenantId];
  if (!tenant?.integrations) return undefined;

  for (const integration of Object.values(tenant.integrations)) {
    const webhook = integration.appWebhooks?.find((candidate) => candidate.path === pathname);
    if (webhook) return { webhook, integration };
  }

  return undefined;
}

async function verifyAppWebhookSignature(
  request: Request,
  env: Env,
  resolved: ResolvedAppWebhook
): Promise<"ok" | "unauthorized" | "secret_misconfigured"> {
  if (!resolved.webhook.requiresHmac) return "ok";

  const secretEnv = asString(resolved.integration.hookSecretEnv);
  if (!secretEnv) return "secret_misconfigured";

  let required: string;
  try {
    required = await resolveSecret(env[secretEnv] as SecretValue, secretEnv);
  } catch {
    return "secret_misconfigured";
  }

  return asString(request.headers.get("x-app-signature")) === required ? "ok" : "unauthorized";
}

// Params forwarded from precheckout form to checkout URL so links-redirect can
// create BEGIN_CHECKOUT with email and attribution — enabling Brevo funnel updates.
const CHECKOUT_FORWARD_PARAMS = [
  "email", "anonymous_id", "session_id", "lead_id",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "fbp", "fbc", "fbclid", "gclid", "wbraid", "gbraid",
];

function buildCheckoutRedirect(
  catalog: CatalogV5,
  tenantId: string,
  productCode: string,
  payload: Record<string, unknown>
): URL | null {
  const tenantLinks = (catalog.tenants as Record<string, { links?: { linksDomain?: string; routes?: Array<{ path: string; productCode: string }> } }>)[tenantId]?.links;
  if (!tenantLinks?.linksDomain || !tenantLinks.routes) return null;

  const route = tenantLinks.routes.find((r) => r.productCode === productCode);
  if (!route) return null;

  const url = new URL(`https://${tenantLinks.linksDomain}${route.path}`);
  for (const key of CHECKOUT_FORWARD_PARAMS) {
    const val = typeof payload[key] === "string" && payload[key] ? payload[key] as string : "";
    if (val) url.searchParams.set(key, val);
  }
  return url;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const catalog = getCatalog(env);

    if (request.method === "OPTIONS" && pathname.startsWith("/funnel/")) {
      const tenantId = resolveTenantId(request, catalog);
      if (!tenantId) {
        logIngress({ stage: "preflight_blocked", pathname, error: "unknown_tenant", status: 400 });
        return withCors(jsonResponse({ ok: false, error: "unknown_tenant" }, 400), request, catalog);
      }
      if (!isOriginAllowed(request, catalog, tenantId)) {
        logIngress({ stage: "preflight_blocked", pathname, tenant_id: tenantId, error: "origin_not_allowed", status: 403 });
        return withCors(jsonResponse({ ok: false, error: "origin_not_allowed" }, 403), request, catalog, tenantId);
      }
      logIngress({ stage: "preflight_ok", pathname, tenant_id: tenantId, status: 204 });
      return withCors(new Response(null, { status: 204 }), request, catalog, tenantId);
    }

    if (pathname === "/health") {
      return jsonResponse({ ok: true, worker: "api-funnel-ingress" }, 200);
    }

    if (request.method !== "POST") {
      return withCors(jsonResponse({ ok: false, error: "method_not_allowed" }, 405), request, catalog, resolveTenantId(request, catalog));
    }

    const payload = await parseBody(request);

    if (pathname === "/funnel/precheckout") {
      const tenantId = resolveTenantId(request, catalog, payload);
      if (!tenantId) {
        logIngress({ stage: "blocked", pathname, error: "unknown_tenant", status: 400 });
        return withCors(jsonResponse({ ok: false, error: "unknown_tenant" }, 400), request, catalog);
      }
      if (!isOriginAllowed(request, catalog, tenantId)) {
        logIngress({ stage: "blocked", pathname, tenant_id: tenantId, error: "origin_not_allowed", status: 403 });
        return withCors(jsonResponse({ ok: false, error: "origin_not_allowed" }, 403), request, catalog, tenantId);
      }
      const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "";
      if (clientIp) payload.client_ip = clientIp;
      const queue = env.FUNNEL_EVENTS;
      if (!queue) {
        logIngress({ stage: "error", pathname, tenant_id: tenantId, error: "queue_not_configured", status: 500 });
        return withCors(jsonResponse({ ok: false, error: "queue_not_configured" }, 500), request, catalog, tenantId);
      }
      const event = withTenantId(fromPrecheckoutForm(payload, productCodeFromBody(payload, "UNKNOWN_PRODUCT")), tenantId);
      await queue.send(event);
      logIngress({
        stage: "queued",
        pathname,
        tenant_id: event.tenant_id,
        event_id: event.event_id,
        event_type: event.event_type,
        product_code: event.product_code,
        status: 202,
      });

      // Catalog-driven redirect: forward to checkout URL from catalog with email + attribution params.
      // Allows links-redirect to create BEGIN_CHECKOUT with email → Brevo funnel step updated.
      const checkoutRedirect = buildCheckoutRedirect(catalog, tenantId, event.product_code, payload);
      if (checkoutRedirect) {
        logIngress({ stage: "redirect", pathname, tenant_id: tenantId, event_id: event.event_id, redirect_to: checkoutRedirect.pathname, status: 302 });
        return Response.redirect(checkoutRedirect.toString(), 302);
      }

      return withCors(jsonResponse({ ok: true, event_id: event.event_id, event_type: event.event_type }, 202), request, catalog, tenantId);
    }

    if (pathname === "/funnel/event") {
      const tenantId = resolveTenantId(request, catalog, payload);
      if (!tenantId) {
        logIngress({ stage: "blocked", pathname, error: "unknown_tenant", status: 400 });
        return withCors(jsonResponse({ ok: false, error: "unknown_tenant" }, 400), request, catalog);
      }
      if (!isOriginAllowed(request, catalog, tenantId)) {
        logIngress({ stage: "blocked", pathname, tenant_id: tenantId, error: "origin_not_allowed", status: 403 });
        return withCors(jsonResponse({ ok: false, error: "origin_not_allowed" }, 403), request, catalog, tenantId);
      }
      const queue = env.FUNNEL_EVENTS;
      if (!queue) {
        logIngress({ stage: "error", pathname, tenant_id: tenantId, error: "queue_not_configured", status: 500 });
        return withCors(jsonResponse({ ok: false, error: "queue_not_configured" }, 500), request, catalog, tenantId);
      }
      const event = withTenantId(fromBrowserTracking(payload, productCodeFromBody(payload, "UNKNOWN_PRODUCT")), tenantId);
      await queue.send(event);
      logIngress({
        stage: "queued",
        pathname,
        tenant_id: event.tenant_id,
        event_id: event.event_id,
        event_type: event.event_type,
        product_code: event.product_code,
        status: 202,
      });
      return withCors(jsonResponse({ ok: true, event_id: event.event_id, event_type: event.event_type }, 202), request, catalog, tenantId);
    }

    if (pathname.startsWith("/webhooks/v1/")) {
      const tenantId = resolveTenantId(request, catalog);
      if (!tenantId) {
        logIngress({ stage: "blocked", pathname, error: "unknown_tenant", status: 400 });
        return withCors(jsonResponse({ ok: false, error: "unknown_tenant" }, 400), request, catalog);
      }

      const appWebhook = findAppWebhook(catalog, tenantId, pathname);
      if (!appWebhook) {
        logIngress({ stage: "blocked", pathname, tenant_id: tenantId, error: "not_found", status: 404 });
        return withCors(jsonResponse({ ok: false, error: "not_found" }, 404), request, catalog, tenantId);
      }

      const signatureResult = await verifyAppWebhookSignature(request, env, appWebhook);
      if (signatureResult === "secret_misconfigured") {
        logIngress({ stage: "error", pathname, tenant_id: tenantId, error: "secret_misconfigured", status: 500 });
        return withCors(jsonResponse({ ok: false, error: "secret_misconfigured" }, 500), request, catalog, tenantId);
      }
      if (signatureResult === "unauthorized") {
        logIngress({ stage: "blocked", pathname, tenant_id: tenantId, error: "unauthorized", status: 401 });
        return withCors(jsonResponse({ ok: false, error: "unauthorized" }, 401), request, catalog, tenantId);
      }

      const queue = env.FUNNEL_EVENTS;
      if (!queue) {
        logIngress({ stage: "error", pathname, tenant_id: tenantId, error: "queue_not_configured", status: 500 });
        return withCors(jsonResponse({ ok: false, error: "queue_not_configured" }, 500), request, catalog, tenantId);
      }
      const event = withTenantId(fromAppEvent(payload, appWebhook.webhook.productCode), tenantId);
      await queue.send(event);
      logIngress({
        stage: "queued",
        pathname,
        tenant_id: event.tenant_id,
        event_id: event.event_id,
        event_type: event.event_type,
        product_code: event.product_code,
        status: 202,
      });
      return withCors(jsonResponse({ ok: true, event_id: event.event_id, event_type: event.event_type }, 202), request, catalog, tenantId);
    }

    return withCors(jsonResponse({ ok: false, error: "not_found" }, 404), request, catalog, resolveTenantId(request, catalog, payload));
  },
};
