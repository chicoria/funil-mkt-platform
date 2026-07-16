import { tryResolveTenantIdFromHostname } from "../../../packages/shared/src/tenant-from-hostname";
import bundledCatalogJson from "../../../config/products.catalog.json";
import { FunnelEvent } from "../../../packages/shared/src/funnel-event";

interface QueueBinding {
  send(body: unknown): Promise<void>;
}

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
}

interface Env {
  FUNNEL_EVENTS?: QueueBinding;
  IDENTITY_KV?: KVNamespaceLike;
}

type HandlerResult = {
  location: string;
  cacheControl?: string;
  checkoutPath?: string;
  productCode?: string;
  confirmationPath?: string;
  eventType?: "BEGIN_CHECKOUT" | "SIGN_UP";
};

interface LinksProductConfig {
  checkoutPath: string;
  checkoutBaseUrl: string;
  productCode?: string;
}

interface LinksCatalog {
  tenants: Record<string, {
    domains?: readonly string[];
    links?: {
      linksDomain?: string;
      routes?: ReadonlyArray<{
        readonly path: string;
        readonly type: string;
        readonly productCode: string;
        readonly redirectUrl?: string;
        readonly legacy?: boolean;
        readonly deprecated?: boolean;
        readonly defaultParams?: Readonly<Record<string, string>>;
      }>;
      contacts?: Record<string, { readonly type: string; readonly number?: string; readonly defaultText?: string }>;
    };
    products?: Record<string, { links?: { readonly checkoutBaseUrl?: string } }>;
  }>;
}

const CHECKOUT_RECOVERY_PARAM_KEYS = new Set([
  "email", "name", "phoneac", "phonenumber",
  "fbp", "fbc", "fbclid", "gclid", "wbraid", "gbraid",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "anonymous_id", "session_id", "lead_id", "off", "offer",
]);

// --- Pure functions (exported for unit testing) ---

export function resolveCheckoutByCatalog(
  catalog: LinksCatalog,
  tenantId: string,
  path: string
): LinksProductConfig | null {
  const normalizedPath = "/" + lowercasePath(normalizePath(path));
  const tenant = catalog.tenants[tenantId];
  if (!tenant) return null;
  const routes = tenant.links?.routes ?? [];
  const route = routes.find((r) => lowercasePath(r.path) === normalizedPath);
  if (!route) return null;
  const checkoutBaseUrl = tenant.products?.[route.productCode]?.links?.checkoutBaseUrl ?? "";
  if (!checkoutBaseUrl) return null;
  return {
    checkoutPath: lowercasePath(normalizePath(route.path)),
    checkoutBaseUrl,
    productCode: route.productCode,
  };
}

export function resolveContact(
  catalog: LinksCatalog,
  tenantId: string,
  slug: string
): { type: string; number?: string; defaultText?: string } | null {
  return catalog.tenants[tenantId]?.links?.contacts?.[slug] ?? null;
}

// --- Helpers ---

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function asTrimmedString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

function buildWhatsAppUrl(phoneNumber: string, text?: string): string {
  const base = `https://wa.me/${digitsOnly(phoneNumber)}`;
  if (!text) return base;
  return `${base}?text=${encodeURIComponent(text)}`;
}

function normalizePath(pathname: string): string {
  return pathname.replace(/^\/+|\/+$/g, "");
}

function lowercasePath(pathname: string): string {
  return pathname.toLowerCase();
}

function appendQueryParams(baseUrl: string, params: URLSearchParams, ignoreKeys: string[] = []): string {
  if (!baseUrl) return baseUrl;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return baseUrl;
  }
  params.forEach((value, key) => {
    if (!key || ignoreKeys.includes(key)) return;
    url.searchParams.set(key, value);
  });
  return url.toString();
}

function firstSearchParam(params: URLSearchParams, keys: string[]): string {
  for (const key of keys) {
    const value = asTrimmedString(params.get(key));
    if (value) return value;
  }
  return "";
}

function checkoutRecoveryKeys(recoveryId: string, tenantId: string): string[] {
  if (recoveryId.startsWith(`${tenantId}:checkout_recovery:`)) return [recoveryId];
  if (recoveryId.startsWith("checkout_recovery:")) return [`${tenantId}:${recoveryId}`, recoveryId];
  return [`${tenantId}:checkout_recovery:${recoveryId}`, `checkout_recovery:${recoveryId}`];
}

