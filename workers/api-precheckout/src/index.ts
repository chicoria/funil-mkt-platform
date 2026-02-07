interface Env {
  ALLOWED_ORIGIN?: string;
  BREVO_API_KEY?: string;
  BREVO_LIST_ID?: string;
  BREVO_DOI_TEMPLATE_ID?: string;
  BREVO_DOI_REDIRECT_URL?: string;
  TURNSTILE_SECRET?: string;
}

type InputData = Record<string, unknown>;
type JsonHeaders = Record<string, string>;

type BrevoAttributes = {
  FIRSTNAME?: string;
  LASTNAME?: string;
  SMS?: string;
  LEAD_ID?: string;
  DECOLE_ESG_FUNIL_LAST_STEP?: string;
  DECOLE_ESG_FUNIL_LAST_STEP_TIMESTAMP?: string;
};

interface Lead {
  email: string;
  first: string;
  last: string;
  phoneCountry: string;
  phone: string;
  leadId: string;
}

interface MetaIds {
  fbp: string;
  fbc: string;
  fbclid: string;
}

interface DoiConfig {
  templateId: number;
  redirectUrl: string;
  useDoi: boolean;
}

interface BrevoDoiPayload {
  email: string;
  includeListIds: number[];
  redirectionUrl: string;
  templateId: number;
  attributes: BrevoAttributes;
}

interface BrevoContactPayload {
  email: string;
  updateEnabled: boolean;
  attributes: BrevoAttributes;
  listIds?: number[];
}

type BrevoPayload = BrevoDoiPayload | BrevoContactPayload;

interface BrevoRequestConfig {
  endpoint: string;
  payload: BrevoPayload;
}

const FIXED_ALLOWED_ORIGIN = "http://192.168.1.67:8080";

function jsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ "content-type": "application/json" }, headers || {}),
  });
}

function asTrimmedString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function pickField(data: InputData, keys: string[]): string {
  for (const key of keys) {
    const value = asTrimmedString(data[key]);
    if (value) return value;
  }
  return "";
}

function normalizePhone(rawPhone: unknown, rawCountry: unknown): string {
  if (!rawPhone) return "";
  let digits = String(rawPhone).replace(/\D+/g, "");
  const country = String(rawCountry || "").replace(/\D+/g, "");
  if (country && digits.indexOf(country) !== 0) {
    digits = country + digits;
  }
  return digits;
}

function parseAllowedOrigins(rawAllowedOrigin: string): string[] {
  const normalized = asTrimmedString(rawAllowedOrigin);
  if (!normalized) return [FIXED_ALLOWED_ORIGIN];
  if (normalized === "*") return ["*"];

  const origins = normalized
    .split(/[,\n;]/)
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!origins.includes(FIXED_ALLOWED_ORIGIN)) {
    origins.push(FIXED_ALLOWED_ORIGIN);
  }

  return origins;
}

function getCorsOrigin(allowedOrigins: string[], requestOrigin: string): string {
  if (allowedOrigins.includes("*")) return "*";
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return requestOrigin;
  return allowedOrigins[0] || FIXED_ALLOWED_ORIGIN;
}

function buildCorsHeaders(corsOrigin: string): JsonHeaders {
  return {
    "access-control-allow-origin": corsOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-brevo-ajax",
    "access-control-max-age": "86400",
  };
}

function logStage(reqId: string, stage: string, data?: InputData): void {
  const payload = Object.assign({ reqId, stage }, data || {});
  console.log(JSON.stringify(payload));
}

