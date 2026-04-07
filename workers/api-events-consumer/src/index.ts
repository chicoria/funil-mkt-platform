import { BrevoTransactionalEmailSender } from "../../../packages/shared/transactional-email";

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface Env {
  BREVO_API_KEY?: string;
  BREVO_CART_ABANDONMENT_TEMPLATE_ID?: string;
  BREVO_REPLY_TO_EMAIL?: string;
  BREVO_REPLY_TO_NAME?: string;
  HOTMART_PRODUCTS?: string;
  DEDUPE_KV?: KVNamespaceLike;
}

interface HotmartQueuedEvent {
  source?: string;
  eventType?: string;
  eventId?: string;
  email?: string;
  payload?: Record<string, unknown>;
}

interface QueueMessage<T> {
  body: T;
}

interface MessageBatch<T> {
  messages: Array<QueueMessage<T>>;
}

type BrevoAttributes = Record<string, string>;

interface ProductConfig {
  id?: string;
  name?: string;
  nameNormalized?: string;
  prefix: string;
  checkoutCode?: string;
  defaultOfferCode?: string;
}

let cachedProductConfigs: ProductConfig[] | null = null;
let cachedProductConfigsRaw = "";

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

function getByPath(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function eventTypeNormalized(eventType: string): string {
  return eventType.toLowerCase().replace(/\s+/g, "_");
}

function isCartAbandonmentEvent(eventType: string): boolean {
  const normalized = eventTypeNormalized(eventType);
  return normalized.includes("purchase_out_of_shopping_cart") || normalized.includes("cart_abandon");
}

function normalizeProductName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeProductId(value: unknown): string {
  return asString(value);
}

function formatDateDDMMYYYY(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${day}-${month}-${year}`;
}

function formatDateYYYYMMDD(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${year}-${month}-${day}`;
}

function normalizeTag(value: string): string {
  return eventTypeNormalized(asString(value));
}

function mergeSteps(existing: string, nextTag: string): string {
  const normalizedNext = normalizeTag(nextTag);
  if (!normalizedNext) return "";

  const tags = existing
    .split(",")
    .map((tag) => normalizeTag(tag))
    .filter(Boolean);

  if (!tags.includes(normalizedNext)) {
    tags.push(normalizedNext);
  }

  return tags.join(", ");
}

function parseProductConfigs(raw: string): ProductConfig[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.log(JSON.stringify({ stage: "config_error", reason: "invalid_hotmart_products_json" }));
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.log(JSON.stringify({ stage: "config_error", reason: "hotmart_products_not_array" }));
    return [];
  }

  const configs: ProductConfig[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const data = entry as Record<string, unknown>;
    const prefix = asString(data.prefix ?? data.brevoPrefix ?? data.prefixo);
    const id = normalizeProductId(data.id ?? data.productId ?? data.product_id);
    const rawName = asString(data.name ?? data.productName ?? data.product_name);
    const nameNormalized = normalizeProductName(rawName);
    const checkoutCode = asString(data.checkoutCode ?? data.checkout_code ?? data.checkout);
    const defaultOfferCode = asString(data.offerCode ?? data.offer ?? data.offer_id ?? data.offerId);

    if (!prefix || (!id && !nameNormalized)) {
      console.log(
        JSON.stringify({
          stage: "config_error",
          reason: "hotmart_product_missing_fields",
          hasPrefix: !!prefix,
          hasId: !!id,
          hasName: !!nameNormalized,
        })
      );
      continue;
    }

    configs.push({
      prefix,
      id: id || undefined,
      name: rawName || undefined,
      nameNormalized: nameNormalized || undefined,
      checkoutCode: checkoutCode || undefined,
      defaultOfferCode: defaultOfferCode || undefined,
    });
  }

  return configs;
}

function getProductConfigs(env: Env): ProductConfig[] {
  const raw = asString(env.HOTMART_PRODUCTS);
  if (!raw) return [];
  if (cachedProductConfigs && cachedProductConfigsRaw === raw) return cachedProductConfigs;
  cachedProductConfigsRaw = raw;
  cachedProductConfigs = parseProductConfigs(raw);
  return cachedProductConfigs;
}

function resolveProductId(event: HotmartQueuedEvent): string {
  const payload = event.payload || {};
  const paths = [
    "product.id",
    "product_id",
    "productId",
    "data.product.id",
    "data.product_id",
    "data.productId",
    "data.checkout.product.id",
    "data.purchase.product.id",
  ];

  for (const path of paths) {
    const value = getByPath(payload, path);
    const normalized = normalizeProductId(value);
    if (normalized) return normalized;
  }

  return "";
}

function resolveProductName(event: HotmartQueuedEvent): string {
  const payload = event.payload || {};
  const paths = [
    "product.name",
    "product.product_name",
    "product.productName",
    "product",
    "product_name",
    "productName",
    "data.product.name",
    "data.product.product_name",
    "data.product.productName",
    "data.product",
    "data.product_name",
    "data.productName",
    "data.checkout.product.name",
    "data.purchase.product.name",
  ];

  for (const path of paths) {
    const value = asString(getByPath(payload, path));
    if (value) return value;
  }

  return "";
}

