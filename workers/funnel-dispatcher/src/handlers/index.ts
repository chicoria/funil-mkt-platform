import { FunnelEvent } from "../../../../packages/shared/src/funnel-event";
import bundledCatalogJson from "../../../../config/products.catalog.json";
import { DispatcherEnv, HandlerFn } from "../dispatcher";

const BREVO_BASE_URL = "https://api.brevo.com/v3";
const LINKS_BASE_URL = "https://links.decolesuacarreiraesg.com.br";
const CHECKOUT_RECOVERY_KEY_PREFIX = "checkout_recovery:";
const CHECKOUT_RECOVERY_INDEX_PREFIX = "checkout_recovery_index:";
const CHECKOUT_RECOVERY_TTL_SECONDS = 14 * 24 * 60 * 60;
const CHECKOUT_RECOVERY_PARAM_KEYS = [
  "email",
  "name",
  "phoneac",
  "phonenumber",
  "fbp",
  "fbc",
  "fbclid",
  "gclid",
  "wbraid",
  "gbraid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "anonymous_id",
  "session_id",
  "lead_id",
  "off",
  "offer",
] as const;

type HandlerMap = Record<string, HandlerFn>;
type SqlBindable = string | number | null;
type KVNamespaceLike = NonNullable<DispatcherEnv["IDENTITY_KV"]>;

interface D1StatementLike {
  bind(...values: SqlBindable[]): D1StatementLike;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
}

interface CatalogEventConfig {
  eventType?: string;
  id?: string;
  brevoConfig?: {
    listId?: string;
    listIds?: Array<string | number>;
    doiTemplateId?: string;
    doiRedirectUrl?: string;
    cartAbandonmentTemplateId?: string;
  };
}

interface CatalogProductConfig {
  name?: string;
  aliases?: string[];
  brevo?: {
    doiRedirectUrl?: string;
    lists?: {
      precheckout?: {
        id?: string;
      };
    };
    templates?: {
      doi?: {
        id?: string;
      };
    };
    funnelFields?: {
      steps?: string;
      lastStep?: string;
      lastStepTimestamp?: string;
    };
  };
  links?: {
    checkoutPath?: string;
    checkoutBaseUrl?: string;
  };
  tracking?: {
    productCode?: string;
    sgtm?: {
      endpointUrl?: string;
      endpointEnvVar?: string;
    };
    ga4?: {
      measurementId?: string;
      measurementIdEnvVar?: string;
      apiSecretEnvVar?: string;
      differentiationKeys?: Record<string, string>;
    };
    metaPixel?: {
      pixelId?: string;
      pixelIdEnvVar?: string;
      capiTokenEnvVar?: string;
      testEventCodeEnvVar?: string;
    };
  };
  meta?: {
    pixelIdEnvVar?: string;
    capiTokenEnvVar?: string;
    testEventCodeEnvVar?: string;
  };
  funnelEventArchitecture?: {
    events?: CatalogEventConfig[];
  };
}

interface ParsedCatalog {
  products?: Record<string, CatalogProductConfig>;
}

const bundledCatalog = bundledCatalogJson as ParsedCatalog;

interface TrackingDestinationConfig {
  sgtmEndpointUrl: string;
  ga4MeasurementId: string;
  ga4ApiSecret: string;
  metaTestEventCode: string;
  productDimensionValue: string;
}

interface BrevoFunnelFieldsConfig {
  stepsField: string;
  lastStepField: string;
  lastStepTimestampField: string;
}

