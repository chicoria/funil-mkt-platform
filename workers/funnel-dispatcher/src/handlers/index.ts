import { FunnelEvent } from "../../../../packages/shared/src/funnel-event";
import bundledCatalogJson from "../../../../config/products.catalog.json";
import { DispatcherEnv, HandlerFn } from "../dispatcher";

const BREVO_BASE_URL = "https://api.brevo.com/v3";

type HandlerMap = Record<string, HandlerFn>;
type SqlBindable = string | number | null;

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
    doiRedirectUrl?: string;
    cartAbandonmentTemplateId?: string;
  };
}

interface CatalogProductConfig {
  name?: string;
  aliases?: string[];
  brevo?: {
    doiRedirectUrl?: string;
    funnelFields?: {
      steps?: string;
      lastStep?: string;
      lastStepTimestamp?: string;
    };
  };
  links?: {
    checkoutBaseUrl?: string;
  };
  tracking?: {
    sgtm?: {
      endpointUrl?: string;
      endpointEnvVar?: string;
    };
    ga4?: {
      measurementId?: string;
      measurementIdEnvVar?: string;
      apiSecretEnvVar?: string;
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
}

interface BrevoFunnelFieldsConfig {
  stepsField: string;
  lastStepField: string;
  lastStepTimestampField: string;
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function envString(env: DispatcherEnv, key: string | undefined): string {
  if (!key) return "";
  return asString(env[key]);
}

function isTruthyFlag(value: unknown): boolean {
  const normalized = asString(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function unixTime(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
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
  if (eventType === "PURCHASE_OUT_OF_SHOPPING_CART") return "purchase_out_of_shopping_cart";
  return eventType.toLowerCase();
}

function eventToMetaName(eventType: string): string {
  if (eventType === "PURCHASE_APPROVED") return "Purchase";
  if (eventType === "BEGIN_CHECKOUT") return "InitiateCheckout";
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
  const payloadJson = JSON.stringify(event.payload || {});

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
  const sgtmEndpointUrl =
    envString(env, tracking?.sgtm?.endpointEnvVar) ||
    asString(tracking?.sgtm?.endpointUrl) ||
    asString(env.SGTM_ENDPOINT_URL);

  return { sgtmEndpointUrl };
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

function resolveDoiConfirmationUrl(event: FunnelEvent, env: DispatcherEnv): string {
  const payload = event.payload || {};
  const fromPayload =
    asString(payload.confirmation_url) ||
    asString(payload.confirmationUrl) ||
    asString(payload.doi_redirect_url) ||
    asString(payload.doiRedirectUrl);
  if (fromPayload) return fromPayload;

  const catalog = getCatalog(env);
  const product = getCatalogProduct(catalog, event.product_code);
  const fromEventConfig = asString(resolveCatalogEvent(event, env)?.brevoConfig?.doiRedirectUrl);
  if (fromEventConfig) return fromEventConfig;

  const fromProductConfig = asString(product?.brevo?.doiRedirectUrl);
  if (fromProductConfig) return fromProductConfig;

  return asString(env.BREVO_DOI_REDIRECT_URL);
}

function resolveCartAbandonmentTemplateId(event: FunnelEvent, env: DispatcherEnv): string {
  const fromEventConfig = asString(resolveCatalogEvent(event, env)?.brevoConfig?.cartAbandonmentTemplateId);
  if (fromEventConfig) return fromEventConfig;
  return asString(env.BREVO_CART_ABANDON_TEMPLATE_ID || env.BREVO_CART_ABANDONMENT_TEMPLATE_ID);
}

function resolveCartAbandonmentParams(event: FunnelEvent, env: DispatcherEnv): Record<string, unknown> {
  const payload = event.payload || {};
  const catalog = getCatalog(env);
  const product = getCatalogProduct(catalog, event.product_code);
  const checkoutUrl =
    asString(payload.checkout_url) ||
    asString(payload.checkoutUrl) ||
    asString(payload.checkout_url_recovery) ||
    asString(product?.links?.checkoutBaseUrl);
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

  if (!tracking.sgtmEndpointUrl) {
    console.log(
      JSON.stringify({
        stage: "handler_skip",
        handler: "emit_tracking",
        destination: "sgtm",
        reason: "missing_product_tracking_config",
        product_code: event.product_code,
      })
    );
    return;
  }

  const email = asString(event.lead?.email).toLowerCase();
  const userData: Record<string, string[]> = {};
  if (email) {
    userData.em = [await sha256Hex(email)];
  } else if (asString(event.identity?.email_hash)) {
    userData.em = [asString(event.identity?.email_hash)];
  }

  await postJson(tracking.sgtmEndpointUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_id: event.event_id,
      event_type: event.event_type,
      product_code: event.product_code,
      source: event.source,
      occurred_at: event.occurred_at,
      ga4_event_name: eventToGa4Name(event.event_type),
      meta_event_name: eventToMetaName(event.event_type),
      client_id: asString(event.identity?.anonymous_id) || event.event_id,
      session_id: asString(event.identity?.session_id) || undefined,
      lead_id: asString(event.identity?.lead_id || event.lead?.lead_id) || undefined,
      event_source_url: eventSourceUrl || undefined,
      transaction_id: transactionId || undefined,
      value,
      currency,
      attribution: {
        fbp: asString(event.attribution?.fbp) || undefined,
        fbc: asString(event.attribution?.fbc) || undefined,
        gclid: asString(event.attribution?.gclid) || undefined,
        wbraid: asString(event.attribution?.wbraid) || undefined,
        gbraid: asString(event.attribution?.gbraid) || undefined,
        utm_source: asString(event.attribution?.utm_source) || undefined,
        utm_medium: asString(event.attribution?.utm_medium) || undefined,
        utm_campaign: asString(event.attribution?.utm_campaign) || undefined,
      },
      user_data: userData,
      payload,
      sent_at: new Date().toISOString(),
      event_time_unix: unixTime(event.occurred_at),
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

  await postJson(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
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

    async send_brevo_doi(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "send_brevo_doi", event_id: event.event_id }));
      const confirmationUrl = resolveDoiConfirmationUrl(event, env);
      if (!confirmationUrl) {
        console.log(
          JSON.stringify({
            stage: "handler_warn",
            handler: "send_brevo_doi",
            reason: "missing_confirmation_url",
            product_code: event.product_code,
            event_type: event.event_type,
          })
        );
      }
      await sendBrevoEmail(event, env, asString(env.BREVO_DOI_TEMPLATE_ID), {
        confirmation_url: confirmationUrl,
      });
    },

    async update_brevo_funnel(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "update_brevo_funnel", event_id: event.event_id }));
      await updateBrevoFunnel(event, env);
    },

    async send_cart_abandonment_email(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "send_cart_abandonment_email", event_id: event.event_id }));
      await sendBrevoEmail(event, env, resolveCartAbandonmentTemplateId(event, env), resolveCartAbandonmentParams(event, env));
    },

    async forward_n8n(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "forward_n8n", event_id: event.event_id }));
      await forwardN8n(event, env);
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