function isOriginAllowed(allowedOrigins: string[], origin: string): boolean {
  if (allowedOrigins.includes("*")) return true;
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

function getRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeLeadInput(data: InputData): Lead {
  const email = pickField(data, ["EMAIL", "email"]).toLowerCase();
  const first = pickField(data, ["FIRSTNAME", "first_name"]);
  const last = pickField(data, ["LASTNAME", "last_name"]);
  const phoneCountry = pickField(data, ["SMS__COUNTRY_CODE", "country_code"]);
  const phone = normalizePhone(data.SMS ?? data.phone, phoneCountry);
  const leadId = pickField(data, ["LEAD_ID", "lead_id"]);

  return {
    email,
    first,
    last,
    phoneCountry,
    phone,
    leadId,
  };
}

function buildAttributes(lead: Lead): BrevoAttributes {
  const attributes: BrevoAttributes = {};
  if (lead.first) attributes.FIRSTNAME = lead.first;
  if (lead.last) attributes.LASTNAME = lead.last;
  if (lead.phone) attributes.SMS = lead.phone;
  if (lead.leadId) attributes.LEAD_ID = lead.leadId;
  attributes.DECOLE_ESG_FUNIL_LAST_STEP = "BEGIN_CHECKOUT";
  attributes.DECOLE_ESG_FUNIL_LAST_STEP_TIMESTAMP = formatDateDDMMYYYY(new Date());
  return attributes;
}

function formatDateDDMMYYYY(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}-${month}-${year}`;
}

function buildRedirectUrl(baseUrl: string, params?: Record<string, string | undefined>): string {
  if (!baseUrl) return "";

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return baseUrl;
  }

  Object.keys(params || {}).forEach((key) => {
    const value = params?.[key];
    if (value === undefined || value === null || value === "") return;
    if (url.searchParams.has(key)) return;
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const output: Record<string, string> = {};
  if (!cookieHeader) return output;

  cookieHeader.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;

    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key) return;

    output[key] = decodeURIComponent(value);
  });

  return output;
}

function extractMetaIds(data: InputData, cookieHeader: string): MetaIds {
  const cookies = parseCookies(cookieHeader);

  let fbp = pickField(data, ["FBP", "fbp", "_fbp"]);
  if (!fbp) fbp = cookies._fbp || "";

  let fbc = pickField(data, ["FBC", "fbc", "_fbc"]);
  if (!fbc) fbc = cookies._fbc || "";

  const fbclid = pickField(data, ["FBCLID", "fbclid"]);

  return {
    fbp,
    fbc,
    fbclid,
  };
}

function getDoiConfig(env: Env, leadId: string, metaIds: MetaIds): DoiConfig {
  const templateId = Number(env.BREVO_DOI_TEMPLATE_ID || "0");
  const baseRedirect = asTrimmedString(env.BREVO_DOI_REDIRECT_URL);
  const redirectUrl = buildRedirectUrl(baseRedirect, {
    lead_id: leadId || undefined,
    fbp: metaIds.fbp || undefined,
    fbc: metaIds.fbc || undefined,
    fbclid: metaIds.fbclid || undefined,
  });

  return {
    templateId,
    redirectUrl,
    useDoi: templateId > 0 && !!redirectUrl,
  };
}

function buildBrevoRequest(
  email: string,
  attributes: BrevoAttributes,
  listId: number,
  doiConfig: DoiConfig
): BrevoRequestConfig {
  const endpoint = doiConfig.useDoi
    ? "https://api.brevo.com/v3/contacts/doubleOptinConfirmation"
    : "https://api.brevo.com/v3/contacts";

  const payload: BrevoPayload = doiConfig.useDoi
    ? {
        email,
        includeListIds: listId > 0 ? [listId] : [],
        redirectionUrl: doiConfig.redirectUrl,
        templateId: doiConfig.templateId,
        attributes,
      }
    : {
        email,
        updateEnabled: true,
        attributes,
        listIds: listId > 0 ? [listId] : undefined,
      };

  return {
    endpoint,
    payload,
  };
}

function parseBrevoError(payloadText: string): { code: string; message: string } {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    return { code: "", message: payloadText || "" };
  }

  const data = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};

  return {
    code: data.code ? String(data.code) : "",
    message: data.message ? String(data.message) : payloadText || "",
  };
}

async function sendBrevo(requestConfig: BrevoRequestConfig, apiKey: string): Promise<Response> {
  return fetch(requestConfig.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify(requestConfig.payload),
  });
}

async function parseBody(request: Request): Promise<InputData> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.indexOf("application/json") !== -1) {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as InputData;
    }
    return {};
  }

  const form = await request.formData();
  const data: InputData = {};
  form.forEach((value, key) => {
    data[key] = typeof value === "string" ? value : value.name;
  });
  return data;
}

async function verifyTurnstile(token: string, ip: string, secret: string): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;

  const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({
      secret,
      response: token,
      remoteip: ip || "",
    }),
  });

  const json = (await resp.json()) as { success?: boolean };
  return !!json.success;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const reqId = getRequestId();
    const startedAt = Date.now();
    const origin = request.headers.get("origin") || "";
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGIN || "");
    const corsHeaders = buildCorsHeaders(getCorsOrigin(allowedOrigins, origin));

    if (!isOriginAllowed(allowedOrigins, origin)) {
      logStage(reqId, "origin_check", {
        ok: false,
        origin,
        allowedOrigins,
      });
      return jsonResponse({ ok: false, error: "origin_not_allowed" }, 403, corsHeaders);
    }

    if (request.method === "OPTIONS") {
      logStage(reqId, "preflight", { ok: true, origin });
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      logStage(reqId, "method_check", { ok: false, method: request.method });
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders);
    }

    const data = await parseBody(request);
    const metaIds = extractMetaIds(data, request.headers.get("cookie") || "");
    const lead = normalizeLeadInput(data);

    if (!lead.email) {
      logStage(reqId, "validate", { ok: false, reason: "no_email" });
      return jsonResponse({ ok: false, error: "email_required" }, 400, corsHeaders);
    }

    logStage(reqId, "parsed", {
      ok: true,
      hasFirst: !!lead.first,
      hasLast: !!lead.last,
      hasPhone: !!lead.phone,
    });

    const turnstileToken = asTrimmedString(data["cf-turnstile-response"]);
    const ip = request.headers.get("CF-Connecting-IP") || "";
    const turnstileOk = await verifyTurnstile(turnstileToken, ip, env.TURNSTILE_SECRET || "");

    if (!turnstileOk) {
      logStage(reqId, "turnstile", { ok: false });
      return jsonResponse({ ok: false, error: "captcha_failed" }, 400, corsHeaders);
    }

    logStage(reqId, "turnstile", { ok: true });

    const listId = Number(env.BREVO_LIST_ID || "0");
    const attributes = buildAttributes(lead);
    const doiConfig = getDoiConfig(env, lead.leadId, metaIds);

    logStage(reqId, "doi_check", {
      ok: true,
      useDoi: doiConfig.useDoi,
      listId,
    });

    const brevoRequest = buildBrevoRequest(lead.email, attributes, listId, doiConfig);
    const brevoResp = await sendBrevo(brevoRequest, env.BREVO_API_KEY || "");

    if (!brevoResp.ok) {
      const errText = await brevoResp.text();
      const err = parseBrevoError(errText);
      logStage(reqId, "brevo", { ok: false, status: brevoResp.status, code: err.code });

      return jsonResponse(
        {
          ok: false,
          error: "brevo_error",
          code: err.code || undefined,
          message: err.message || errText || "Brevo error",
          detail: errText || undefined,
        },
        brevoResp.status,
        corsHeaders
      );
    }

    logStage(reqId, "brevo", { ok: true, status: brevoResp.status });
    logStage(reqId, "done", { ok: true, ms: Date.now() - startedAt });

    return jsonResponse({ ok: true, doi: doiConfig.useDoi }, 200, corsHeaders);
  },
};

export default worker;
