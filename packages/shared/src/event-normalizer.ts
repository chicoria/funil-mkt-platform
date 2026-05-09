import { FunnelEvent, FunnelSource } from "./funnel-event";

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function getByPath(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function pick(data: Record<string, unknown>, paths: string[]): string {
  for (const path of paths) {
    const value = asString(getByPath(data, path));
    if (value) return value;
  }
  return "";
}

function pickRaw(data: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    const value = getByPath(data, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function normalizeTimestamp(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";

  if (typeof value === "number") {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }

  const raw = asString(value);
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      const date = new Date(ms);
      return Number.isFinite(date.getTime()) ? date.toISOString() : "";
    }
  }

  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : raw;
}

function normalizeProductCode(productCode: string): string {
  return asString(productCode).toUpperCase() || "UNKNOWN_PRODUCT";
}

function normalizeEventType(value: string, fallback = "UNKNOWN_EVENT"): string {
  const normalized = asString(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function normalizeEventId(data: Record<string, unknown>): string {
  return (
    pick(data, ["event_id", "eventId", "id", "data.id", "transaction", "data.transaction"]) ||
    crypto.randomUUID()
  );
}

function normalizeOccurredAt(data: Record<string, unknown>): string {
  const raw = pickRaw(data, [
    "occurred_at",
    "occurredAt",
    "created_at",
    "createdAt",
    "creation_date",
    "creationDate",
    "data.created_at",
    "data.createdAt",
    "data.purchase.approved_date",
    "data.purchase.order_date",
  ]);
  return normalizeTimestamp(raw) || new Date().toISOString();
}

function baseFunnelEvent(
  source: FunnelSource,
  productCode: string,
  eventType: string,
  payload: Record<string, unknown>
): FunnelEvent {
  return {
    event_id: normalizeEventId(payload),
    event_type: normalizeEventType(eventType),
    product_code: normalizeProductCode(productCode),
    source,
    occurred_at: normalizeOccurredAt(payload),
    payload,
  };
}

export function fromHotmartWebhook(raw: Record<string, unknown>, productCode: string): FunnelEvent {
  const eventType = pick(raw, ["event", "event_name", "type", "name", "data.event"]) || "HOTMART_EVENT";
  const email = pick(raw, ["buyer.email", "customer.email", "email", "data.buyer.email"]);
  const phone = pick(raw, [
    "buyer.phone",
    "buyer.checkout_phone",
    "phone",
    "data.buyer.phone",
    "data.buyer.checkout_phone",
  ]);
  const value = pickRaw(raw, [
    "value",
    "amount",
    "price",
    "purchase_value",
    "total_value",
    "data.purchase.price.value",
    "data.purchase.full_price.value",
    "data.purchase.original_offer_price.value",
  ]);
  const currency = pick(raw, [
    "currency",
    "currency_code",
    "currencyCode",
    "data.purchase.price.currency_value",
    "data.purchase.full_price.currency_value",
    "data.purchase.original_offer_price.currency_value",
  ]);
  const transaction = pick(raw, ["transaction", "data.transaction", "data.purchase.transaction"]);
  const occurredAt = normalizeOccurredAt(raw);
  const payload = {
    ...raw,
    occurred_at: occurredAt,
    ...(value !== undefined ? { value } : {}),
    ...(currency ? { currency } : {}),
    ...(transaction ? { transaction } : {}),
  };

  return {
    ...baseFunnelEvent("hotmart", productCode, eventType, payload),
    lead: {
      email: email || undefined,
      phone: phone || undefined,
    },
  };
}

export function fromPrecheckoutForm(body: Record<string, unknown>, productCode: string): FunnelEvent {
  const eventType = pick(body, ["event_type", "event", "type"]) || "GENERATE_LEAD";
  const email = pick(body, ["email", "EMAIL"]);
  const phone = pick(body, ["phone", "SMS"]);
  const leadId = pick(body, ["lead_id", "LEAD_ID"]);

  return {
    ...baseFunnelEvent("site", productCode, eventType, body),
    identity: {
      anonymous_id: pick(body, ["anonymous_id", "anonymousId"]) || undefined,
      session_id: pick(body, ["session_id", "sessionId"]) || undefined,
      lead_id: leadId || undefined,
    },
    attribution: {
      fbp: pick(body, ["fbp", "FBP"]) || undefined,
      fbc: pick(body, ["fbc", "FBC"]) || undefined,
      gclid: pick(body, ["gclid"]) || undefined,
      wbraid: pick(body, ["wbraid"]) || undefined,
      gbraid: pick(body, ["gbraid"]) || undefined,
      utm_source: pick(body, ["utm_source"]) || undefined,
      utm_medium: pick(body, ["utm_medium"]) || undefined,
      utm_campaign: pick(body, ["utm_campaign"]) || undefined,
      client_ip: pick(body, ["client_ip"]) || undefined,
    },
    lead: {
      email: email || undefined,
      phone: phone || undefined,
      lead_id: leadId || undefined,
    },
  };
}

export function fromBrowserTracking(body: Record<string, unknown>, productCode: string): FunnelEvent {
  const eventType = pick(body, ["event_type", "event", "type"]) || "PAGE_VIEW";
  return {
    ...baseFunnelEvent("site", productCode, eventType, body),
    identity: {
      anonymous_id: pick(body, ["anonymous_id", "anonymousId"]) || undefined,
      session_id: pick(body, ["session_id", "sessionId"]) || undefined,
      lead_id: pick(body, ["lead_id", "LEAD_ID"]) || undefined,
    },
  };
}

export function fromAppEvent(body: Record<string, unknown>, productCode: string): FunnelEvent {
  const eventType = pick(body, ["event_type", "event", "type"]) || "APP_EVENT";
  const email = pick(body, ["email", "user.email"]);

  return {
    ...baseFunnelEvent("app", productCode, eventType, body),
    identity: {
      anonymous_id: pick(body, ["anonymous_id", "anonymousId", "device_id", "deviceId"]) || undefined,
      session_id: pick(body, ["session_id", "sessionId"]) || undefined,
      lead_id: pick(body, ["lead_id", "leadId"]) || undefined,
    },
    lead: {
      email: email || undefined,
    },
  };
}
