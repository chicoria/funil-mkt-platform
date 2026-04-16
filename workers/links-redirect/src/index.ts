interface Env {
  ELIZETE_WHATSAPP_NUMBER?: string;
  ELIZETE_WHATSAPP_DEFAULT_TEXT?: string;
  DECOLE_MENTORIA_CHECKOUT_URL?: string;
  PLANO_DE_VOO_CHECKOUT_URL?: string;
  LINKS_PRODUCTS?: string;
}

type HandlerResult = {
  location: string;
  cacheControl?: string;
};

interface LinksProductConfig {
  checkoutPath: string;
  checkoutBaseUrl: string;
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
      if (!checkoutPath || !checkoutBaseUrl) return null;
      return { checkoutPath, checkoutBaseUrl };
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

function resolveCheckoutBaseUrlByPath(path: string, env: Env): string {
  const normalizedPath = lowercasePath(normalizePath(path));

  const dynamicMatch = getLinksProducts(env).find((item) => item.checkoutPath === normalizedPath);
  if (dynamicMatch) return dynamicMatch.checkoutBaseUrl;

  if (normalizedPath === "checkout" || normalizedPath === "decole-esg/checkout") {
    return asTrimmedString(env.DECOLE_MENTORIA_CHECKOUT_URL);
  }
  if (normalizedPath === "plano-de-voo/checkout") {
    return asTrimmedString(env.PLANO_DE_VOO_CHECKOUT_URL);
  }

  return "";
}

function handleCheckoutPath(url: URL, checkoutPath: string, env: Env): HandlerResult | null {
  const baseUrl = resolveCheckoutBaseUrlByPath(checkoutPath, env);
  return handleCheckoutByBaseUrl(url, baseUrl);
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

const worker = {
  fetch(request: Request, env: Env): Response {
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

        return new Response(null, {
          status: 302,
          headers: {
            location: result.location,
            "cache-control": result.cacheControl || "no-store",
          },
        });
      }

      if (path === "checkout" || path.endsWith("/checkout")) {
        const result = handleCheckoutPath(url, rawPath, env);
        if (!result || !result.location) {
          return jsonResponse({ ok: false, error: "link_not_configured" }, 500);
        }

        return new Response(null, {
          status: 302,
          headers: {
            location: result.location,
            "cache-control": result.cacheControl || "no-store",
          },
        });
      }

      const handler = handlers[path];
      if (!handler) {
        return jsonResponse({ ok: false, error: "not_found" }, 404);
      }

      const result = handler(url, env);
      if (!result || !result.location) {
        return jsonResponse({ ok: false, error: "link_not_configured" }, 500);
      }

      return new Response(null, {
        status: 302,
        headers: {
          location: result.location,
          "cache-control": result.cacheControl || "no-store",
        },
      });
    }

    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  },
};

export default worker;