async function withCheckoutRecoveryParams(url: URL, tenantId: string, env: Env): Promise<URL> {
  const recoveryId = firstSearchParam(url.searchParams, ["rid", "recovery_id", "recoveryId"]);
  if (!recoveryId) return url;

  const nextUrl = new URL(url);
  nextUrl.searchParams.delete("rid");
  nextUrl.searchParams.delete("recovery_id");
  nextUrl.searchParams.delete("recoveryId");

  if (!env.IDENTITY_KV) return nextUrl;

  let parsed: unknown;
  try {
    let raw = "";
    for (const key of checkoutRecoveryKeys(recoveryId, tenantId)) {
      raw = (await env.IDENTITY_KV.get(key)) || "";
      if (raw) break;
    }
    if (!raw) return nextUrl;
    parsed = JSON.parse(raw);
  } catch {
    return nextUrl;
  }

  if (!parsed || typeof parsed !== "object") return nextUrl;
  const params = (parsed as { params?: unknown }).params;
  if (!params || typeof params !== "object") return nextUrl;

  Object.entries(params as Record<string, unknown>).forEach(([key, rawValue]) => {
    if (!CHECKOUT_RECOVERY_PARAM_KEYS.has(key)) return;
    const value = asTrimmedString(rawValue);
    if (!value || asTrimmedString(nextUrl.searchParams.get(key))) return;
    nextUrl.searchParams.set(key, value);
  });

  return nextUrl;
}

function handleContactBySlug(slug: string, tenantId: string, url: URL): HandlerResult | null {
  const contact = resolveContact(bundledCatalogJson as LinksCatalog, tenantId, slug);
  if (!contact) return null;
  if (contact.type === "whatsapp" && contact.number) {
    const text =
      asTrimmedString(url.searchParams.get("text")) ||
      asTrimmedString(url.searchParams.get("t")) ||
      asTrimmedString(contact.defaultText);
    return {
      location: appendQueryParams(buildWhatsAppUrl(contact.number, text), url.searchParams),
      cacheControl: "no-store",
    };
  }
  return null;
}

function handleCheckoutByBaseUrl(url: URL, baseUrl: string): HandlerResult | null {
  if (!baseUrl) return null;

  const hasExplicitOfferParam =
    url.searchParams.has("offer") || url.searchParams.has("offer_id") || url.searchParams.has("offerId");
  const offerCode =
    asTrimmedString(url.searchParams.get("off")) ||
    asTrimmedString(url.searchParams.get("offer")) ||
    asTrimmedString(url.searchParams.get("offer_id")) ||
    asTrimmedString(url.searchParams.get("offerId"));

  const location = appendQueryParams(baseUrl, url.searchParams, ["offer", "offer_id", "offerId", "v"]);
  let finalLocation = location;

  try {
    const target = new URL(location);
    const baseOffer =
      asTrimmedString(target.searchParams.get("off")) || asTrimmedString(target.searchParams.get("offer"));
    const resolvedOffer = offerCode || baseOffer;

    if (offerCode) target.searchParams.set("off", offerCode);
    if (hasExplicitOfferParam && resolvedOffer) target.searchParams.set("offer", resolvedOffer);
    if (!hasExplicitOfferParam) target.searchParams.delete("offer");

    finalLocation = target.toString();
  } catch {
    finalLocation = location;
  }

  return { location: finalLocation, cacheControl: "no-store" };
}

function handleCheckoutPath(url: URL, checkoutPath: string, tenantId: string): HandlerResult | null {
  const product = resolveCheckoutByCatalog(bundledCatalogJson as LinksCatalog, tenantId, checkoutPath);
  const result = handleCheckoutByBaseUrl(url, product?.checkoutBaseUrl || "");
  if (!result) return null;
  return {
    ...result,
    checkoutPath: product?.checkoutPath || lowercasePath(normalizePath(checkoutPath)),
    productCode: product?.productCode,
    eventType: "BEGIN_CHECKOUT",
  };
}

function resolveTenantRoute(catalog: LinksCatalog, tenantId: string, path: string) {
  const normalizedPath = "/" + lowercasePath(normalizePath(path));
  const tenant = catalog.tenants[tenantId];
  if (!tenant) return null;
  return (tenant.links?.routes ?? []).find((route) => lowercasePath(route.path) === normalizedPath) || null;
}