interface CheckoutRecoveryRecord {
  version: number;
  product_code: string;
  event_id: string;
  profile_id?: string;
  params: Record<string, string>;
  index_keys?: string[];
  created_at: string;
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function envString(env: DispatcherEnv, key: string | undefined): string {
  if (!key) return "";
  return asString(env[key]);
}

function asAbsoluteHttpUrl(value: unknown): string {
  const raw = asString(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function asPositiveInteger(value: unknown): number | null {
  const raw = asString(value);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeUniqueIds(values: unknown[]): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const nested of normalizeUniqueIds(value)) {
        if (!seen.has(nested)) {
          seen.add(nested);
          ids.push(nested);
        }
      }
      continue;
    }
    const id = asPositiveInteger(value);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function isTruthyFlag(value: unknown): boolean {
  const normalized = asString(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isPlanovooProductCode(productCode: string): boolean {
  const normalized = productCode.toUpperCase();
  return normalized === "DECOLE_PLANOVOO" || normalized === "PLANOVOO" || normalized === "PLANO_VOO";
}

function unixTime(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

function stableHash32(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeGa4ClientId(rawValue: string, fallbackSeed: string, occurredAt: string): string {
  const raw = asString(rawValue);
  if (/^\d+\.\d+$/.test(raw)) return raw;
  const seconds = unixTime(occurredAt);
  const hash = stableHash32(raw || fallbackSeed || crypto.randomUUID());
  return `${hash}.${seconds}`;
}

async function sha256Hex(value: string): Promise<string> {
  const input = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function eventToGa4Name(eventType: string): string {
  if (eventType === "BEGIN_CHECKOUT") return "begin_checkout";
  if (eventType === "PURCHASE_APPROVED") return "purchase";
  if (eventType === "GENERATE_LEAD" || eventType === "PRECHECKOUT_SUBMIT_SUCCESS") return "generate_lead";
  if (eventType === "PURCHASE_OUT_OF_SHOPPING_CART") return "begin_checkout";
  return eventType.toLowerCase();
}

function eventToMetaName(eventType: string): string {
  if (eventType === "PURCHASE_APPROVED") return "Purchase";
  if (eventType === "BEGIN_CHECKOUT" || eventType === "PURCHASE_OUT_OF_SHOPPING_CART") return "InitiateCheckout";
  if (eventType === "GENERATE_LEAD" || eventType === "PRECHECKOUT_SUBMIT_SUCCESS") return "Lead";
  return eventType;
}

function numberFromPayload(payload: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = payload[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function payloadString(payload: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(payload[key]);
    if (value) return value;
  }
  return "";
}

function nestedValue(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function nestedString(data: Record<string, unknown>, paths: string[]): string {
  for (const path of paths) {
    const value = asString(nestedValue(data, path));
    if (value) return value;
  }
  return "";
}

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

function getIdentityDb(env: DispatcherEnv): D1DatabaseLike | null {
  if (!env.IDENTITY_DB || typeof env.IDENTITY_DB !== "object") return null;
  const db = env.IDENTITY_DB as D1DatabaseLike;
  if (typeof db.prepare !== "function") return null;
  return db;
}

function getEventStoreDb(env: DispatcherEnv): D1DatabaseLike | null {
  if (!env.EVENT_STORE_DB || typeof env.EVENT_STORE_DB !== "object") return null;
  const db = env.EVENT_STORE_DB as D1DatabaseLike;
  if (typeof db.prepare !== "function") return null;
  return db;
}

function ensureIdentity(event: FunnelEvent): { anonymousId: string; emailHash: string; profileId?: string } {
  const anonymousId = asString(event.identity?.anonymous_id) || `anon-${event.event_id}`;
  const emailHash = asString(event.identity?.email_hash);
  const payloadProfileId = asString((event.payload || {}).profile_id);
  const profileId = payloadProfileId || undefined;
  return { anonymousId, emailHash, profileId };
}

async function ensureIdentitySchema(db: D1DatabaseLike): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS identity_links (
        profile_id TEXT PRIMARY KEY,
        anonymous_id TEXT,
        email_hash TEXT,
        updated_at TEXT NOT NULL
      )`
    )
    .run();
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_links_anonymous_id ON identity_links(anonymous_id)`).run();
  await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_links_email_hash ON identity_links(email_hash)`).run();
}

async function ensureEventStoreSchema(db: D1DatabaseLike): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS funnel_events (
        event_id TEXT PRIMARY KEY,
        profile_id TEXT,
        anonymous_id TEXT,
        email_hash TEXT,
        event_type TEXT NOT NULL,
        product_code TEXT NOT NULL,
        source TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    )
    .run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_funnel_events_profile ON funnel_events(profile_id, occurred_at)`).run();
}

async function resolveIdentityState(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  const state = ensureIdentity(event);
  const now = new Date().toISOString();
  const email = asString(event.lead?.email).toLowerCase();
  const computedEmailHash = state.emailHash || (email ? await sha256Hex(email) : "");

  const anonKey = `identity:anon:${state.anonymousId}`;
  const emailKey = computedEmailHash ? `identity:email:${computedEmailHash}` : "";
  const profileIdFromAnon = asString((await env.IDENTITY_KV?.get(anonKey)) || "");
  const profileIdFromEmail = emailKey ? asString((await env.IDENTITY_KV?.get(emailKey)) || "") : "";
  const profileId = state.profileId || profileIdFromAnon || profileIdFromEmail || crypto.randomUUID();

  event.identity = {
    ...(event.identity || {}),
    anonymous_id: state.anonymousId,
    email_hash: computedEmailHash || undefined,
  };
  event.payload = { ...(event.payload || {}), profile_id: profileId };

  if (env.IDENTITY_KV) {
    await env.IDENTITY_KV.put(anonKey, profileId, { expirationTtl: 365 * 24 * 60 * 60 });
    if (emailKey) {
      await env.IDENTITY_KV.put(emailKey, profileId, { expirationTtl: 365 * 24 * 60 * 60 });
    }
  }

  const identityDb = getIdentityDb(env);
  if (!identityDb) {
    return;
  }

  await ensureIdentitySchema(identityDb);
  await identityDb
    .prepare(
      `INSERT INTO identity_links (profile_id, anonymous_id, email_hash, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET
         anonymous_id = excluded.anonymous_id,
         email_hash = COALESCE(excluded.email_hash, identity_links.email_hash),
         updated_at = excluded.updated_at`
    )
    .bind(profileId, state.anonymousId, computedEmailHash || null, now)
    .run();
}

async function upsertEventStoreRecord(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  const db = getEventStoreDb(env);
  if (!db) {
    return;
  }

  await ensureEventStoreSchema(db);

  const profileId = asString((event.payload || {}).profile_id) || null;
  const anonymousId = asString(event.identity?.anonymous_id) || null;
  const emailHash = asString(event.identity?.email_hash) || null;
  // Merge attribution into payload_json so enrich_attribution can recover fbp/fbc/client_ip
  // from prior site events. event.payload keys take precedence over attribution keys.
  const payloadJson = JSON.stringify({ ...(event.attribution || {}), ...(event.payload || {}) });

  await db
    .prepare(
      `INSERT INTO funnel_events (
        event_id, profile_id, anonymous_id, email_hash, event_type, product_code, source, occurred_at, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET
        profile_id = COALESCE(excluded.profile_id, funnel_events.profile_id),
        anonymous_id = COALESCE(excluded.anonymous_id, funnel_events.anonymous_id),
        email_hash = COALESCE(excluded.email_hash, funnel_events.email_hash),
        payload_json = excluded.payload_json`
    )
    .bind(
      event.event_id,
      profileId,
      anonymousId,
      emailHash,
      event.event_type,
      event.product_code,
      event.source,
      event.occurred_at,
      payloadJson,
      new Date().toISOString()
    )
    .run();
}

async function enrichAttributionFromHistory(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  const db = getEventStoreDb(env);
  if (!db) return;

  const profileId = asString((event.payload || {}).profile_id);
  if (!profileId) return;

  const attr = event.attribution || {};
  const needsEnrichment = !attr.fbp && !attr.fbc && !attr.client_ip;
  if (!needsEnrichment) return;

  let row: { payload_json: string } | null = null;
  try {
    const result = await db
      .prepare(
        `SELECT payload_json FROM funnel_events
         WHERE profile_id = ? AND source = 'site'
         ORDER BY occurred_at DESC LIMIT 1`
      )
      .bind(profileId)
      .first<{ payload_json: string }>();
    row = result ?? null;
  } catch {
    return;
  }

  if (!row) return;

  let sitePayload: Record<string, unknown> = {};
  try {
    sitePayload = JSON.parse(row.payload_json);
  } catch {
    return;
  }

  const pick = (keys: string[]): string => {
    for (const k of keys) {
      const v = sitePayload[k];
      if (v && typeof v === "string") return v;
    }
    return "";
  };

  const fbp = pick(["fbp", "FBP"]);
  const fbc = pick(["fbc", "FBC"]);
  const clientIp = pick(["client_ip"]);

  if (!fbp && !fbc && !clientIp) return;

  event.attribution = {
    ...attr,
    ...(fbp && !attr.fbp ? { fbp } : {}),
    ...(fbc && !attr.fbc ? { fbc } : {}),
    ...(clientIp && !attr.client_ip ? { client_ip: clientIp } : {}),
  };

  console.log(
    JSON.stringify({
      stage: "enrich_attribution",
      event_id: event.event_id,
      profile_id: profileId,
      enriched: { fbp: Boolean(fbp && !attr.fbp), fbc: Boolean(fbc && !attr.fbc), client_ip: Boolean(clientIp && !attr.client_ip) },
    })
  );
}

async function postJson(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`http_error:${response.status}:${body.slice(0, 300)}`);
  }
}

function parseCatalog(raw: string | undefined): ParsedCatalog {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as ParsedCatalog;
    return {};
  } catch {
    return {};
  }
}

function getCatalog(env: DispatcherEnv): ParsedCatalog {
  const fromEnv = parseCatalog(env.CATALOG_JSON);
  if (fromEnv.products) return fromEnv;
  return bundledCatalog;
}

function getCatalogProduct(catalog: ParsedCatalog, productCode: string): CatalogProductConfig | undefined {
  const products = catalog.products || {};
  const direct = products[productCode];
  if (direct) return direct;

  const normalizedProductCode = productCode.toUpperCase();
  return Object.values(products).find((product) =>
    (product.aliases || []).some((alias) => alias.toUpperCase() === normalizedProductCode)
  );
}

function resolveTrackingConfig(event: FunnelEvent, env: DispatcherEnv): TrackingDestinationConfig {
  const product = getCatalogProduct(getCatalog(env), event.product_code);
  const tracking = product?.tracking;
  const fallbackMeta = product?.meta;
  const sgtmEndpointUrl =
    envString(env, tracking?.sgtm?.endpointEnvVar) ||
    asString(tracking?.sgtm?.endpointUrl) ||
    asString(env.SGTM_ENDPOINT_URL);
  const ga4MeasurementId =
    envString(env, tracking?.ga4?.measurementIdEnvVar) ||
    asString(tracking?.ga4?.measurementId) ||
    asString(env.GA4_MEASUREMENT_ID);
  const ga4ApiSecret =
    envString(env, tracking?.ga4?.apiSecretEnvVar) ||
    asString(env.GA4_API_SECRET);
  const metaTestEventCode =
    envString(env, tracking?.metaPixel?.testEventCodeEnvVar) ||
    envString(env, fallbackMeta?.testEventCodeEnvVar) ||
    asString(env.META_TEST_EVENT_CODE);
  const productDimensionValue =
    asString(tracking?.ga4?.differentiationKeys?.produto) ||
    asString(tracking?.productCode) ||
    event.product_code;

  return { sgtmEndpointUrl, ga4MeasurementId, ga4ApiSecret, metaTestEventCode, productDimensionValue };
}

function resolveCatalogEvent(event: FunnelEvent, env: DispatcherEnv): CatalogEventConfig | null {
  const product = getCatalogProduct(getCatalog(env), event.product_code);
  const events = product?.funnelEventArchitecture?.events || [];
  const target = event.event_type.toUpperCase();
  return (
    events.find((entry) => {
      const candidate = asString(entry.eventType || entry.id).toUpperCase();
      return candidate === target;
    }) || null
  );
}

function resolveDoiRedirectionUrl(event: FunnelEvent, env: DispatcherEnv): string {
  const catalog = getCatalog(env);
  const product = getCatalogProduct(catalog, event.product_code);
  const fromEventConfig = asAbsoluteHttpUrl(resolveCatalogEvent(event, env)?.brevoConfig?.doiRedirectUrl);
  if (fromEventConfig) return fromEventConfig;

  const fromProductConfig = asAbsoluteHttpUrl(product?.brevo?.doiRedirectUrl);
  if (fromProductConfig) return fromProductConfig;

  return asAbsoluteHttpUrl(env.BREVO_DOI_REDIRECT_URL);
}

function resolveDoiListIds(event: FunnelEvent, env: DispatcherEnv): number[] {
  const catalog = getCatalog(env);
  const product = getCatalogProduct(catalog, event.product_code);
  const eventConfig = resolveCatalogEvent(event, env)?.brevoConfig;
  return normalizeUniqueIds([
    eventConfig?.listIds,
    eventConfig?.listId,
    product?.brevo?.lists?.precheckout?.id,
    env.BREVO_DOI_LIST_ID,
  ]);
}

function resolveDoiTemplateId(event: FunnelEvent, env: DispatcherEnv): string {
  const fromEventConfig = asString(resolveCatalogEvent(event, env)?.brevoConfig?.doiTemplateId);
  if (fromEventConfig) return fromEventConfig;

  const product = getCatalogProduct(getCatalog(env), event.product_code);
  const fromProductConfig = asString(product?.brevo?.templates?.doi?.id);
  if (fromProductConfig) return fromProductConfig;

  return asString(env.BREVO_DOI_TEMPLATE_ID);
}

function resolveCartAbandonmentTemplateId(event: FunnelEvent, env: DispatcherEnv): string {
  const fromEventConfig = asString(resolveCatalogEvent(event, env)?.brevoConfig?.cartAbandonmentTemplateId);
  if (fromEventConfig) return fromEventConfig;
  return asString(env.BREVO_CART_ABANDON_TEMPLATE_ID || env.BREVO_CART_ABANDONMENT_TEMPLATE_ID);
}

function setRecoveryParam(params: Record<string, string>, key: string, value: unknown): void {
  const normalized = asString(value);
  if (!normalized || params[key]) return;
  params[key] = normalized;
}

function appendRecoveryParamsFromUrl(params: Record<string, string>, rawUrl: string): void {
  if (!rawUrl) return;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }

  for (const key of CHECKOUT_RECOVERY_PARAM_KEYS) {
    setRecoveryParam(params, key, url.searchParams.get(key));
  }

  const offerCode = asString(url.searchParams.get("off")) || asString(url.searchParams.get("offer"));
  setRecoveryParam(params, "off", offerCode);
}

function splitPhoneForHotmart(rawPhone: string, rawCountry: string): { phoneac?: string; phonenumber?: string } {
  const countryDigits = digitsOnly(rawCountry);
  const phoneDigits = digitsOnly(rawPhone);
  if (!phoneDigits) return {};

  let localNumber = phoneDigits;
  if (countryDigits && localNumber.startsWith(countryDigits) && localNumber.length > countryDigits.length) {
    localNumber = localNumber.slice(countryDigits.length);
  }

  if ((!countryDigits || countryDigits === "55") && localNumber.length >= 10) {
    return {
      phoneac: localNumber.slice(0, 2),
      phonenumber: localNumber.slice(2),
    };
  }

  if (countryDigits) {
    return {
      phoneac: countryDigits,
      phonenumber: localNumber,
    };
  }

  return { phonenumber: localNumber };
}

function collectCheckoutRecoveryParamsFromPayload(params: Record<string, string>, payload: Record<string, unknown>): void {
  appendRecoveryParamsFromUrl(params, nestedString(payload, ["link_url", "linkUrl", "checkout_url", "checkoutUrl", "checkout_url_recovery"]));

  setRecoveryParam(params, "email", nestedString(payload, ["email", "EMAIL", "buyer.email", "customer.email", "data.buyer.email"]));

  const firstName = nestedString(payload, ["FIRSTNAME", "first_name", "firstName", "buyer.first_name", "data.buyer.first_name"]);
  const lastName = nestedString(payload, ["LASTNAME", "last_name", "lastName", "buyer.last_name", "data.buyer.last_name"]);
  const fullName =
    nestedString(payload, ["name", "nome", "buyer.name", "customer.name", "data.buyer.name"]) ||
    [firstName, lastName].filter(Boolean).join(" ").trim();
  setRecoveryParam(params, "name", fullName);

  setRecoveryParam(params, "phoneac", nestedString(payload, ["phoneac", "phone_ac", "PHONEAC"]));
  setRecoveryParam(params, "phonenumber", nestedString(payload, ["phonenumber", "phone_number", "PHONENUMBER"]));
  if (!params.phoneac || !params.phonenumber) {
    const phone = nestedString(payload, [
      "phone",
      "PHONE",
      "SMS",
      "buyer.phone",
      "buyer.checkout_phone",
      "data.buyer.phone",
      "data.buyer.checkout_phone",
    ]);
    const country = nestedString(payload, ["SMS__COUNTRY_CODE", "phone_country", "country_code", "buyer.phone_country", "data.buyer.phone_country"]);
    const phoneParts = splitPhoneForHotmart(phone, country);
    setRecoveryParam(params, "phoneac", phoneParts.phoneac);
    setRecoveryParam(params, "phonenumber", phoneParts.phonenumber);
  }

  setRecoveryParam(params, "fbp", nestedString(payload, ["fbp", "FBP"]));
  setRecoveryParam(params, "fbc", nestedString(payload, ["fbc", "FBC"]));
  setRecoveryParam(params, "fbclid", nestedString(payload, ["fbclid", "FBCLID"]));
  setRecoveryParam(params, "gclid", nestedString(payload, ["gclid"]));
  setRecoveryParam(params, "wbraid", nestedString(payload, ["wbraid"]));
  setRecoveryParam(params, "gbraid", nestedString(payload, ["gbraid"]));
  setRecoveryParam(params, "utm_source", nestedString(payload, ["utm_source"]));
  setRecoveryParam(params, "utm_medium", nestedString(payload, ["utm_medium"]));
  setRecoveryParam(params, "utm_campaign", nestedString(payload, ["utm_campaign"]));
  setRecoveryParam(params, "utm_content", nestedString(payload, ["utm_content"]));
  setRecoveryParam(params, "utm_term", nestedString(payload, ["utm_term"]));
  setRecoveryParam(params, "anonymous_id", nestedString(payload, ["anonymous_id", "anonymousId"]));
  setRecoveryParam(params, "session_id", nestedString(payload, ["session_id", "sessionId"]));
  setRecoveryParam(params, "lead_id", nestedString(payload, ["lead_id", "leadId", "LEAD_ID"]));
}

function cartRecoveryCampaignName(productCode: string): string {
  const campaignProduct = productCode.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `cart_abandonment_${campaignProduct || "checkout"}`;
}

function checkoutRecoveryTokenKey(recoveryId: string): string {
  const normalized = asString(recoveryId);
  if (!normalized) return "";
  return normalized.startsWith(CHECKOUT_RECOVERY_KEY_PREFIX)
    ? normalized
    : `${CHECKOUT_RECOVERY_KEY_PREFIX}${normalized}`;
}

function parseRecoveryIndexToken(raw: string | null): string {
  const value = asString(raw);
  if (!value) return "";
  try {
    const parsed = JSON.parse(value);
    if (isRecord(parsed)) {
      return asString(parsed.recovery_id || parsed.recoveryId || parsed.token || parsed.id);
    }
  } catch {
    // Index values are plain recovery ids today. Keep JSON support for forward compatibility.
  }
  return value;
}

function parseRecoveryRecordIndexKeys(raw: string | null): string[] {
  const value = asString(raw);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed) || !Array.isArray(parsed.index_keys)) return [];
    return parsed.index_keys.map((entry) => asString(entry)).filter((entry) => entry.startsWith(CHECKOUT_RECOVERY_INDEX_PREFIX));
  } catch {
    return [];
  }
}

