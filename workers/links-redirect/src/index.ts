import { FunnelEvent } from "../../../packages/shared/src/funnel-event";

interface QueueBinding {
  send(body: unknown): Promise<void>;
}

interface Env {
  ELIZETE_WHATSAPP_NUMBER?: string;
  ELIZETE_WHATSAPP_DEFAULT_TEXT?: string;
  DECOLE_MENTORIA_CHECKOUT_URL?: string;
  PLANO_DE_VOO_CHECKOUT_URL?: string;
  LINKS_PRODUCTS?: string;
  FUNNEL_EVENTS?: QueueBinding;
}

type HandlerResult = {
  location: string;
  cacheControl?: string;
  checkoutPath?: string;
  productCode?: string;
};

interface LinksProductConfig {
  checkoutPath: string;
  checkoutBaseUrl: string;
  productCode?: string;
}

let cachedLinksProductsRaw = "";
let cachedLinksProducts: LinksProductConfig[] = [];

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

function parseLinksProducts(rawConfig: string): LinksProductConfig[] {
  const raw = asTrimmedString(rawConfig);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.log(JSON.stringify({ stage: "config_error", reason: "invalid_links_products_json" }));
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.log(JSON.stringify({ stage: "config_error", reason: "links_products_not_array" }));
    return [];
  }

  return parsed
    .map((entry) => {
      const data = entry as Record<string, unknown>;
      const checkoutPath = lowercasePath(normalizePath(asTrimmedString(data.checkoutPath)));
      const checkoutBaseUrl = asTrimmedString(data.checkoutBaseUrl);
      const productCode = asTrimmedString(data.productCode ?? data.product_code).toUpperCase();
      if (!checkoutPath || !checkoutBaseUrl) return null;
      const config: LinksProductConfig = { checkoutPath, checkoutBaseUrl };
      if (productCode) config.productCode = productCode;
      return config;
    })
    .filter((entry): entry is LinksProductConfig => !!entry);
}

function getLinksProducts(env: Env): LinksProductConfig[] {
  const raw = asTrimmedString(env.LINKS_PRODUCTS);
  if (!raw) return [];
  if (raw === cachedLinksProductsRaw) return cachedLinksProducts;
  cachedLinksProductsRaw = raw;
  cachedLinksProducts = parseLinksProducts(raw);
  return cachedLinksProducts;
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

function handleElizeteWhatsapp(url: URL, env: Env): HandlerResult | null {
  const phone = asTrimmedString(env.ELIZETE_WHATSAPP_NUMBER);
  if (!phone) return null;

  const text =
    asTrimmedString(url.searchParams.get("text")) ||
    asTrimmedString(url.searchParams.get("t")) ||
    asTrimmedString(env.ELIZETE_WHATSAPP_DEFAULT_TEXT);

  return {
    location: appendQueryParams(buildWhatsAppUrl(phone, text), url.searchParams),
    cacheControl: "no-store",
  };
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

    if (offerCode) {
      target.searchParams.set("off", offerCode);
    }

    if (hasExplicitOfferParam && resolvedOffer) {
      target.searchParams.set("offer", resolvedOffer);
    }

    if (!hasExplicitOfferParam) {
      target.searchParams.delete("offer");
    }

    finalLocation = target.toString();
  } catch {
    finalLocation = location;
  }

  return {
    location: finalLocation,
    cacheControl: "no-store",
  };
}

function inferProductCodeByPath(path: string): string {
  const normalizedPath = lowercasePath(normalizePath(path));
  if (normalizedPath === "checkout" || normalizedPath === "decole-esg/checkout") return "DECOLE_ESG_MENTORIA";
  if (normalizedPath === "plano-de-voo/checkout") return "DECOLE_PLANOVOO";
  return "";
}