function handleDoiConfirmationPath(url: URL, routePath: string, tenantId: string): HandlerResult | null {
  const route = resolveTenantRoute(bundledCatalogJson as LinksCatalog, tenantId, routePath);
  if (!route || route.type !== "doi_confirmation") return null;
  const redirectUrl = asTrimmedString(route.redirectUrl);
  if (!redirectUrl) return null;
  return {
    location: appendQueryParams(redirectUrl, url.searchParams, ["rid", "recovery_id", "recoveryId"]),
    cacheControl: "no-store",
    productCode: route.productCode,
    confirmationPath: lowercasePath(normalizePath(route.path)),
    eventType: "SIGN_UP",
  };
}

function handleChannelReferralPath(url: URL, routePath: string, tenantId: string): HandlerResult | null {
  const route = resolveTenantRoute(bundledCatalogJson as LinksCatalog, tenantId, routePath);
  if (!route || route.type !== "channel_referral") return null;
  const redirectUrl = asTrimmedString(route.redirectUrl);
  if (!redirectUrl) return null;

  let target: URL;
  try {
    target = new URL(redirectUrl);
  } catch {
    return {
      location: appendQueryParams(redirectUrl, url.searchParams),
      cacheControl: "no-store",
      productCode: route.productCode,
    };
  }

  const defaultParams = route.defaultParams ?? {};
  Object.entries(defaultParams).forEach(([key, value]) => {
    if (!url.searchParams.has(key)) {
      target.searchParams.set(key, value);
    }
  });

  return {
    location: appendQueryParams(target.toString(), url.searchParams),
    cacheControl: "no-store",
    productCode: route.productCode,
  };
}

function withOfferCode(url: URL, offerCode: string): URL {
  const nextUrl = new URL(url);
  if (!offerCode) return nextUrl;
  nextUrl.searchParams.delete("off");
  nextUrl.searchParams.delete("offer");
  nextUrl.searchParams.delete("offer_id");
  nextUrl.searchParams.delete("offerId");
  nextUrl.searchParams.set("offer", offerCode);
  return nextUrl;
}

function buildBeginCheckoutEvent(request: Request, url: URL, result: HandlerResult): FunnelEvent | null {
  const clientIp =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "";
  const productCode = asTrimmedString(result.productCode).toUpperCase();
  if (!productCode) return null;

  const target = new URL(result.location);
  const eventId =
    firstSearchParam(url.searchParams, ["event_id", "eventId"]) || `begin_checkout:${productCode}:${crypto.randomUUID()}`;
  const anonymousId = firstSearchParam(url.searchParams, ["anonymous_id", "anonymousId", "client_id", "clientId"]);
  const sessionId = firstSearchParam(url.searchParams, ["session_id", "sessionId"]);
  const leadId = firstSearchParam(url.searchParams, ["lead_id", "leadId", "LEAD_ID"]);
  const email = firstSearchParam(url.searchParams, ["email", "EMAIL"]);
  const phone = firstSearchParam(url.searchParams, ["phone", "PHONE", "SMS", "phonenumber", "phoneNumber"]);
  const testEventCode = firstSearchParam(url.searchParams, ["test_event_code", "meta_test_event_code"]);

  return {
    event_id: eventId,
    event_type: "BEGIN_CHECKOUT",
    product_code: productCode,
    source: "site",
    occurred_at: new Date().toISOString(),
    identity: {
      anonymous_id: anonymousId || undefined,
      session_id: sessionId || undefined,
      lead_id: leadId || undefined,
    },
    attribution: {
      fbp: firstSearchParam(url.searchParams, ["fbp", "FBP"]) || undefined,
      fbc: firstSearchParam(url.searchParams, ["fbc", "FBC"]) || undefined,
      gclid: firstSearchParam(url.searchParams, ["gclid"]) || undefined,
      wbraid: firstSearchParam(url.searchParams, ["wbraid"]) || undefined,
      gbraid: firstSearchParam(url.searchParams, ["gbraid"]) || undefined,
      utm_source: firstSearchParam(url.searchParams, ["utm_source"]) || undefined,
      utm_medium: firstSearchParam(url.searchParams, ["utm_medium"]) || undefined,
      utm_campaign: firstSearchParam(url.searchParams, ["utm_campaign"]) || undefined,
      client_ip: clientIp || undefined,
    },
    lead: {
      email: email || undefined,
      phone: phone || undefined,
      lead_id: leadId || undefined,
    },
    payload: {
      checkout_url: target.toString(),
      checkout_path: result.checkoutPath,
      link_url: url.toString(),
      event_source_url: request.headers.get("referer") || url.origin,
      offer_code: firstSearchParam(target.searchParams, ["off", "offer"]),
      ...(testEventCode ? { test_event_code: testEventCode } : {}),
    },
  };
}