function recoveryIndexComponent(value: string): string {
  return encodeURIComponent(value.toLowerCase());
}

function collectPurchaseTokenHints(event: FunnelEvent): string[] {
  const payload = event.payload || {};
  return [
    nestedString(payload, ["rid", "recovery_id", "recoveryId", "checkout_recovery_id", "checkoutRecoveryId"]),
    nestedString(payload, ["params.rid", "params.recovery_id", "params.recoveryId"]),
  ].filter(Boolean);
}

function purchaseTransactionFromPayload(payload: Record<string, unknown>): string {
  return nestedString(payload, [
    "transaction",
    "transaction_id",
    "transactionId",
    "data.transaction",
    "data.purchase.transaction",
    "purchase.transaction",
  ]);
}

function resolveCanonicalProductCode(event: FunnelEvent, env: DispatcherEnv): string {
  const rawProductCode = asString(event.product_code).toUpperCase() || "UNKNOWN_PRODUCT";
  const products = getCatalog(env).products || {};
  if (products[rawProductCode]) return rawProductCode;

  const matchedEntry = Object.entries(products).find(([, product]) =>
    (product.aliases || []).some((alias) => alias.toUpperCase() === rawProductCode)
  );
  return matchedEntry?.[0] || rawProductCode;
}

async function buildCheckoutRecoveryIndexKeys(
  event: FunnelEvent,
  env: DispatcherEnv,
  recoveryParams: Record<string, string> = {}
): Promise<string[]> {
  const payload = event.payload || {};
  const productCode = resolveCanonicalProductCode(event, env);
  const keys = new Set<string>();
  const add = (kind: string, value: string): void => {
    const normalized = asString(value);
    if (!normalized) return;
    keys.add(`${CHECKOUT_RECOVERY_INDEX_PREFIX}${kind}:${productCode}:${recoveryIndexComponent(normalized)}`);
  };

  add("profile", asString(payload.profile_id));

  const email = asString(event.lead?.email || recoveryParams.email).toLowerCase();
  const emailHash = asString(event.identity?.email_hash) || (email ? await sha256Hex(email) : "");
  add("email", emailHash);

  add("transaction", purchaseTransactionFromPayload(payload));

  return [...keys];
}

