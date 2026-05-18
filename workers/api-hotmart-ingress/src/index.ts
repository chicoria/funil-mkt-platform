import { fromHotmartWebhook } from "../../../packages/shared/src/event-normalizer";
import { resolveSecret, type SecretValue } from "../../../packages/shared/src/secrets-store-wrapper";
import { tryResolveTenantIdFromHostname } from "../../../packages/shared/src/tenant-from-hostname";
import { findProductByHotmartSlug, type CatalogV5 } from "../../../packages/shared/src/catalog-v5";
import bundledCatalog from "../../../config/products.catalog.json";

interface QueueBinding {
  send(message: unknown): Promise<void>;
}

interface Env {
  FUNNEL_EVENTS?: QueueBinding;
  CATALOG_JSON?: string;
  [key: string]: unknown;
}

interface TenantCredentialsConfig {
  hotmart_token_env?: string;
}

interface TenantWithCredentials {
  credentials?: TenantCredentialsConfig;
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

function logIngress(data: Record<string, unknown>): void {
  console.log(JSON.stringify({ worker: "api-hotmart-ingress", ...data }));
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

function isAuthorized(request: Request, required: string): boolean {
  return tokenFromRequest(request).some((candidate) => candidate === required);
}

async function resolveTenantHotmartToken(env: Env, catalog: CatalogV5, tenantId: string): Promise<string> {
  const tenant = catalog.tenants?.[tenantId] as TenantWithCredentials | undefined;
  const tokenEnv = asString(tenant?.credentials?.hotmart_token_env);
  if (!tokenEnv) {
    throw new Error(`missing tenant.credentials.hotmart_token_env for tenant ${tenantId}`);
  }
  return resolveSecret(env[tokenEnv] as SecretValue, tokenEnv);
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
      logIngress({ stage: "error", pathname, error: "method_not_allowed", status: 405 });
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
    }

    const parsed = parsePath(pathname);
    if (!parsed.ok) {
      logIngress({ stage: "error", pathname, error: "not_found", status: 404 });
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }

    const hostname = new URL(request.url).hostname;
    const catalog = getCatalog(env);
    const tenantId = tryResolveTenantIdFromHostname(hostname, catalog);
    if (!tenantId) {
      logIngress({
        stage: "blocked",
        pathname,
        hostname,
        product_slug: parsed.productSlug,
        error: "unknown_tenant",
        status: 400,
      });
      return jsonResponse({ ok: false, error: "unknown_tenant" }, 400);
    }

    const productCode = findProductByHotmartSlug(catalog, tenantId, parsed.productSlug);
    if (!productCode) {
      logIngress({
        stage: "blocked",
        pathname,
        hostname,
        tenant_id: tenantId,
        product_slug: parsed.productSlug,
        error: "unknown_product_slug",
        status: 404,
      });
      return jsonResponse({ ok: false, error: "unknown_product_slug" }, 404);
    }

    let requiredToken: string;
    try {
      requiredToken = await resolveTenantHotmartToken(env, catalog, tenantId);
    } catch (err) {
      logIngress({
        stage: "error",
        pathname,
        hostname,
        tenant_id: tenantId,
        product_slug: parsed.productSlug,
        error: "secret_misconfigured",
        detail: err instanceof Error ? err.message : String(err),
        status: 500,
      });
      return jsonResponse({ ok: false, error: "secret_misconfigured" }, 500);
    }

    if (!isAuthorized(request, requiredToken)) {
      logIngress({
        stage: "blocked",
        pathname,
        hostname,
        tenant_id: tenantId,
        product_slug: parsed.productSlug,
        error: "unauthorized",
        status: 401,
      });
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    if (!env.FUNNEL_EVENTS) {
      logIngress({
        stage: "error",
        pathname,
        hostname,
        tenant_id: tenantId,
        product_slug: parsed.productSlug,
        error: "queue_not_configured",
        status: 500,
      });
      return jsonResponse({ ok: false, error: "queue_not_configured" }, 500);
    }

    const raw = await parseBody(request);
    const fallbackEventType = parsed.operation.toUpperCase().replace(/-/g, "_");
    if (!asString(raw.event) && !asString(raw.event_name) && !asString(raw.type) && !asString(raw.name)) {
      raw.event = fallbackEventType;
    }
    const incomingEvent =
      asString(raw.event) || asString(raw.event_name) || asString(raw.type) || asString(raw.name) || fallbackEventType;
    raw.event = incomingEvent;

    const normalized = fromHotmartWebhook(raw, productCode);
    // Intencional: hotmart é S2S com HMAC; não honramos tenant_id do payload (Hotmart não envia).
    // Diverge de api-funnel-ingress, que aceita payload.tenant_id como fallback para LPs em preview.
    normalized.tenant_id = tenantId;
    await env.FUNNEL_EVENTS.send(normalized);
    logIngress({
      stage: "queued",
      pathname,
      hostname,
      product_slug: parsed.productSlug,
      tenant_id: tenantId,
      event_id: normalized.event_id,
      event_type: normalized.event_type,
      product_code: normalized.product_code,
      status: 202,
    });

    return jsonResponse({ ok: true, event_id: normalized.event_id, event_type: normalized.event_type }, 202);
  },
};