function resolveCheckoutProductByPath(path: string, env: Env): LinksProductConfig | null {
  const normalizedPath = lowercasePath(normalizePath(path));

  const dynamicMatch = getLinksProducts(env).find((item) => item.checkoutPath === normalizedPath);
  if (dynamicMatch) {
    return {
      ...dynamicMatch,
      productCode: dynamicMatch.productCode || inferProductCodeByPath(normalizedPath) || undefined,
    };
  }

  if (normalizedPath === "checkout" || normalizedPath === "decole-esg/checkout") {
    return {
      checkoutPath: normalizedPath,
      checkoutBaseUrl: asTrimmedString(env.DECOLE_MENTORIA_CHECKOUT_URL),
      productCode: "DECOLE_ESG_MENTORIA",
    };
  }
  if (normalizedPath === "plano-de-voo/checkout") {
    return {
      checkoutPath: normalizedPath,
      checkoutBaseUrl: asTrimmedString(env.PLANO_DE_VOO_CHECKOUT_URL),
      productCode: "DECOLE_PLANOVOO",
    };
  }

  return null;
}

function handleCheckoutPath(url: URL, checkoutPath: string, env: Env): HandlerResult | null {
  const product = resolveCheckoutProductByPath(checkoutPath, env);
  const result = handleCheckoutByBaseUrl(url, product?.checkoutBaseUrl || "");
  if (!result) return null;
  return {
    ...result,
    checkoutPath: product?.checkoutPath || lowercasePath(normalizePath(checkoutPath)),
    productCode: product?.productCode,
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

const handlers: Record<string, (url: URL, env: Env) => HandlerResult | null> = {
  "elizete-wp": handleElizeteWhatsapp,
};

function buildBeginCheckoutEvent(request: Request, url: URL, result: HandlerResult): FunnelEvent | null {
  const productCode = asTrimmedString(result.productCode).toUpperCase();
  if (!productCode) return null;

  const target = new URL(result.location);
  const eventId =
    firstSearchParam(url.searchParams, ["event_id", "eventId"]) || `begin_checkout:${productCode}:${crypto.randomUUID()}`;
  const anonymousId = firstSearchParam(url.searchParams, ["anonymous_id", "anonymousId", "client_id", "clientId"]);
  const sessionId = firstSearchParam(url.searchParams, ["session_id", "sessionId"]);
  const leadId = firstSearchParam(url.searchParams, ["lead_id", "leadId", "LEAD_ID"]);
  const email = firstSearchParam(url.searchParams, ["email", "EMAIL"]);
  const phone = firstSearchParam(url.searchParams, ["phone", "PHONE", "SMS"]);

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
    console.log(
      JSON.stringify({
        stage: "begin_checkout_queued",
        event_id: event.event_id,
        product_code: event.product_code,
      })
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        stage: "begin_checkout_error",
        reason: error instanceof Error ? error.message : "queue_send_failed",
      })
    );
  }
}

async function redirectResponse(
  request: Request,
  url: URL,
  result: HandlerResult,
  env: Env,
  options: { emitBeginCheckout?: boolean } = {}
): Promise<Response> {
  if (options.emitBeginCheckout && request.method === "GET") {
    await enqueueBeginCheckout(request, url, result, env);
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
        const requestUrl = withOfferCode(url, offerCode);
        const result = handleCheckoutPath(requestUrl, checkoutPath, env);

        if (!result || !result.location) {
          return jsonResponse({ ok: false, error: "link_not_configured" }, 500);
        }

        return redirectResponse(request, url, result, env, { emitBeginCheckout: true });
      }

      if (path === "checkout" || path.endsWith("/checkout")) {
        const result = handleCheckoutPath(url, rawPath, env);
        if (!result || !result.location) {
          return jsonResponse({ ok: false, error: "link_not_configured" }, 500);
        }

        return redirectResponse(request, url, result, env, { emitBeginCheckout: true });
      }

      const handler = handlers[path];
      if (!handler) {
        return jsonResponse({ ok: false, error: "not_found" }, 404);
      }

      const result = handler(url, env);
      if (!result || !result.location) {
        return jsonResponse({ ok: false, error: "link_not_configured" }, 500);
      }

      return redirectResponse(request, url, result, env);
    }

    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  },
};

export default worker;