async function deleteKvKey(kv: KVNamespaceLike, key: string): Promise<void> {
  if (!key) return;
  if (typeof kv.delete === "function") {
    await kv.delete(key);
    return;
  }
  await kv.put(key, "", { expirationTtl: 60 });
}

async function deleteCheckoutRecoveryToken(
  kv: KVNamespaceLike,
  recoveryId: string,
  indexKeysToDelete: Set<string>
): Promise<boolean> {
  const tokenKey = checkoutRecoveryTokenKey(recoveryId);
  if (!tokenKey) return false;

  const recordRaw = await kv.get(tokenKey);
  for (const indexKey of parseRecoveryRecordIndexKeys(recordRaw)) {
    indexKeysToDelete.add(indexKey);
  }

  await deleteKvKey(kv, tokenKey);
  return Boolean(recordRaw);
}

async function storeCheckoutRecoveryRecord(
  event: FunnelEvent,
  env: DispatcherEnv,
  recoveryId: string,
  recoveryParams: Record<string, string>
): Promise<void> {
  if (!env.IDENTITY_KV) return;

  const indexKeys = await buildCheckoutRecoveryIndexKeys(event, env, recoveryParams);
  const staleIndexKeys = new Set<string>();
  const staleRecoveryIds = new Set<string>();

  for (const indexKey of indexKeys) {
    const previousRecoveryId = parseRecoveryIndexToken(await env.IDENTITY_KV.get(indexKey));
    if (previousRecoveryId && previousRecoveryId !== recoveryId) {
      staleRecoveryIds.add(previousRecoveryId);
    }
  }

  for (const previousRecoveryId of staleRecoveryIds) {
    await deleteCheckoutRecoveryToken(env.IDENTITY_KV, previousRecoveryId, staleIndexKeys);
  }
  for (const staleIndexKey of staleIndexKeys) {
    await deleteKvKey(env.IDENTITY_KV, staleIndexKey);
  }

  const recoveryRecord: CheckoutRecoveryRecord = {
    version: 2,
    product_code: event.product_code,
    event_id: event.event_id,
    profile_id: asString((event.payload || {}).profile_id) || undefined,
    params: recoveryParams,
    index_keys: indexKeys,
    created_at: new Date().toISOString(),
  };

  await env.IDENTITY_KV.put(checkoutRecoveryTokenKey(recoveryId), JSON.stringify(recoveryRecord), {
    expirationTtl: CHECKOUT_RECOVERY_TTL_SECONDS,
  });

  for (const indexKey of indexKeys) {
    await env.IDENTITY_KV.put(indexKey, recoveryId, { expirationTtl: CHECKOUT_RECOVERY_TTL_SECONDS });
  }
}