function matchProductConfig(
  productId: string,
  productName: string,
  configs: ProductConfig[]
): ProductConfig | null {
  if (productId) {
    const matchedById = configs.find((config) => config.id && config.id === productId);
    if (matchedById) return matchedById;
  }

  const normalizedName = normalizeProductName(productName);
  if (normalizedName) {
    const matchedByName = configs.find((config) => {
      if (!config.nameNormalized) return false;
      return (
        normalizedName === config.nameNormalized ||
        normalizedName.includes(config.nameNormalized) ||
        config.nameNormalized.includes(normalizedName)
      );
    });
    if (matchedByName) return matchedByName;
  }

  return null;
}

function resolveEmail(event: HotmartQueuedEvent): string {
  const direct = asString(event.email);
  if (direct) return direct;

  const payload = event.payload || {};
  const paths = ["email", "buyer.email", "customer.email", "data.buyer.email", "data.customer.email", "data.email"];

  for (const path of paths) {
    const value = asString(getByPath(payload, path));
    if (value) return value;
  }

  return "";
}

function resolveBuyerName(event: HotmartQueuedEvent): string {
  const payload = event.payload || {};
  const paths = [
    "buyer.name",
    "buyer.fullname",
    "customer.name",
    "customer.fullname",
    "data.buyer.name",
    "data.buyer.fullname",
    "data.customer.name",
    "data.customer.fullname",
    "data.buyer.full_name",
    "data.customer.full_name",
    "data.name",
  ];

  for (const path of paths) {
    const value = asString(getByPath(payload, path));
    if (value) return value;
  }

  return "";
}

function resolveOfferCode(event: HotmartQueuedEvent): string {
  const payload = event.payload || {};
  const paths = [
    "offer.code",
    "offer.id",
    "offer_id",
    "offerId",
    "data.offer.code",
    "data.offer.id",
    "data.offer_id",
    "data.offerCode",
    "data.checkout.offer.code",
    "data.checkout.offer.id",
  ];

  for (const path of paths) {
    const value = asString(getByPath(payload, path));
    if (value) return value;
  }

  return "";
}

function buildCheckoutUrl(checkoutCode: string, offerCode: string): string {
  if (checkoutCode) {
    const url = new URL(`https://pay.hotmart.com/${checkoutCode}`);
    if (offerCode) url.searchParams.set("off", offerCode);
    return url.toString();
  }

  const base = "https://links.decolesuacarreiraesg.com.br/decole-esg/checkout";
  if (!offerCode) return base;
  const url = new URL(base);
  url.searchParams.set("off", offerCode);
  return url.toString();
}

async function fetchContactAttributes(email: string, apiKey: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const detail = await response.text();
    console.log(
      JSON.stringify({
        stage: "brevo_contact_fetch_failed",
        status: response.status,
        email,
        detail: detail.slice(0, 500),
      })
    );
    return null;
  }

  try {
    const json = (await response.json()) as { attributes?: Record<string, unknown> };
    return json?.attributes || null;
  } catch {
    return null;
  }
}