async function enqueueBeginCheckout(request: Request, url: URL, result: HandlerResult, env: Env): Promise<void> {
  if (!env.FUNNEL_EVENTS) {
    console.log(JSON.stringify({ stage: "begin_checkout_skip", reason: "missing_queue" }));
    return;
  }
  const event = buildBeginCheckoutEvent(request, url, result);
  if (!event) {
    console.log(JSON.stringify({ stage: "begin_checkout_skip", reason: "missing_product_code" }));
    return;
  }
  try {
    await env.FUNNEL_EVENTS.send(event);
    console.log(JSON.stringify({ stage: "begin_checkout_queued", event_id: event.event_id, product_code: event.product_code }));
  } catch (error) {
    console.log(JSON.stringify({ stage: "begin_checkout_error", reason: error instanceof Error ? error.message : "queue_send_failed" }));
  }
}

function buildSignUpEvent(request: Request, url: URL, result: HandlerResult): FunnelEvent | null {
  const clientIp =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "";
  const productCode = asTrimmedString(result.productCode).toUpperCase();
  if (!productCode) return null;

  const rid = firstSearchParam(url.searchParams, ["rid", "recovery_id", "recoveryId"]);
  const email = firstSearchParam(url.searchParams, ["email", "EMAIL"]).toLowerCase();
  const phone = firstSearchParam(url.searchParams, ["phone", "PHONE", "SMS", "phonenumber", "phoneNumber"]);
  const leadId = firstSearchParam(url.searchParams, ["lead_id", "leadId", "LEAD_ID"]);
  const anonymousId = firstSearchParam(url.searchParams, ["anonymous_id", "anonymousId", "client_id", "clientId"]);
  const sessionId = firstSearchParam(url.searchParams, ["session_id", "sessionId"]);

  const eventId =
    firstSearchParam(url.searchParams, ["event_id", "eventId"]) ||
    (rid ? `sign_up:${productCode}:${rid}` : email ? `sign_up:${productCode}:${email}` : `sign_up:${productCode}:${crypto.randomUUID()}`);

  return {
    event_id: eventId,
    event_type: "SIGN_UP",
    product_code: productCode,
    source: "site",
    occurred_at: new Date().toISOString(),
    identity: {
      anonymous_id: anonymousId || undefined,
      session_id: sessionId || undefined,
      lead_id: leadId || undefined,
    },
    attribution: {
      fbp: firstSearchParam(url.searchParams, ["fbp", "FBP"]) || undefined,
      fbc: firstSearchParam(url.searchParams, ["fbc", "FBC"]) || undefined,
      gclid: firstSearchParam(url.searchParams, ["gclid"]) || undefined,
      wbraid: firstSearchParam(url.searchParams, ["wbraid"]) || undefined,
      gbraid: firstSearchParam(url.searchParams, ["gbraid"]) || undefined,
      utm_source: firstSearchParam(url.searchParams, ["utm_source"]) || undefined,
      utm_medium: firstSearchParam(url.searchParams, ["utm_medium"]) || undefined,
      utm_campaign: firstSearchParam(url.searchParams, ["utm_campaign"]) || undefined,
      client_ip: clientIp || undefined,
    },
    lead: {
      email: email || undefined,
      phone: phone || undefined,
      lead_id: leadId || undefined,
    },
    payload: {
      confirmation_path: result.confirmationPath,
      redirect_url: result.location,
      link_url: url.toString(),
      recovery_id: rid || undefined,
    },
  };
}