async function invalidatePurchaseToken(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  if (!env.IDENTITY_KV) {
    console.log(
      JSON.stringify({
        stage: "handler_skip",
        handler: "invalidate_purchase_token",
        reason: "missing_identity_kv",
        event_id: event.event_id,
      })
    );
    return;
  }

  const indexKeys = await buildCheckoutRecoveryIndexKeys(event, env);
  const indexKeysToDelete = new Set(indexKeys);
  const recoveryIds = new Set(collectPurchaseTokenHints(event));

  for (const indexKey of indexKeys) {
    const recoveryId = parseRecoveryIndexToken(await env.IDENTITY_KV.get(indexKey));
    if (recoveryId) recoveryIds.add(recoveryId);
  }

  let deletedTokens = 0;
  for (const recoveryId of recoveryIds) {
    if (await deleteCheckoutRecoveryToken(env.IDENTITY_KV, recoveryId, indexKeysToDelete)) {
      deletedTokens += 1;
    }
  }
  for (const indexKey of indexKeysToDelete) {
    await deleteKvKey(env.IDENTITY_KV, indexKey);
  }

  console.log(
    JSON.stringify({
      stage: "handler_ok",
      handler: "invalidate_purchase_token",
      event_id: event.event_id,
      event_type: event.event_type,
      product_code: event.product_code,
      matched_tokens: recoveryIds.size,
      deleted_tokens: deletedTokens,
      deleted_indexes: indexKeysToDelete.size,
    })
  );
}