async function upsertContact(
  email: string,
  apiKey: string,
  attributes: BrevoAttributes
): Promise<void> {
  if (!apiKey) {
    throw new Error("BREVO_API_KEY not configured");
  }

  const response = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      email,
      updateEnabled: true,
      attributes,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Brevo API failed (${response.status}): ${detail.slice(0, 500)}`);
  }
}

const EVENT_DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 90;
const DAILY_DEDUPE_TTL_SECONDS = 60 * 60 * 48;

function buildEventDedupeKey(eventId: string): string {
  return `hotmart:event:${eventId}`;
}

function buildDailyDedupeKey(email: string, normalizedEvent: string, dateKey: string): string {
  return `hotmart:email:${email.toLowerCase()}:${normalizedEvent}:${dateKey}`;
}

async function hasDedupeKey(kv: KVNamespaceLike | undefined, key: string): Promise<boolean> {
  if (!kv) return false;
  return (await kv.get(key)) !== null;
}

async function putDedupeKey(kv: KVNamespaceLike | undefined, key: string, ttl: number): Promise<void> {
  if (!kv) return;
  await kv.put(key, new Date().toISOString(), { expirationTtl: ttl });
}

async function processEvent(event: HotmartQueuedEvent, env: Env): Promise<boolean> {
  const eventType = asString(event.eventType);
  if (!eventType) {
    console.log(JSON.stringify({ stage: "skip", reason: "missing_event_type", eventId: event.eventId || "" }));
    return false;
  }

  const email = resolveEmail(event);
  if (!email) {
    console.log(JSON.stringify({ stage: "skip", reason: "missing_email", eventType }));
    return false;
  }

  const apiKey = asString(env.BREVO_API_KEY);
  if (!apiKey) {
    throw new Error("BREVO_API_KEY not configured");
  }

  const productConfigs = getProductConfigs(env);
  if (!productConfigs.length) {
    console.log(JSON.stringify({ stage: "skip", reason: "product_config_missing", eventType }));
    return false;
  }

  const productId = resolveProductId(event);
  const productName = resolveProductName(event);
  if (!productId && !productName) {
    console.log(
      JSON.stringify({ stage: "skip", reason: "missing_product", eventType, eventId: event.eventId || "" })
    );
    return false;
  }

  const matchedProduct = matchProductConfig(productId, productName, productConfigs);
  if (!matchedProduct) {
    console.log(
      JSON.stringify({
        stage: "skip",
        reason: "product_not_match",
        eventType,
        eventId: event.eventId || "",
        productName,
        productId,
      })
    );
    return false;
  }

  const normalizedEvent = eventTypeNormalized(eventType);
  const existingAttributes = await fetchContactAttributes(email, apiKey);
  const stepsKey = `${matchedProduct.prefix}_FUNIL_STEPS`;
  const lastStepKey = `${matchedProduct.prefix}_FUNIL_LAST_STEP`;
  const lastStepTsKey = `${matchedProduct.prefix}_FUNIL_LAST_STEP_TIMESTAMP`;
  const existingSteps =
    existingAttributes && typeof existingAttributes[stepsKey] === "string"
      ? String(existingAttributes[stepsKey])
      : "";

  const steps = mergeSteps(existingSteps, normalizedEvent);
  const attributes: BrevoAttributes = {
    [stepsKey]: steps || normalizedEvent,
    [lastStepKey]: normalizedEvent,
    [lastStepTsKey]: formatDateDDMMYYYY(new Date()),
  };

  await upsertContact(email, apiKey, attributes);

  if (isCartAbandonmentEvent(eventType)) {
    const templateId = Number(env.BREVO_CART_ABANDONMENT_TEMPLATE_ID || "0");
    if (templateId > 0) {
      const dateKey = formatDateYYYYMMDD(new Date());
      const dedupeEventKey = event.eventId ? buildEventDedupeKey(event.eventId) : "";
      const dedupeDailyKey = buildDailyDedupeKey(email, normalizedEvent, dateKey);

      if (dedupeEventKey && (await hasDedupeKey(env.DEDUPE_KV, dedupeEventKey))) {
        console.log(
          JSON.stringify({
            stage: "duplicate_skipped",
            dedupeScope: "event",
            eventType,
            eventId: event.eventId || "",
            email,
          })
        );
        return false;
      }

      if (await hasDedupeKey(env.DEDUPE_KV, dedupeDailyKey)) {
        console.log(
          JSON.stringify({
            stage: "duplicate_skipped",
            dedupeScope: "daily",
            eventType,
            eventId: event.eventId || "",
            email,
          })
        );
        return false;
      }

      const buyerName = resolveBuyerName(event);
      const buyerNameGreeting = buyerName ? ` ${buyerName}` : "";
      const offerCode = resolveOfferCode(event) || matchedProduct.defaultOfferCode || "";
      const checkoutUrl = buildCheckoutUrl(matchedProduct.checkoutCode || "", offerCode);
      const effectiveProductName = matchedProduct.name || productName || "";
      const replyToEmail = asString(env.BREVO_REPLY_TO_EMAIL);
      const replyToName = asString(env.BREVO_REPLY_TO_NAME);

      const emailSender = new BrevoTransactionalEmailSender(apiKey);
      await emailSender.send({
        to: { email, ...(buyerName ? { name: buyerName } : {}) },
        templateId,
        ...(replyToEmail ? { replyTo: { email: replyToEmail, ...(replyToName ? { name: replyToName } : {}) } } : {}),
        params: {
          productName: effectiveProductName,
          buyerName,
          buyerNameGreeting,
          email,
          offerCode,
          checkoutUrl,
        },
      });

      if (dedupeEventKey) {
        await putDedupeKey(env.DEDUPE_KV, dedupeEventKey, EVENT_DEDUPE_TTL_SECONDS);
      }
      await putDedupeKey(env.DEDUPE_KV, dedupeDailyKey, DAILY_DEDUPE_TTL_SECONDS);
    } else {
      console.log(
        JSON.stringify({
          stage: "skip",
          reason: "cart_abandonment_template_not_configured",
          eventType,
          eventId: event.eventId || "",
        })
      );
    }
  }
  console.log(
    JSON.stringify({
      stage: "processed",
      eventType,
      eventId: event.eventId || "",
      email,
      productName,
      productId,
      productPrefix: matchedProduct.prefix,
    })
  );
  return true;
}

const worker = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/health")) {
      return jsonResponse({ ok: true, worker: "api-events-consumer" }, 200);
    }

    return jsonResponse({ ok: false, error: "not_found" }, 404);
  },

  async queue(batch: MessageBatch<HotmartQueuedEvent>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await processEvent(message.body || {}, env);
    }
  },
};

export default worker;
