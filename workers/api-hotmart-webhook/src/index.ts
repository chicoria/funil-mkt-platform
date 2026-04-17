interface QueueBinding {
  send(message: unknown): Promise<void>;
}

interface Env {
  HOTMART_EVENTS?: QueueBinding;
  HOTMART_WEBHOOK_TOKEN?: string;
  WEBHOOK_FORWARDING_RULES?: string;
}

type InputData = Record<string, unknown>;

interface HotmartQueuedEvent {
  source: "hotmart";
  receivedAt: string;
  productSlug: string;
  subsystem: string;
  operation: string;
  eventType: string;
  eventId: string;
  email: string;
  productId: string;
  productName: string;
  payload: InputData;
}

interface ParsedWebhookPath {
  ok: boolean;
  productSlug: string;
  subsystem: string;
  operation: string;
  isLegacy: boolean;
}

interface ForwardingRule {
  productSlug: string;
  subsystem: string;
  operation?: string;
  targetUrl: string;
  required: boolean;
}

let cachedForwardingRulesRaw = "";
let cachedForwardingRules: ForwardingRule[] = [];

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function getByPath(data: InputData, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as InputData)[part];
  }
  return current;
}

function pickString(data: InputData, paths: string[]): string {
  for (const path of paths) {
    const value = asString(getByPath(data, path));
    if (value) return value;
  }
  return "";
}

function bearerToken(request: Request): string {
  const header = asString(request.headers.get("authorization"));
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? asString(match[1]) : "";
}

function isAuthorized(request: Request, env: Env): boolean {
  const requiredToken = asString(env.HOTMART_WEBHOOK_TOKEN);
  if (!requiredToken) return true;

  const url = new URL(request.url);
  const candidates = [
    asString(request.headers.get("x-hotmart-hottok")),
    asString(request.headers.get("x-hotmart-token")),
    asString(request.headers.get("x-webhook-token")),
    bearerToken(request),
    asString(url.searchParams.get("hottok")),
    asString(url.searchParams.get("token")),
  ].filter(Boolean);

  return candidates.some((candidate) => candidate === requiredToken);
}

async function parseBody(request: Request): Promise<InputData> {
  const contentType = asString(request.headers.get("content-type")).toLowerCase();

  if (contentType.includes("application/json")) {
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as InputData;
      }
    } catch {
      return {};
    }
    return {};
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const data: InputData = {};
    form.forEach((value, key) => {
      data[key] = typeof value === "string" ? value : value.name;
    });
    return data;
  }

  const raw = await request.text();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as InputData;
    }
  } catch {
    return { raw };
  }

  return { raw };
}

function buildQueuedEvent(payload: InputData, route: ParsedWebhookPath): HotmartQueuedEvent {
  const eventType =
    pickString(payload, ["event", "event_name", "type", "name", "data.event"]) ||
    asString(route.operation).toUpperCase().replace(/-/g, "_");
  const eventId =
    pickString(payload, ["id", "event_id", "transaction", "transaction_id", "data.id", "data.transaction"]) ||
    crypto.randomUUID();
  const email = pickString(payload, [
    "email",
    "buyer.email",
    "customer.email",
    "data.buyer.email",
    "data.customer.email",
    "data.email",
  ]);
  const productId = pickString(payload, [
    "product.id",
    "product_id",
    "productId",
    "data.product.id",
    "data.product_id",
    "data.productId",
    "data.checkout.product.id",
    "data.purchase.product.id",
  ]);
  const productName = pickString(payload, [
    "product.name",
    "product_name",
    "productName",
    "data.product.name",
    "data.product_name",
    "data.productName",
    "data.checkout.product.name",
    "data.purchase.product.name",
  ]);

  return {
    source: "hotmart",
    receivedAt: new Date().toISOString(),
    productSlug: route.productSlug,
    subsystem: route.subsystem,
    operation: route.operation,
    eventType,
    eventId,
    email,
    productId,
    productName,
    payload,
  };
}

function logStage(stage: string, details: InputData): void {
  console.log(JSON.stringify({ stage, ...details }));
}

function normalizePath(pathname: string): string {
  return pathname.replace(/^\/+|\/+$/g, "");
}

function parseWebhookPath(pathname: string): ParsedWebhookPath {
  const normalized = normalizePath(pathname);
  if (!normalized) {
    return { ok: false, productSlug: "", subsystem: "", operation: "", isLegacy: false };
  }

  const parts = normalized.toLowerCase().split("/").filter(Boolean);
  if (parts.length === 2 && parts[0] === "webhooks" && parts[1] === "hotmart") {
    return {
      ok: true,
      productSlug: "legacy",
      subsystem: "hotmart",
      operation: "events",
      isLegacy: true,
    };
  }

  if (parts.length === 5 && parts[0] === "webhooks" && parts[1] === "v1" && parts[3] === "hotmart") {
    return {
      ok: true,
      productSlug: parts[2],
      subsystem: parts[3],
      operation: parts[4],
      isLegacy: false,
    };
  }

  return { ok: false, productSlug: "", subsystem: "", operation: "", isLegacy: false };
}

