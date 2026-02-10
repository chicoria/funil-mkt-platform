interface Env {
  ELIZETE_WHATSAPP_NUMBER?: string;
  ELIZETE_WHATSAPP_DEFAULT_TEXT?: string;
  CHECKOUT_MENTORIA_URL_DEFAULT?: string;
  CHECKOUT_MENTORIA_URL_V1?: string;
  CHECKOUT_MENTORIA_URL_V2?: string;
}

type HandlerResult = {
  location: string;
  cacheControl?: string;
};

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

function resolvePath(pathname: string): string {
  return pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
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
    if (value === "") return;
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
    location: buildWhatsAppUrl(phone, text),
    cacheControl: "no-store",
  };
}

function handleCheckoutMentoria(url: URL, env: Env): HandlerResult | null {
  const version = asTrimmedString(url.searchParams.get("v"));
  let baseUrl = "";

  if (version === "1") baseUrl = asTrimmedString(env.CHECKOUT_MENTORIA_URL_V1);
  if (version === "2") baseUrl = asTrimmedString(env.CHECKOUT_MENTORIA_URL_V2);
  if (!baseUrl) baseUrl = asTrimmedString(env.CHECKOUT_MENTORIA_URL_DEFAULT);
  if (!baseUrl) return null;

  const location = appendQueryParams(baseUrl, url.searchParams, ["v"]);

  return {
    location,
    cacheControl: "no-store",
  };
}

const handlers: Record<string, (url: URL, env: Env) => HandlerResult | null> = {
  "elizete-wp": handleElizeteWhatsapp,
  "checkout_mentoria": handleCheckoutMentoria,
};

const worker = {
  fetch(request: Request, env: Env): Response {
    const url = new URL(request.url);
    const path = resolvePath(url.pathname);

    if (request.method === "GET" || request.method === "HEAD") {
      if (!path || path === "health") {
        return jsonResponse({ ok: true, worker: "links-redirect" }, 200);
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