async function enqueueSignUp(request: Request, url: URL, result: HandlerResult, env: Env): Promise<void> {
  if (!env.FUNNEL_EVENTS) {
    console.log(JSON.stringify({ stage: "sign_up_skip", reason: "missing_queue" }));
    return;
  }
  const event = buildSignUpEvent(request, url, result);
  if (!event) {
    console.log(JSON.stringify({ stage: "sign_up_skip", reason: "missing_product_code" }));
    return;
  }
  try {
    await env.FUNNEL_EVENTS.send(event);
    console.log(JSON.stringify({ stage: "sign_up_queued", event_id: event.event_id, product_code: event.product_code }));
  } catch (error) {
    console.log(JSON.stringify({ stage: "sign_up_error", reason: error instanceof Error ? error.message : "queue_send_failed" }));
  }
}

async function redirectResponse(
  request: Request,
  url: URL,
  result: HandlerResult,
  env: Env,
  options: { emitBeginCheckout?: boolean } = {}
): Promise<Response> {
  if (request.method === "GET") {
    if (options.emitBeginCheckout) {
      await enqueueBeginCheckout(request, url, result, env);
    }
    if (result.eventType === "SIGN_UP") {
      await enqueueSignUp(request, url, result, env);
    }
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: result.location,
      "cache-control": result.cacheControl || "no-store",
    },
  });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const rawPath = normalizePath(url.pathname);
    const path = lowercasePath(rawPath);

    const tenantId = tryResolveTenantIdFromHostname(url.hostname, bundledCatalogJson);
    if (!tenantId) {
      console.log(JSON.stringify({ stage: "tenant_not_configured", hostname: url.hostname }));
      return jsonResponse({ ok: false, error: "tenant_not_configured" }, 404);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      if (!path || path === "health") {
        return jsonResponse({ ok: true, worker: "links-redirect" }, 200);
      }

      const offerMatch = rawPath.match(/^(.+)\/checkout\/offer\/([^/]+)$/i);
      if (offerMatch) {
        const checkoutPrefix = normalizePath(offerMatch[1] || "");
        const offerCode = offerMatch[2] || "";
        if (!checkoutPrefix || !offerCode) {
          return jsonResponse({ ok: false, error: "not_found" }, 404);
        }
        const checkoutPath = `${checkoutPrefix}/checkout`;
        const requestUrl = await withCheckoutRecoveryParams(withOfferCode(url, offerCode), tenantId, env);
        const result = handleCheckoutPath(requestUrl, checkoutPath, tenantId);
        if (!result || !result.location) {
          return jsonResponse({ ok: false, error: "link_not_configured" }, 500);
        }
        return redirectResponse(request, requestUrl, result, env, { emitBeginCheckout: true });
      }

      if (path === "checkout" || path.endsWith("/checkout")) {
        const route = resolveTenantRoute(bundledCatalogJson as LinksCatalog, tenantId, rawPath);
        if (!route || route.type !== "checkout") {
          return jsonResponse({ ok: false, error: "not_found" }, 404);
        }
        const requestUrl = await withCheckoutRecoveryParams(url, tenantId, env);
        const result = handleCheckoutPath(requestUrl, rawPath, tenantId);
        if (!result || !result.location) {
          return jsonResponse({ ok: false, error: "link_not_configured" }, 500);
        }
        return redirectResponse(request, requestUrl, result, env, { emitBeginCheckout: true });
      }

      const confirmationResult = handleDoiConfirmationPath(url, rawPath, tenantId);
      if (confirmationResult) {
        if (!confirmationResult.location) {
          return jsonResponse({ ok: false, error: "link_not_configured" }, 500);
        }
        const requestUrl = await withCheckoutRecoveryParams(url, tenantId, env);
        return redirectResponse(request, requestUrl, confirmationResult, env);
      }

      // Channel referral handler — lookup dinâmico do catálogo
      const channelReferralResult = handleChannelReferralPath(url, rawPath, tenantId);
      if (channelReferralResult) {
        if (!channelReferralResult.location) {
          return jsonResponse({ ok: false, error: "link_not_configured" }, 500);
        }
        return redirectResponse(request, url, channelReferralResult, env);
      }

      // Contact handler — lookup dinâmico do catálogo
      const contactResult = handleContactBySlug(path, tenantId, url);
      if (contactResult) {
        if (!contactResult.location) {
          return jsonResponse({ ok: false, error: "link_not_configured" }, 500);
        }
        return redirectResponse(request, url, contactResult, env);
      }

      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }

    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  },
};

export default worker;