function parseForwardingRules(rawConfig: string): ForwardingRule[] {
  const raw = asString(rawConfig);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logStage("config_error", { reason: "invalid_forwarding_rules_json" });
    return [];
  }

  if (!Array.isArray(parsed)) {
    logStage("config_error", { reason: "forwarding_rules_not_array" });
    return [];
  }

  const rules: ForwardingRule[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const data = entry as InputData;
    const productSlug = asString(data.productSlug).toLowerCase();
    const subsystem = asString(data.subsystem).toLowerCase();
    const operation = asString(data.operation).toLowerCase();
    const targetUrl = asString(data.targetUrl);
    const requiredRaw = asString(data.required).toLowerCase();
    const required = requiredRaw ? requiredRaw !== "false" : true;

    if (!productSlug || !subsystem || !targetUrl) continue;

    rules.push({
      productSlug,
      subsystem,
      operation: operation || undefined,
      targetUrl,
      required,
    });
  }

  return rules;
}

function getForwardingRules(env: Env): ForwardingRule[] {
  const raw = asString(env.WEBHOOK_FORWARDING_RULES);
  if (!raw) return [];
  if (raw === cachedForwardingRulesRaw) return cachedForwardingRules;
  cachedForwardingRulesRaw = raw;
  cachedForwardingRules = parseForwardingRules(raw);
  return cachedForwardingRules;
}

function findForwardingRule(route: ParsedWebhookPath, env: Env): ForwardingRule | null {
  const rules = getForwardingRules(env);
  if (!rules.length) return null;

  const exact = rules.find(
    (rule) =>
      rule.productSlug === route.productSlug &&
      rule.subsystem === route.subsystem &&
      !!rule.operation &&
      rule.operation === route.operation
  );
  if (exact) return exact;

  const wildcard = rules.find(
    (rule) => rule.productSlug === route.productSlug && rule.subsystem === route.subsystem && !rule.operation
  );
  return wildcard || null;
}

async function forwardWebhook(rule: ForwardingRule, payload: InputData, route: ParsedWebhookPath): Promise<void> {
  const response = await fetch(rule.targetUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-source": route.subsystem,
      "x-webhook-product": route.productSlug,
      "x-webhook-operation": route.operation,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`forward_failed:${response.status}:${detail.slice(0, 200)}`);
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/health")) {
      return jsonResponse({ ok: true, worker: "api-external-webhooks" }, 200);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
    }

    const route = parseWebhookPath(url.pathname);
    if (!route.ok) {
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }

    if (route.subsystem !== "hotmart") {
      return jsonResponse({ ok: false, error: "unsupported_subsystem" }, 400);
    }

    if (!isAuthorized(request, env)) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    if (!env.HOTMART_EVENTS) {
      return jsonResponse({ ok: false, error: "queue_not_configured" }, 500);
    }

    const payload = await parseBody(request);
    const eventType =
      pickString(payload, ["event", "event_name", "type", "name", "data.event"]) ||
      asString(route.operation).toUpperCase().replace(/-/g, "_");
    if (!eventType) {
      return jsonResponse({ ok: false, error: "invalid_payload", detail: "missing_event_type" }, 400);
    }

    const event = buildQueuedEvent(payload, route);

    const forwardingRule = findForwardingRule(route, env);
    if (forwardingRule) {
      try {
        await forwardWebhook(forwardingRule, payload, route);
        logStage("forwarded", {
          productSlug: route.productSlug,
          subsystem: route.subsystem,
          operation: route.operation,
          targetUrl: forwardingRule.targetUrl,
        });
      } catch (error) {
        logStage("forward_failed", {
          productSlug: route.productSlug,
          subsystem: route.subsystem,
          operation: route.operation,
          targetUrl: forwardingRule.targetUrl,
          required: forwardingRule.required ? "1" : "0",
          message: String(error),
        });
        if (forwardingRule.required) {
          return jsonResponse({ ok: false, error: "forward_failed" }, 502);
        }
      }
    }

    await env.HOTMART_EVENTS.send(event);
    logStage("enqueued", {
      eventType: event.eventType,
      eventId: event.eventId,
      productSlug: event.productSlug,
      operation: event.operation,
      legacyPath: route.isLegacy ? "1" : "0",
      hasEmail: !!event.email,
      productId: event.productId || undefined,
      productName: event.productName || undefined,
    });

    return jsonResponse(
      {
        ok: true,
        queued: true,
        eventType: event.eventType,
        eventId: event.eventId,
      },
      202
    );
  },
};

export default worker;