async function readLatestSitePayloadForRecovery(event: FunnelEvent, env: DispatcherEnv): Promise<Record<string, unknown>> {
  const db = getEventStoreDb(env);
  const profileId = asString((event.payload || {}).profile_id);
  if (!db || !profileId) return {};

  let row: { payload_json?: string } | null = null;
  try {
    row = await db
      .prepare(
        `SELECT event_type, payload_json FROM funnel_events
         WHERE profile_id = ? AND source = 'site'
         ORDER BY CASE WHEN event_type = 'BEGIN_CHECKOUT' THEN 0 ELSE 1 END, occurred_at DESC
         LIMIT 1`
      )
      .bind(profileId)
      .first<{ payload_json?: string }>();
  } catch {
    return {};
  }

  if (!row?.payload_json) return {};
  try {
    const parsed = JSON.parse(row.payload_json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function buildCheckoutRecoveryParams(event: FunnelEvent, env: DispatcherEnv): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  const sitePayload = await readLatestSitePayloadForRecovery(event, env);
  collectCheckoutRecoveryParamsFromPayload(params, sitePayload);
  collectCheckoutRecoveryParamsFromPayload(params, event.payload || {});

  setRecoveryParam(params, "email", event.lead?.email);
  const leadPhone = asString(event.lead?.phone);
  if ((!params.phoneac || !params.phonenumber) && leadPhone) {
    const phoneParts = splitPhoneForHotmart(leadPhone, "");
    setRecoveryParam(params, "phoneac", phoneParts.phoneac);
    setRecoveryParam(params, "phonenumber", phoneParts.phonenumber);
  }
  setRecoveryParam(params, "anonymous_id", event.identity?.anonymous_id);
  setRecoveryParam(params, "session_id", event.identity?.session_id);
  setRecoveryParam(params, "lead_id", event.identity?.lead_id || event.lead?.lead_id);
  setRecoveryParam(params, "fbp", event.attribution?.fbp);
  setRecoveryParam(params, "fbc", event.attribution?.fbc);
  setRecoveryParam(params, "gclid", event.attribution?.gclid);
  setRecoveryParam(params, "wbraid", event.attribution?.wbraid);
  setRecoveryParam(params, "gbraid", event.attribution?.gbraid);
  setRecoveryParam(params, "utm_source", event.attribution?.utm_source);
  setRecoveryParam(params, "utm_medium", event.attribution?.utm_medium);
  setRecoveryParam(params, "utm_campaign", event.attribution?.utm_campaign);

  setRecoveryParam(params, "utm_source", "brevo");
  setRecoveryParam(params, "utm_medium", "email");
  setRecoveryParam(params, "utm_campaign", cartRecoveryCampaignName(event.product_code));

  return params;
}

async function buildCheckoutRecoveryLink(
  event: FunnelEvent,
  env: DispatcherEnv,
  product: CatalogProductConfig | undefined,
  fallbackCheckoutUrl: string
): Promise<string> {
  const checkoutPath = asString(product?.links?.checkoutPath);
  if (!checkoutPath || !env.IDENTITY_KV) return fallbackCheckoutUrl;

  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(checkoutPath, asString(env.LINKS_BASE_URL || env.CHECKOUT_LINKS_BASE_URL) || LINKS_BASE_URL);
  } catch {
    return fallbackCheckoutUrl;
  }

  const recoveryId = crypto.randomUUID();
  checkoutUrl.searchParams.set("rid", recoveryId);
  checkoutUrl.searchParams.set("utm_source", "brevo");
  checkoutUrl.searchParams.set("utm_medium", "email");
  checkoutUrl.searchParams.set("utm_campaign", cartRecoveryCampaignName(event.product_code));

  const recoveryParams = await buildCheckoutRecoveryParams(event, env);
  await storeCheckoutRecoveryRecord(event, env, recoveryId, recoveryParams);

  return checkoutUrl.toString();
}

async function resolveCartAbandonmentParams(event: FunnelEvent, env: DispatcherEnv): Promise<Record<string, unknown>> {
  const payload = event.payload || {};
  const catalog = getCatalog(env);
  const product = getCatalogProduct(catalog, event.product_code);
  const fallbackCheckoutUrl =
    asString(payload.checkout_url) ||
    asString(payload.checkoutUrl) ||
    asString(payload.checkout_url_recovery) ||
    asString(product?.links?.checkoutBaseUrl);
  const checkoutUrl = await buildCheckoutRecoveryLink(event, env, product, fallbackCheckoutUrl);
  const productName =
    asString(payload.product_name) ||
    asString(payload.productName) ||
    asString(product?.name);
  const firstName =
    asString(payload.first_name) ||
    asString(payload.firstName) ||
    asString(payload.nome) ||
    asString(payload.name);

  if (!checkoutUrl) {
    console.log(
      JSON.stringify({
        stage: "handler_warn",
        handler: "send_cart_abandonment_email",
        reason: "missing_checkout_url",
        product_code: event.product_code,
      })
    );
  }

  return {
    checkout_url: checkoutUrl,
    checkoutUrl,
    product_name: productName,
    productName,
    first_name: firstName,
    firstName,
  };
}

function resolveBrevoFunnelFields(event: FunnelEvent, env: DispatcherEnv): BrevoFunnelFieldsConfig | null {
  const product = getCatalogProduct(getCatalog(env), event.product_code);
  const fields = product?.brevo?.funnelFields;
  const stepsField = asString(fields?.steps);
  const lastStepField = asString(fields?.lastStep);
  const lastStepTimestampField = asString(fields?.lastStepTimestamp);

  if (!stepsField || !lastStepField || !lastStepTimestampField) {
    return null;
  }

  return {
    stepsField,
    lastStepField,
    lastStepTimestampField,
  };
}

async function resolveBrevoFunnelSteps(event: FunnelEvent, env: DispatcherEnv): Promise<string> {
  const profileId = asString((event.payload || {}).profile_id);
  const eventStoreDb = getEventStoreDb(env);
  if (!profileId || !eventStoreDb) {
    return event.event_type;
  }

  const row = await eventStoreDb
    .prepare(
      `SELECT group_concat(event_type, '|') AS steps
       FROM (
         SELECT event_type
         FROM funnel_events
         WHERE profile_id = ?
         GROUP BY event_type
         ORDER BY MIN(occurred_at)
       )`
    )
    .bind(profileId)
    .first<{ steps?: string }>();

  const fromStore = asString(row?.steps);
  if (!fromStore) {
    return event.event_type;
  }

  const seen = new Set<string>();
  const ordered = fromStore
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
  if (!seen.has(event.event_type)) {
    ordered.push(event.event_type);
  }
  return ordered.join("|");
}

async function sendBrevoEmail(
  event: FunnelEvent,
  env: DispatcherEnv,
  templateIdRaw: string,
  extraParams: Record<string, unknown> = {}
): Promise<void> {
  const apiKey = asString(env.BREVO_API_KEY);
  const email = asString(event.lead?.email);
  const templateId = Number(templateIdRaw);

  if (!apiKey || !email || !Number.isFinite(templateId) || templateId <= 0) {
    console.log(JSON.stringify({ stage: "handler_skip", handler: "brevo_email", reason: "missing_config_or_email" }));
    return;
  }

  const url = `${asString(env.BREVO_BASE_URL) || BREVO_BASE_URL}/smtp/email`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "api-key": apiKey,
  };
  if (isTruthyFlag(env.BREVO_SANDBOX)) {
    headers["X-Sib-Sandbox"] = "drop";
  }

  try {
    await postJson(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: [{ email }],
        templateId,
        params: {
          product_code: event.product_code,
          event_type: event.event_type,
          ...extraParams,
        },
      }),
    });
    console.log(JSON.stringify({ stage: "handler_ok", handler: "brevo_email", event_id: event.event_id, templateId }));
  } catch (err) {
    // Non-fatal: log and continue. Brevo errors (rate limit, invalid email, etc.)
    // must not cause queue message retries that block upsert_event_store and identity steps.
    console.log(
      JSON.stringify({
        stage: "handler_warn",
        handler: "brevo_email",
        event_id: event.event_id,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}

function setBrevoAttribute(attributes: Record<string, string>, key: string, value: unknown): void {
  const normalized = asString(value);
  if (!normalized) return;
  attributes[key] = normalized;
}

function buildBrevoSmsAttribute(payload: Record<string, unknown>): string {
  const rawPhone = nestedString(payload, [
    "SMS",
    "phone",
    "phone_number",
    "buyer.phone",
    "data.buyer.phone",
  ]);
  if (!rawPhone) return "";

  const phoneDigits = digitsOnly(rawPhone);
  if (!phoneDigits) return "";
  if (rawPhone.trim().startsWith("+")) return `+${phoneDigits}`;

  const rawCountry = nestedString(payload, [
    "SMS__COUNTRY_CODE",
    "phone_country",
    "country_code",
    "buyer.phone_country",
    "data.buyer.phone_country",
  ]);
  const countryDigits = digitsOnly(rawCountry);
  if (!countryDigits) return phoneDigits;

  const nationalNumber =
    phoneDigits.startsWith(countryDigits) && phoneDigits.length > countryDigits.length
      ? phoneDigits.slice(countryDigits.length)
      : phoneDigits;
  return `+${countryDigits}${nationalNumber}`;
}

function buildBrevoDoiAttributes(event: FunnelEvent, env: DispatcherEnv): Record<string, string> {
  const payload = event.payload || {};
  const attributes: Record<string, string> = {};
  setBrevoAttribute(attributes, "FIRSTNAME", nestedString(payload, ["FIRSTNAME", "first_name", "firstName"]));
  setBrevoAttribute(attributes, "LASTNAME", nestedString(payload, ["LASTNAME", "last_name", "lastName"]));
  setBrevoAttribute(attributes, "SMS", buildBrevoSmsAttribute(payload));
  setBrevoAttribute(attributes, "PRODUCT_CODE", event.product_code);

  const fields = resolveBrevoFunnelFields(event, env);
  if (fields) {
    setBrevoAttribute(attributes, fields.stepsField, event.event_type);
    setBrevoAttribute(attributes, fields.lastStepField, event.event_type);
    setBrevoAttribute(attributes, fields.lastStepTimestampField, event.occurred_at);
  }

  return attributes;
}

async function createBrevoDoiContact(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  const apiKey = asString(env.BREVO_API_KEY);
  const email = asString(event.lead?.email);
  const templateId = asPositiveInteger(resolveDoiTemplateId(event, env));
  const includeListIds = resolveDoiListIds(event, env);
  const redirectionUrl = resolveDoiRedirectionUrl(event, env);

  if (!apiKey || !email || !templateId || !includeListIds.length || !redirectionUrl) {
    console.log(
      JSON.stringify({
        stage: "handler_skip",
        handler: "brevo_doi",
        reason: "missing_config_or_email",
        product_code: event.product_code,
        has_email: Boolean(email),
        has_template_id: Boolean(templateId),
        has_list_ids: includeListIds.length > 0,
        has_redirection_url: Boolean(redirectionUrl),
      })
    );
    return;
  }

  const url = `${asString(env.BREVO_BASE_URL) || BREVO_BASE_URL}/contacts/doubleOptinConfirmation`;
  try {
    await postJson(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        email,
        includeListIds,
        redirectionUrl,
        templateId,
        attributes: buildBrevoDoiAttributes(event, env),
      }),
    });
    console.log(
      JSON.stringify({
        stage: "handler_ok",
        handler: "brevo_doi",
        event_id: event.event_id,
        templateId,
        includeListIds,
      })
    );
  } catch (err) {
    // Non-fatal: Brevo errors must not cause queue retries that block event store and identity steps.
    console.log(
      JSON.stringify({
        stage: "handler_warn",
        handler: "brevo_doi",
        event_id: event.event_id,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}

async function updateBrevoFunnel(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  const apiKey = asString(env.BREVO_API_KEY);
  const email = asString(event.lead?.email);

  if (!apiKey || !email) {
    console.log(JSON.stringify({ stage: "handler_skip", handler: "update_brevo_funnel", reason: "missing_config_or_email" }));
    return;
  }

  const fields = resolveBrevoFunnelFields(event, env);
  if (!fields) {
    console.log(
      JSON.stringify({
        stage: "handler_skip",
        handler: "update_brevo_funnel",
        reason: "missing_product_funnel_fields",
        product_code: event.product_code,
      })
    );
    return;
  }

  const steps = await resolveBrevoFunnelSteps(event, env);

  const url = `${asString(env.BREVO_BASE_URL) || BREVO_BASE_URL}/contacts`;
  try {
    await postJson(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        email,
        attributes: {
          [fields.stepsField]: steps,
          [fields.lastStepField]: event.event_type,
          [fields.lastStepTimestampField]: event.occurred_at,
          PRODUCT_CODE: event.product_code,
        },
        updateEnabled: true,
      }),
    });
    console.log(JSON.stringify({ stage: "handler_ok", handler: "update_brevo_funnel", event_id: event.event_id }));
  } catch (err) {
    // Non-fatal: Brevo errors must not block identity and tracking steps via queue retry
    console.log(
      JSON.stringify({
        stage: "handler_warn",
        handler: "update_brevo_funnel",
        event_id: event.event_id,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}

async function emitTracking(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  const payload = event.payload || {};
  const tracking = resolveTrackingConfig(event, env);
  const currency =
    asString(payload.currency) ||
    asString(payload.currency_code) ||
    asString(payload.currencyCode) ||
    "BRL";
  const value = numberFromPayload(payload, ["value", "amount", "price", "purchase_value", "total_value"]) ?? 0;
  const transactionId = payloadString(payload, ["transaction", "transaction_id", "transactionId"]);
  const eventSourceUrl = payloadString(payload, ["event_source_url", "eventSourceUrl", "page_url", "checkout_url", "checkoutUrl"]);
  const payloadMetaTestEventCode = payloadString(payload, [
    "meta_test_event_code",
    "test_event_code",
    "meta.test_event_code",
  ]);
  const metaTestEventCode = payloadMetaTestEventCode || tracking.metaTestEventCode;

  if (!tracking.sgtmEndpointUrl || !tracking.ga4MeasurementId || !tracking.ga4ApiSecret) {
    console.log(
      JSON.stringify({
        stage: "handler_skip",
        handler: "emit_tracking",
        destination: "sgtm",
        reason: "missing_product_tracking_config",
        product_code: event.product_code,
        has_endpoint: Boolean(tracking.sgtmEndpointUrl),
        has_measurement_id: Boolean(tracking.ga4MeasurementId),
        has_api_secret: Boolean(tracking.ga4ApiSecret),
      })
    );
    return;
  }

  const clientId = normalizeGa4ClientId(asString(event.identity?.anonymous_id), event.event_id, event.occurred_at);

  const mpUrl = `${tracking.sgtmEndpointUrl}/mp/collect?measurement_id=${encodeURIComponent(tracking.ga4MeasurementId)}&api_secret=${encodeURIComponent(tracking.ga4ApiSecret)}`;

  await postJson(mpUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      timestamp_micros: String(unixTime(event.occurred_at) * 1_000_000),
      events: [
        {
          name: eventToGa4Name(event.event_type),
          params: {
            event_id: event.event_id,
            produto: tracking.productDimensionValue,
            product_code: event.product_code,
            source: event.source,
            currency,
            value,
            ...(transactionId ? { transaction_id: transactionId } : {}),
            ...(eventSourceUrl ? { page_location: eventSourceUrl } : {}),
            ...(asString(event.identity?.session_id) ? { session_id: asString(event.identity?.session_id) } : {}),
            ...(asString(event.identity?.email_hash) ? { em: asString(event.identity?.email_hash) } : {}),
            ...(asString(event.attribution?.client_ip) ? { client_ip_address: asString(event.attribution?.client_ip) } : {}),
            ...(asString(event.attribution?.fbp) ? { fbp: asString(event.attribution?.fbp) } : {}),
            ...(asString(event.attribution?.fbc) ? { fbc: asString(event.attribution?.fbc) } : {}),
            ...(asString(event.attribution?.gclid) ? { gclid: asString(event.attribution?.gclid) } : {}),
            ...(asString(event.attribution?.utm_source) ? { utm_source: asString(event.attribution?.utm_source) } : {}),
            ...(asString(event.attribution?.utm_medium) ? { utm_medium: asString(event.attribution?.utm_medium) } : {}),
            ...(asString(event.attribution?.utm_campaign) ? { utm_campaign: asString(event.attribution?.utm_campaign) } : {}),
            ...(metaTestEventCode ? { meta_test_event_code: metaTestEventCode, test_event_code: metaTestEventCode } : {}),
            meta_event_name: eventToMetaName(event.event_type),
          },
        },
      ],
    }),
  });
}

async function forwardN8n(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  if (isTruthyFlag(env.N8N_DISABLE_FORWARD)) {
    console.log(JSON.stringify({ stage: "handler_skip", handler: "forward_n8n", reason: "disabled_by_flag" }));
    return;
  }

  const webhookUrl = asString(env.N8N_WEBHOOK_URL);
  if (!webhookUrl) {
    console.log(JSON.stringify({ stage: "handler_skip", handler: "forward_n8n", reason: "missing_webhook" }));
    return;
  }

  try {
    await postJson(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildN8nForwardPayload(event)),
    });
    console.log(JSON.stringify({ stage: "handler_ok", handler: "forward_n8n", event_id: event.event_id }));
  } catch (err) {
    // Non-fatal: n8n webhook errors must not block identity/tracking via queue retry
    console.log(
      JSON.stringify({
        stage: "handler_warn",
        handler: "forward_n8n",
        event_id: event.event_id,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}

function buildN8nForwardPayload(event: FunnelEvent): Record<string, unknown> | FunnelEvent {
  if (event.source !== "hotmart" || !isPlanovooProductCode(event.product_code)) return event;

  const payload = isRecord(event.payload) ? { ...event.payload } : {};
  const data = isRecord(payload.data) ? { ...payload.data } : {};
  for (const key of ["buyer", "purchase", "product"] as const) {
    if (data[key] === undefined && payload[key] !== undefined) {
      data[key] = payload[key];
    }
  }

  if (Object.keys(data).length > 0) {
    payload.data = data;
  }
  if (!asString(payload.event)) {
    payload.event = event.event_type;
  }
  if (!asString(payload.event_id)) {
    payload.event_id = event.event_id;
  }
  if (!asString(payload.id)) {
    payload.id = event.event_id;
  }

  payload._decole = {
    event_id: event.event_id,
    event_type: event.event_type,
    product_code: event.product_code,
    source: event.source,
    occurred_at: event.occurred_at,
  };

  return payload;
}

export function createHandlers(): HandlerMap {
  return {
    async resolve_identity(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "resolve_identity", event_id: event.event_id }));
      await resolveIdentityState(event, env);
    },

    async upsert_event_store(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "upsert_event_store", event_id: event.event_id }));
      await upsertEventStoreRecord(event, env);
    },

    async invalidate_purchase_token(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "invalidate_purchase_token", event_id: event.event_id }));
      await invalidatePurchaseToken(event, env);
    },

    async send_brevo_doi(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "send_brevo_doi", event_id: event.event_id }));
      await createBrevoDoiContact(event, env);
    },

    async update_brevo_funnel(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "update_brevo_funnel", event_id: event.event_id }));
      await updateBrevoFunnel(event, env);
    },

    async send_cart_abandonment_email(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "send_cart_abandonment_email", event_id: event.event_id }));
      await sendBrevoEmail(event, env, resolveCartAbandonmentTemplateId(event, env), await resolveCartAbandonmentParams(event, env));
    },

    async forward_n8n(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "forward_n8n", event_id: event.event_id }));
      await forwardN8n(event, env);
    },

    async enrich_attribution(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "enrich_attribution", event_id: event.event_id }));
      await enrichAttributionFromHistory(event, env);
    },

    async emit_tracking(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "emit_tracking", event_id: event.event_id }));
      await emitTracking(event, env);
    },

    async sync_brevo_segments(event: FunnelEvent): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "sync_brevo_segments", event_id: event.event_id }));
    },
  };
}
