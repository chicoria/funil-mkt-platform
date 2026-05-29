import { FunnelEvent } from "../../../../packages/shared/src/funnel-event";
import { resolveSecret, type SecretValue } from "../../../../packages/shared/src/secrets-store-wrapper";
import { resolveProfileId } from "./identity";
import { writeEngagementAe } from "./write-engagement-ae";
import bundledCatalogJson from "../../../../config/products.catalog.json";
import {
  DispatcherEnv,
  HandlerFn,
  HANDLER_RESULT_PAYLOAD_KEY,
  getHandlerResult,
  setHandlerResult,
} from "../dispatcher";
import {
  isConfiguredCatalog,
  parseCatalog,
  resolveCatalogEvent as resolveCatalogEventFromCatalog,
  resolveCatalogProduct,
  type CatalogTenantConfig,
  type ParsedCatalog,
} from "../catalog-adapter";
import { HandlerContext } from "../handler-context";
import { resolveEventTenantId, tenantScopedKey } from "../tenant-scope";
import { callProductApi, type ProductApiConfig } from "./call-product-api";
import { sendTemplateEmail, type TemplateEmailConfig } from "./send-template-email";
import {
  mergeSnapshot,
  type SessionEngagementSnapshot,
  type VslSection,
  type CtaClick,
  type FunnelStage,
} from "../../../../packages/shared/src/session-engagement";

const BREVO_BASE_URL = "https://api.brevo.com/v3";
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
const appliedD1Migrations = new WeakMap<D1DatabaseLike, Set<string>>();

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
  product_api?: ProductApiConfig;
  template_email?: TemplateEmailConfig;
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
    differentiation?: Record<string, string>;
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

interface CatalogTenantTrackingConfig {
  sgtm?: {
    endpointEnvVar?: string;
  };
  ga4?: {
    measurementId?: string;
    measurementIdEnvVar?: string;
    apiSecretEnvVar?: string;
  };
  metaCapi?: {
    accessTokenEnv?: string;
  };
}

interface CatalogTenantWithTracking extends CatalogTenantConfig {
  tracking?: CatalogTenantTrackingConfig;
}

interface CatalogTenantWithLinks extends CatalogTenantConfig {
  links?: {
    linksDomain?: string;
  };
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
  tenant_id?: string;
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

async function secretEnvString(
  env: DispatcherEnv,
  key: string | undefined,
  context: { handler?: string; field: string; tenantId: string; productCode: string }
): Promise<string> {
  const normalizedKey = asString(key);
  if (!normalizedKey) return "";

  const binding = env[normalizedKey] as SecretValue;
  if (binding === undefined || binding === null || binding === "") return "";

  try {
    return await resolveSecret(binding, normalizedKey);
  } catch (err) {
    console.log(
      JSON.stringify({
        stage: "handler_warn",
        handler: context.handler || "emit_tracking",
        reason: "secret_resolution_failed",
        field: context.field,
        secret_name: normalizedKey,
        tenant_id: context.tenantId,
        product_code: context.productCode,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return "";
  }
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
  if (eventType === "SIGN_UP") return "sign_up";
  if (eventType === "BEGIN_CHECKOUT") return "begin_checkout";
  if (eventType === "PURCHASE_APPROVED") return "purchase";
  if (eventType === "GENERATE_LEAD" || eventType === "PRECHECKOUT_SUBMIT_SUCCESS") return "generate_lead";
  if (eventType === "PURCHASE_OUT_OF_SHOPPING_CART") return "begin_checkout";
  return eventType.toLowerCase();
}

function eventToMetaName(eventType: string): string {
  if (eventType === "SIGN_UP") return "CompleteRegistration";
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

async function runD1(db: D1DatabaseLike, query: string): Promise<void> {
  await db.prepare(query).run();
}

async function runD1IgnoringError(db: D1DatabaseLike, query: string): Promise<void> {
  await db.prepare(query).run().catch(() => undefined);
}

async function runD1MigrationOnce(db: D1DatabaseLike, id: string, queries: string[]): Promise<void> {
  const cached = appliedD1Migrations.get(db);
  if (cached?.has(id)) return;

  await runD1(
    db,
    `CREATE TABLE IF NOT EXISTS __funilmkt_schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`
  );

  const row = await db
    .prepare(`SELECT id FROM __funilmkt_schema_migrations WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<{ id?: string }>();
  if (row?.id) {
    const migrations = cached || new Set<string>();
    migrations.add(id);
    appliedD1Migrations.set(db, migrations);
    return;
  }

  for (const query of queries) {
    await runD1(db, query);
  }
  await db
    .prepare(`INSERT INTO __funilmkt_schema_migrations (id, applied_at) VALUES (?, ?)`)
    .bind(id, new Date().toISOString())
    .run();

  const migrations = cached || new Set<string>();
  migrations.add(id);
  appliedD1Migrations.set(db, migrations);
}

async function ensureIdentitySchema(db: D1DatabaseLike): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS identity_links (
        tenant_id TEXT NOT NULL DEFAULT 'decole',
        profile_id TEXT NOT NULL,
        anonymous_id TEXT,
        email_hash TEXT,
        updated_at TEXT NOT NULL
      )`
    )
    .run();
  await runD1IgnoringError(db, `ALTER TABLE identity_links ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'decole'`);
  await runD1MigrationOnce(db, "2026-05-14_identity_links_tenant_pk", [
    `DROP INDEX IF EXISTS idx_identity_links_anonymous_id`,
    `DROP INDEX IF EXISTS idx_identity_links_email_hash`,
    `CREATE TABLE IF NOT EXISTS identity_links_tenant_migration (
      tenant_id TEXT NOT NULL DEFAULT 'decole',
      profile_id TEXT NOT NULL,
      anonymous_id TEXT,
      email_hash TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, profile_id)
    )`,
    `INSERT OR REPLACE INTO identity_links_tenant_migration (
      tenant_id, profile_id, anonymous_id, email_hash, updated_at
    )
    SELECT COALESCE(tenant_id, 'decole'), profile_id, anonymous_id, email_hash, updated_at
    FROM identity_links
    WHERE profile_id IS NOT NULL`,
    `DROP TABLE identity_links`,
    `ALTER TABLE identity_links_tenant_migration RENAME TO identity_links`,
  ]);
  await runD1MigrationOnce(db, "2026-05-19_identity_links_alias_rows", [
    `DROP INDEX IF EXISTS idx_identity_links_tenant_profile`,
    `DROP INDEX IF EXISTS idx_identity_links_tenant_anonymous_id`,
    `DROP INDEX IF EXISTS idx_identity_links_tenant_email_hash`,
    `CREATE TABLE IF NOT EXISTS identity_links_alias_migration (
      tenant_id TEXT NOT NULL DEFAULT 'decole',
      profile_id TEXT NOT NULL,
      anonymous_id TEXT,
      email_hash TEXT,
      updated_at TEXT NOT NULL
    )`,
    `INSERT INTO identity_links_alias_migration (
      tenant_id, profile_id, anonymous_id, email_hash, updated_at
    )
    SELECT COALESCE(tenant_id, 'decole'), profile_id, anonymous_id, NULL, updated_at
    FROM identity_links
    WHERE profile_id IS NOT NULL AND anonymous_id IS NOT NULL`,
    `INSERT INTO identity_links_alias_migration (
      tenant_id, profile_id, anonymous_id, email_hash, updated_at
    )
    SELECT COALESCE(tenant_id, 'decole'), profile_id, NULL, email_hash, updated_at
    FROM identity_links
    WHERE profile_id IS NOT NULL AND email_hash IS NOT NULL`,
    `DROP TABLE identity_links`,
    `ALTER TABLE identity_links_alias_migration RENAME TO identity_links`,
  ]);
  await runD1(db, `CREATE INDEX IF NOT EXISTS idx_identity_links_tenant_profile ON identity_links(tenant_id, profile_id)`);
  await runD1(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_links_tenant_anonymous_id ON identity_links(tenant_id, anonymous_id)`);
  await runD1(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_links_tenant_email_hash ON identity_links(tenant_id, email_hash)`);
}

async function ensureEventStoreSchema(db: D1DatabaseLike): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS funnel_events (
        tenant_id TEXT NOT NULL DEFAULT 'decole',
        event_id TEXT NOT NULL,
        profile_id TEXT,
        anonymous_id TEXT,
        email_hash TEXT,
        event_type TEXT NOT NULL,
        product_code TEXT NOT NULL,
        source TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, event_id)
      )`
    )
    .run();
  await runD1IgnoringError(db, `ALTER TABLE funnel_events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'decole'`);
  await runD1MigrationOnce(db, "2026-05-14_funnel_events_tenant_pk", [
    `DROP INDEX IF EXISTS idx_funnel_events_profile`,
    `CREATE TABLE IF NOT EXISTS funnel_events_tenant_migration (
      tenant_id TEXT NOT NULL DEFAULT 'decole',
      event_id TEXT NOT NULL,
      profile_id TEXT,
      anonymous_id TEXT,
      email_hash TEXT,
      event_type TEXT NOT NULL,
      product_code TEXT NOT NULL,
      source TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, event_id)
    )`,
    `INSERT OR REPLACE INTO funnel_events_tenant_migration (
      tenant_id, event_id, profile_id, anonymous_id, email_hash, event_type, product_code, source, occurred_at, payload_json, created_at
    )
    SELECT COALESCE(tenant_id, 'decole'), event_id, profile_id, anonymous_id, email_hash, event_type, product_code, source, occurred_at, payload_json, created_at
    FROM funnel_events
    WHERE event_id IS NOT NULL`,
    `DROP TABLE funnel_events`,
    `ALTER TABLE funnel_events_tenant_migration RENAME TO funnel_events`,
  ]);
  await runD1(db, `CREATE UNIQUE INDEX IF NOT EXISTS idx_funnel_events_tenant_event_id ON funnel_events(tenant_id, event_id)`);
  await runD1(db, `CREATE INDEX IF NOT EXISTS idx_funnel_events_tenant_profile ON funnel_events(tenant_id, profile_id, occurred_at)`);
}

interface SessionEngagementRow {
  session_id: string;
  tenant_id: string;
  product_code: string;
  anonymous_id: string | null;
  profile_id: string | null;
  funnel_stage: string | null;
  first_seen_at: string;
  last_seen_at: string;
  page_views: number;
  max_scroll_pct: number;
  lp_sections_viewed: string;
  lp_sections_engaged: string;
  cta_clicks: string;
  vsl_version: string | null;
  vsl_max_pct: number;
  vsl_sections: string;
  became_lead: number;
  purchased: number;
}

const ENGAGEMENT_ROLLUP_TYPES = new Set([
  "SECTION_VIEW",
  "SECTION_ENGAGED",
  "VSL_SECTION_START",
  "VSL_SECTION_END",
  "ENGAGEMENT_SNAPSHOT",
]);

function parseJsonArray<T>(raw: string, fallback: T[] = []): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function rowToEngagementSnapshot(row: SessionEngagementRow): SessionEngagementSnapshot {
  return {
    session_id: row.session_id,
    tenant_id: row.tenant_id,
    product_code: row.product_code,
    anonymous_id: row.anonymous_id ?? undefined,
    profile_id: row.profile_id ?? undefined,
    funnel_stage: (row.funnel_stage ?? undefined) as FunnelStage | undefined,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    page_views: row.page_views,
    max_scroll_pct: row.max_scroll_pct,
    lp_sections_viewed: parseJsonArray<string>(row.lp_sections_viewed),
    lp_sections_engaged: parseJsonArray<string>(row.lp_sections_engaged),
    cta_clicks: parseJsonArray<CtaClick>(row.cta_clicks),
    vsl_version: row.vsl_version ?? undefined,
    vsl_max_pct: row.vsl_max_pct,
    // vsl_sections guardado como objecto {section_id: {watched_sec}} — converter para array interno
    vsl_sections: (() => {
      try {
        const parsed = JSON.parse(row.vsl_sections);
        if (Array.isArray(parsed)) return parsed as VslSection[];
        if (parsed && typeof parsed === "object") {
          return Object.entries(parsed as Record<string, { watched_sec?: number }>)
            .map(([section_id, val]) => ({ section_id, watched_sec: val?.watched_sec ?? 0 }));
        }
      } catch { /* noop */ }
      return [] as VslSection[];
    })(),
    became_lead: row.became_lead === 1,
    purchased: row.purchased === 1,
  };
}

function buildEngagementPatch(event: FunnelEvent): Partial<SessionEngagementSnapshot> {
  const payload = event.payload || {};
  const eventType = event.event_type.toUpperCase();
  const patch: Partial<SessionEngagementSnapshot> = { last_seen_at: event.occurred_at };

  if (eventType === "SECTION_VIEW") {
    patch.page_views = 1;
    const sectionId = asString(payload.section_id);
    if (sectionId) patch.lp_sections_viewed = [sectionId];
    if (typeof payload.scroll_pct === "number") patch.max_scroll_pct = payload.scroll_pct;
  } else if (eventType === "SECTION_ENGAGED") {
    const sectionId = asString(payload.section_id);
    if (sectionId) patch.lp_sections_engaged = [sectionId];
  } else if (eventType === "VSL_SECTION_START" || eventType === "VSL_SECTION_END") {
    const sectionId = asString(payload.section_id);
    const watchedSec = typeof payload.watched_sec === "number" ? payload.watched_sec : 0;
    if (sectionId) patch.vsl_sections = [{ section_id: sectionId, watched_sec: watchedSec }];
    if (typeof payload.pct === "number") patch.vsl_max_pct = payload.pct;
    if (payload.version) patch.vsl_version = asString(payload.version);
  } else if (eventType === "ENGAGEMENT_SNAPSHOT") {
    if (typeof payload.page_views === "number") patch.page_views = payload.page_views;
    if (typeof payload.max_scroll_pct === "number") patch.max_scroll_pct = payload.max_scroll_pct;
    if (Array.isArray(payload.lp_sections_viewed)) patch.lp_sections_viewed = payload.lp_sections_viewed as string[];
    if (Array.isArray(payload.lp_sections_engaged)) patch.lp_sections_engaged = payload.lp_sections_engaged as string[];
    if (Array.isArray(payload.cta_clicks)) patch.cta_clicks = payload.cta_clicks as CtaClick[];
    if (payload.vsl_version) patch.vsl_version = asString(payload.vsl_version);
    if (typeof payload.vsl_max_pct === "number") patch.vsl_max_pct = payload.vsl_max_pct;
    // vsl_sections pode chegar como array [{section_id, watched_sec}] OU como objecto
    // {"vslv1_promessa": {started, ended, watched_sec}} (formato do browser SessionAccumulator)
    if (Array.isArray(payload.vsl_sections)) {
      patch.vsl_sections = payload.vsl_sections as VslSection[];
    } else if (payload.vsl_sections && typeof payload.vsl_sections === "object") {
      // Converter objecto → array para consistência interna
      patch.vsl_sections = Object.entries(payload.vsl_sections as Record<string, { watched_sec?: number }>)
        .map(([section_id, val]) => ({
          section_id,
          watched_sec: typeof val?.watched_sec === "number" ? val.watched_sec : 0,
        }));
    }
    if (payload.funnel_stage) patch.funnel_stage = payload.funnel_stage as FunnelStage;
  }

  return patch;
}

async function ensureSessionEngagementSchema(db: D1DatabaseLike): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS session_engagement (
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        product_code TEXT NOT NULL,
        anonymous_id TEXT,
        profile_id TEXT,
        funnel_stage TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        page_views INTEGER NOT NULL DEFAULT 0,
        max_scroll_pct REAL NOT NULL DEFAULT 0,
        lp_sections_viewed TEXT NOT NULL DEFAULT '[]',
        lp_sections_engaged TEXT NOT NULL DEFAULT '[]',
        cta_clicks TEXT NOT NULL DEFAULT '[]',
        vsl_version TEXT,
        vsl_max_pct REAL NOT NULL DEFAULT 0,
        vsl_sections TEXT NOT NULL DEFAULT '[]',
        became_lead INTEGER NOT NULL DEFAULT 0,
        purchased INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (tenant_id, session_id)
      )`
    )
    .run();
}

async function upsertSessionEngagementRecord(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  const db = getEventStoreDb(env);
  if (!db) {
    console.log(
      JSON.stringify({
        stage: "handler_skip",
        handler: "upsert_session_engagement",
        reason: "missing_event_store_db",
        event_id: event.event_id,
      })
    );
    return;
  }

  const tenantId = tenantIdFor(event, env);
  const profileId = asString((event.payload || {}).profile_id) || null;
  const anonymousId = asString(event.identity?.anonymous_id) || null;
  const eventType = event.event_type.toUpperCase();

  // Stitching: executar sempre que profile_id for conhecido
  if (profileId) {
    const now = new Date().toISOString();
    if (eventType === "GENERATE_LEAD" && anonymousId) {
      await db
        .prepare(
          `UPDATE session_engagement SET profile_id=?, became_lead=1, last_seen_at=? WHERE tenant_id=? AND anonymous_id=? AND profile_id IS NULL`
        )
        .bind(profileId, now, tenantId, anonymousId)
        .run();
    } else if (eventType === "PURCHASE_APPROVED" || eventType === "PURCHASE_COMPLETE") {
      await db
        .prepare(`UPDATE session_engagement SET purchased=1 WHERE tenant_id=? AND profile_id=?`)
        .bind(tenantId, profileId)
        .run();
    }
  }

  // UPSERT só para eventos engagement_rollup
  if (!ENGAGEMENT_ROLLUP_TYPES.has(eventType)) return;

  const sessionId = asString(event.identity?.session_id);
  if (!sessionId) {
    console.log(
      JSON.stringify({
        stage: "handler_skip",
        handler: "upsert_session_engagement",
        reason: "missing_session_id",
        event_id: event.event_id,
      })
    );
    return;
  }

  await ensureSessionEngagementSchema(db);

  const existingRow = await db
    .prepare(`SELECT * FROM session_engagement WHERE tenant_id=? AND session_id=? LIMIT 1`)
    .bind(tenantId, sessionId)
    .first<SessionEngagementRow>();

  const current: SessionEngagementSnapshot = existingRow
    ? rowToEngagementSnapshot(existingRow)
    : {
        session_id: sessionId,
        tenant_id: tenantId,
        product_code: event.product_code,
        anonymous_id: anonymousId ?? undefined,
        profile_id: profileId ?? undefined,
        first_seen_at: event.occurred_at,
        last_seen_at: event.occurred_at,
        page_views: 0,
        max_scroll_pct: 0,
        lp_sections_viewed: [],
        lp_sections_engaged: [],
        cta_clicks: [],
        vsl_max_pct: 0,
        vsl_sections: [],
        became_lead: false,
        purchased: false,
      };

  const patch = buildEngagementPatch(event);
  const merged = mergeSnapshot(current, patch);

  await db
    .prepare(
      `INSERT INTO session_engagement (
        tenant_id, session_id, product_code, anonymous_id, profile_id,
        funnel_stage, first_seen_at, last_seen_at, page_views, max_scroll_pct,
        lp_sections_viewed, lp_sections_engaged, cta_clicks,
        vsl_version, vsl_max_pct, vsl_sections, became_lead, purchased
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, session_id) DO UPDATE SET
        anonymous_id = COALESCE(excluded.anonymous_id, session_engagement.anonymous_id),
        profile_id = COALESCE(excluded.profile_id, session_engagement.profile_id),
        funnel_stage = excluded.funnel_stage,
        last_seen_at = excluded.last_seen_at,
        page_views = excluded.page_views,
        max_scroll_pct = excluded.max_scroll_pct,
        lp_sections_viewed = excluded.lp_sections_viewed,
        lp_sections_engaged = excluded.lp_sections_engaged,
        cta_clicks = excluded.cta_clicks,
        vsl_version = COALESCE(excluded.vsl_version, session_engagement.vsl_version),
        vsl_max_pct = excluded.vsl_max_pct,
        vsl_sections = excluded.vsl_sections,
        became_lead = excluded.became_lead,
        purchased = excluded.purchased`
    )
    .bind(
      merged.tenant_id,
      merged.session_id,
      merged.product_code,
      merged.anonymous_id ?? null,
      merged.profile_id ?? null,
      merged.funnel_stage ?? null,
      merged.first_seen_at,
      merged.last_seen_at,
      merged.page_views,
      merged.max_scroll_pct,
      JSON.stringify(merged.lp_sections_viewed),
      JSON.stringify(merged.lp_sections_engaged),
      JSON.stringify(merged.cta_clicks),
      merged.vsl_version ?? null,
      merged.vsl_max_pct,
      // Guardar vsl_sections como objecto {section_id: {watched_sec}} para json_each no dashboard
      JSON.stringify(
        Array.isArray(merged.vsl_sections)
          ? Object.fromEntries(merged.vsl_sections.map((s) => [s.section_id, { watched_sec: s.watched_sec }]))
          : (merged.vsl_sections ?? {})
      ),
      merged.became_lead ? 1 : 0,
      merged.purchased ? 1 : 0
    )
    .run();

  console.log(
    JSON.stringify({
      stage: "handler_ok",
      handler: "upsert_session_engagement",
      event_id: event.event_id,
      tenant_id: tenantId,
      session_id: sessionId,
      event_type: event.event_type,
    })
  );
}

async function resolveIdentityState(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  const tenantId = tenantIdFor(event, env);
  const state = ensureIdentity(event);
  const now = new Date().toISOString();
  const email = asString(event.lead?.email).toLowerCase();
  const computedEmailHash = state.emailHash || (email ? await sha256Hex(email) : "");

  const anonKey = tenantScopedKey(tenantId, `identity:anon:${state.anonymousId}`);
  const emailKey = computedEmailHash ? tenantScopedKey(tenantId, `identity:email:${computedEmailHash}`) : "";
  const profileIdFromAnon = asString((await env.IDENTITY_KV?.get(anonKey)) || "");
  const profileIdFromEmail = emailKey ? asString((await env.IDENTITY_KV?.get(emailKey)) || "") : "";
  // Industry-standard priority: deterministic (email) > probabilistic (device).
  // Rule: new email on same device → new profile, never inherit from anonymous_id.
  const profileId = await resolveProfileId({
    explicitProfileId: state.profileId || "",
    profileIdFromEmail,
    profileIdFromAnon,
    hasEmail: !!computedEmailHash,
  });

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
      `INSERT INTO identity_links (tenant_id, profile_id, anonymous_id, email_hash, updated_at)
       VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT(tenant_id, anonymous_id) DO UPDATE SET
         profile_id = excluded.profile_id,
         updated_at = excluded.updated_at`
    )
    .bind(tenantId, profileId, state.anonymousId, now)
    .run();
  if (computedEmailHash) {
    await identityDb
      .prepare(
        `INSERT INTO identity_links (tenant_id, profile_id, anonymous_id, email_hash, updated_at)
         VALUES (?, ?, NULL, ?, ?)
         ON CONFLICT(tenant_id, email_hash) DO UPDATE SET
           profile_id = excluded.profile_id,
           updated_at = excluded.updated_at`
      )
      .bind(tenantId, profileId, computedEmailHash, now)
      .run();
  }
}

async function upsertEventStoreRecord(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  const tenantId = tenantIdFor(event, env);
  const db = getEventStoreDb(env);
  if (!db) {
    throw new Error("event_store_db_not_configured");
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
        tenant_id, event_id, profile_id, anonymous_id, email_hash, event_type, product_code, source, occurred_at, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, event_id) DO UPDATE SET
        profile_id = COALESCE(excluded.profile_id, funnel_events.profile_id),
        anonymous_id = COALESCE(excluded.anonymous_id, funnel_events.anonymous_id),
        email_hash = COALESCE(excluded.email_hash, funnel_events.email_hash),
        payload_json = excluded.payload_json`
    )
    .bind(
      tenantId,
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

  const tenantId = tenantIdFor(event, env);
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
         WHERE tenant_id = ? AND profile_id = ? AND source = 'site'
         ORDER BY occurred_at DESC LIMIT 1`
      )
      .bind(tenantId, profileId)
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

function isBrevoDuplicateSmsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("duplicate_parameter") && message.includes("SMS");
}

function getCatalog(env: DispatcherEnv): ParsedCatalog {
  const fromEnv = parseCatalog(env.CATALOG_JSON);
  if (isConfiguredCatalog(fromEnv)) return fromEnv;
  return bundledCatalog;
}

function tenantIdFor(event: FunnelEvent, env: DispatcherEnv): string {
  return resolveEventTenantId(event, getCatalog(env));
}

function getCatalogProduct(catalog: ParsedCatalog, event: FunnelEvent): CatalogProductConfig | undefined {
  return resolveCatalogProduct(catalog, event)?.product as CatalogProductConfig | undefined;
}

async function resolveTrackingConfig(event: FunnelEvent, env: DispatcherEnv): Promise<TrackingDestinationConfig> {
  const catalog = getCatalog(env);
  const tenantId = resolveEventTenantId(event, catalog);
  const resolvedProduct = resolveCatalogProduct(catalog, event);
  const product = resolvedProduct?.product as CatalogProductConfig | undefined;
  const tracking = product?.tracking;
  const fallbackMeta = product?.meta;
  const tenant = catalog.tenants?.[tenantId] as CatalogTenantWithTracking | undefined;
  const tenantTracking = tenant?.tracking;
  const hasTenantCatalog = Boolean(catalog.tenants && Object.keys(catalog.tenants).length > 0);
  const allowLegacyFallback = !hasTenantCatalog || Boolean(product);
  const secretContext = {
    tenantId,
    productCode: resolvedProduct?.product_code || event.product_code,
  };

  const tenantSgtmEndpointUrl = await secretEnvString(
    env,
    tenantTracking?.sgtm?.endpointEnvVar,
    { ...secretContext, field: "tenant.tracking.sgtm.endpointEnvVar" }
  );
  const tenantGa4MeasurementId =
    await secretEnvString(
      env,
      tenantTracking?.ga4?.measurementIdEnvVar,
      { ...secretContext, field: "tenant.tracking.ga4.measurementIdEnvVar" }
    ) || asString(tenantTracking?.ga4?.measurementId);
  const tenantGa4ApiSecret = await secretEnvString(
    env,
    tenantTracking?.ga4?.apiSecretEnvVar,
    { ...secretContext, field: "tenant.tracking.ga4.apiSecretEnvVar" }
  );
  const sgtmEndpointUrl =
    tenantSgtmEndpointUrl ||
    (allowLegacyFallback
      ? await secretEnvString(env, tracking?.sgtm?.endpointEnvVar, { ...secretContext, field: "product.tracking.sgtm.endpointEnvVar" }) ||
        asString(tracking?.sgtm?.endpointUrl)
      : "");
  const ga4MeasurementId =
    tenantGa4MeasurementId ||
    (allowLegacyFallback
      ? await secretEnvString(env, tracking?.ga4?.measurementIdEnvVar, { ...secretContext, field: "product.tracking.ga4.measurementIdEnvVar" }) ||
        asString(tracking?.ga4?.measurementId)
      : "");
  const ga4ApiSecret =
    tenantGa4ApiSecret ||
    (allowLegacyFallback
      ? await secretEnvString(env, tracking?.ga4?.apiSecretEnvVar, { ...secretContext, field: "product.tracking.ga4.apiSecretEnvVar" }) ||
        ""
      : "");
  const metaTestEventCode =
    (allowLegacyFallback
      ? await secretEnvString(env, tracking?.metaPixel?.testEventCodeEnvVar, { ...secretContext, field: "product.tracking.metaPixel.testEventCodeEnvVar" }) ||
        await secretEnvString(env, fallbackMeta?.testEventCodeEnvVar, { ...secretContext, field: "product.meta.testEventCodeEnvVar" })
      : "");
  const productDimensionValue =
    asString(tracking?.differentiation?.produto) ||
    asString(tracking?.ga4?.differentiationKeys?.produto) ||
    asString(tracking?.productCode) ||
    asString(resolvedProduct?.product_code) ||
    event.product_code;

  return { sgtmEndpointUrl, ga4MeasurementId, ga4ApiSecret, metaTestEventCode, productDimensionValue };
}

function resolveCatalogEvent(event: FunnelEvent, env: DispatcherEnv): CatalogEventConfig | null {
  return resolveCatalogEventFromCatalog(getCatalog(env), event, event.event_type) as CatalogEventConfig | null;
}

function resolveDoiRedirectionUrl(event: FunnelEvent, env: DispatcherEnv): string {
  const catalog = getCatalog(env);
  const product = getCatalogProduct(catalog, event);
  const fromEventConfig = asAbsoluteHttpUrl(resolveCatalogEvent(event, env)?.brevoConfig?.doiRedirectUrl);
  if (fromEventConfig) return fromEventConfig;

  const fromProductConfig = asAbsoluteHttpUrl(product?.brevo?.doiRedirectUrl);
  if (fromProductConfig) return fromProductConfig;

  return asAbsoluteHttpUrl(env.BREVO_DOI_REDIRECT_URL);
}

function resolveDoiListIds(event: FunnelEvent, env: DispatcherEnv): number[] {
  const catalog = getCatalog(env);
  const product = getCatalogProduct(catalog, event);
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

  const product = getCatalogProduct(getCatalog(env), event);
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

function checkoutRecoveryTokenKey(tenantId: string, recoveryId: string): string {
  const normalized = asString(recoveryId);
  if (!normalized) return "";
  if (normalized.startsWith(`${tenantId}:${CHECKOUT_RECOVERY_KEY_PREFIX}`)) return normalized;
  if (normalized.startsWith(CHECKOUT_RECOVERY_KEY_PREFIX)) return tenantScopedKey(tenantId, normalized);
  return tenantScopedKey(tenantId, `${CHECKOUT_RECOVERY_KEY_PREFIX}${normalized}`);
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

function parseRecoveryRecordIndexKeys(raw: string | null, tenantId: string): string[] {
  const value = asString(raw);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed) || !Array.isArray(parsed.index_keys)) return [];
    const scopedIndexPrefix = tenantScopedKey(tenantId, CHECKOUT_RECOVERY_INDEX_PREFIX);
    const keys = new Set<string>();
    for (const rawEntry of parsed.index_keys) {
      const entry = asString(rawEntry);
      if (entry.startsWith(scopedIndexPrefix)) {
        keys.add(entry);
        continue;
      }
      // Ignore legacy unscoped keys after 2.11A.9 cleanup.
    }
    return [...keys];
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
  return resolveCatalogProduct(getCatalog(env), event)?.product_code || rawProductCode;
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
    keys.add(tenantScopedKey(tenantIdFor(event, env), `${CHECKOUT_RECOVERY_INDEX_PREFIX}${kind}:${productCode}:${recoveryIndexComponent(normalized)}`));
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
  tenantId: string,
  recoveryId: string,
  indexKeysToDelete: Set<string>
): Promise<boolean> {
  const tokenKey = checkoutRecoveryTokenKey(tenantId, recoveryId);
  if (!tokenKey) return false;

  let recordRaw = await kv.get(tokenKey);
  for (const indexKey of parseRecoveryRecordIndexKeys(recordRaw, tenantId)) {
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

  const tenantId = tenantIdFor(event, env);
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
    await deleteCheckoutRecoveryToken(env.IDENTITY_KV, tenantId, previousRecoveryId, staleIndexKeys);
  }
  for (const staleIndexKey of staleIndexKeys) {
    await deleteKvKey(env.IDENTITY_KV, staleIndexKey);
  }

  const recoveryRecord: CheckoutRecoveryRecord = {
    version: 2,
    tenant_id: tenantId,
    product_code: event.product_code,
    event_id: event.event_id,
    profile_id: asString((event.payload || {}).profile_id) || undefined,
    params: recoveryParams,
    index_keys: indexKeys,
    created_at: new Date().toISOString(),
  };

  await env.IDENTITY_KV.put(checkoutRecoveryTokenKey(tenantId, recoveryId), JSON.stringify(recoveryRecord), {
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

  const tenantId = tenantIdFor(event, env);
  const indexKeys = await buildCheckoutRecoveryIndexKeys(event, env);
  const indexKeysToDelete = new Set(indexKeys);
  const recoveryIds = new Set(collectPurchaseTokenHints(event));

  for (const indexKey of indexKeys) {
    const recoveryId = parseRecoveryIndexToken(await env.IDENTITY_KV.get(indexKey));
    if (recoveryId) recoveryIds.add(recoveryId);
  }

  let deletedTokens = 0;
  for (const recoveryId of recoveryIds) {
    if (await deleteCheckoutRecoveryToken(env.IDENTITY_KV, tenantId, recoveryId, indexKeysToDelete)) {
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
  const tenantId = tenantIdFor(event, env);
  const profileId = asString((event.payload || {}).profile_id);
  if (!db || !profileId) return {};

  let row: { payload_json?: string } | null = null;
  try {
    row = await db
      .prepare(
        `SELECT event_type, payload_json FROM funnel_events
         WHERE tenant_id = ? AND profile_id = ? AND source = 'site'
         ORDER BY CASE WHEN event_type = 'BEGIN_CHECKOUT' THEN 0 ELSE 1 END, occurred_at DESC
         LIMIT 1`
      )
      .bind(tenantId, profileId)
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

function normalizeHttpBaseUrl(value: string): string {
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function resolveCheckoutLinksBaseUrl(event: FunnelEvent, env: DispatcherEnv): string {
  const catalog = getCatalog(env);
  const hasTenantCatalog = Boolean(catalog.tenants && Object.keys(catalog.tenants).length > 0);

  if (!hasTenantCatalog) {
    return normalizeHttpBaseUrl(asString(env.LINKS_BASE_URL || env.CHECKOUT_LINKS_BASE_URL));
  }

  const tenantId = resolveEventTenantId(event, catalog);
  const tenant = catalog.tenants?.[tenantId] as CatalogTenantWithLinks | undefined;
  const linksDomain = asString(tenant?.links?.linksDomain);
  if (!linksDomain) {
    console.log(
      JSON.stringify({
        stage: "handler_warn",
        handler: "send_cart_abandonment_email",
        reason: "missing_tenant_links_domain",
        tenant_id: tenantId,
        product_code: event.product_code,
        event_id: event.event_id,
      })
    );
    return "";
  }
  return normalizeHttpBaseUrl(linksDomain);
}

async function buildCheckoutRecoveryLink(
  event: FunnelEvent,
  env: DispatcherEnv,
  product: CatalogProductConfig | undefined,
  fallbackCheckoutUrl: string
): Promise<string> {
  const checkoutPath = asString(product?.links?.checkoutPath);
  if (!checkoutPath || !env.IDENTITY_KV) return fallbackCheckoutUrl;
  const linksBaseUrl = resolveCheckoutLinksBaseUrl(event, env);
  if (!linksBaseUrl) return fallbackCheckoutUrl;

  let checkoutUrl: URL;
  try {
    checkoutUrl = new URL(checkoutPath, linksBaseUrl);
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
  const product = getCatalogProduct(catalog, event);
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
  const product = getCatalogProduct(getCatalog(env), event);
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
  const tenantId = tenantIdFor(event, env);
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
         WHERE tenant_id = ? AND profile_id = ?
         GROUP BY event_type
         ORDER BY MIN(occurred_at)
       )`
    )
    .bind(tenantId, profileId)
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
  const ctx = await getOrCreateContext(event, env);
  const apiKey = ctx.credentials.brevoApiKey;
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
  const ctx = await getOrCreateContext(event, env);
  const apiKey = ctx.credentials.brevoApiKey;
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
  const attributes = buildBrevoDoiAttributes(event, env);
  const body = {
    email,
    includeListIds,
    redirectionUrl,
    templateId,
    attributes,
  };
  try {
    await postJson(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(body),
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
    if (attributes.SMS && isBrevoDuplicateSmsError(err)) {
      const retryAttributes = { ...attributes };
      delete retryAttributes.SMS;
      try {
        await postJson(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "api-key": apiKey,
          },
          body: JSON.stringify({ ...body, attributes: retryAttributes }),
        });
        console.log(
          JSON.stringify({
            stage: "handler_ok",
            handler: "brevo_doi",
            event_id: event.event_id,
            templateId,
            includeListIds,
            retry: "without_sms",
            reason: "duplicate_sms",
          })
        );
        return;
      } catch (retryErr) {
        console.log(
          JSON.stringify({
            stage: "handler_warn",
            handler: "brevo_doi",
            event_id: event.event_id,
            retry: "without_sms",
            error: retryErr instanceof Error ? retryErr.message : String(retryErr),
          })
        );
        return;
      }
    }
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
  const ctx = await getOrCreateContext(event, env);
  const apiKey = ctx.credentials.brevoApiKey;
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
  const tracking = await resolveTrackingConfig(event, env);
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
            // external_id: prefer the deterministic profile_id (resolved from email),
            // fall back to the probabilistic anonymous_id from the browser.
            ...(() => {
              const externalId =
                asString((event.payload || {}).profile_id) ||
                asString(event.identity?.anonymous_id);
              return externalId ? { external_id: externalId } : {};
            })(),
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


const chainContexts = new WeakMap<FunnelEvent, HandlerContext>();

interface ProductApiHandlerResult {
  api_response?: unknown;
  api_response_key?: unknown;
}

function resolveContextTenant(event: FunnelEvent, catalog: ParsedCatalog): string {
  return resolveEventTenantId(event, catalog);
}

async function resolveContextSecret(
  env: DispatcherEnv,
  key: string | undefined,
  context: { tenantId: string; productCode: string; field: string }
): Promise<string> {
  return secretEnvString(env, key, {
    handler: "resolve_credentials",
    tenantId: context.tenantId,
    productCode: context.productCode,
    field: context.field,
  });
}

async function resolveContextCredentials(
  tenant: CatalogTenantConfig | undefined,
  env: DispatcherEnv,
  event: FunnelEvent,
  tenantId: string,
  hasTenantCatalog: boolean
): Promise<{ brevoApiKey: string; hotmartToken: string; replyToEmail?: string }> {
  const credentials = tenant?.credentials;
  const productCode = asString(event.product_code);
  if (credentials) {
    const brevoApiKeyEnv = asString(credentials.brevo_api_key_env);
    const hotmartTokenEnv = asString(credentials.hotmart_token_env);
    const replyToEmail = asString(credentials.replyToEmail);
    return {
      brevoApiKey: await resolveContextSecret(env, brevoApiKeyEnv, {
        tenantId,
        productCode,
        field: "tenant.credentials.brevo_api_key_env",
      }),
      hotmartToken: await resolveContextSecret(env, hotmartTokenEnv, {
        tenantId,
        productCode,
        field: "tenant.credentials.hotmart_token_env",
      }),
      ...(replyToEmail ? { replyToEmail } : {}),
    };
  }

  if (!hasTenantCatalog) {
    return {
      brevoApiKey: await resolveContextSecret(env, "BREVO_API_KEY", {
        tenantId,
        productCode,
        field: "legacy.BREVO_API_KEY",
      }),
      hotmartToken: "",
      replyToEmail: "",
    };
  }

  return {
    brevoApiKey: "",
    hotmartToken: "",
    replyToEmail: "",
  };
}

async function getOrCreateContext(event: FunnelEvent, env: DispatcherEnv): Promise<HandlerContext> {
  let ctx = chainContexts.get(event);
  if (ctx) return ctx;

  const catalog = getCatalog(env);
  const tenantId = resolveContextTenant(event, catalog);
  const hasTenantCatalog = Boolean(catalog.tenants && Object.keys(catalog.tenants).length > 0);
  ctx = new HandlerContext(
    event,
    env,
    tenantId,
    await resolveContextCredentials(catalog.tenants?.[tenantId], env, event, tenantId, hasTenantCatalog)
  );
  const productApiResult = getHandlerResult<ProductApiHandlerResult>(event, "call_product_api");
  if (productApiResult && isRecord(productApiResult)) {
    if (productApiResult.api_response !== undefined) {
      ctx.set("api_response", productApiResult.api_response);
    }
    if (productApiResult.api_response_key !== undefined) {
      ctx.set("api_response_key", productApiResult.api_response_key);
    }
  }
  chainContexts.set(event, ctx);
  return ctx;
}

function persistProductApiResult(event: FunnelEvent, ctx: HandlerContext): void {
  const apiResponse = ctx.get("api_response");
  const apiResponseKey = ctx.get("api_response_key");
  if (apiResponse === undefined && apiResponseKey === undefined) return;

  setHandlerResult(event, "call_product_api", {
    ...(apiResponse !== undefined ? { api_response: apiResponse } : {}),
    ...(apiResponseKey !== undefined ? { api_response_key: apiResponseKey } : {}),
  });
}

function resolveGenericEventConfig(event: FunnelEvent, env: DispatcherEnv): CatalogEventConfig | null {
  return resolveCatalogEvent(event, env);
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

    async upsert_session_engagement(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "upsert_session_engagement", event_id: event.event_id }));
      await upsertSessionEngagementRecord(event, env);
      // Write raw event to Analytics Engine for drill-down (fire-and-forget, no-op if binding absent)
      const tenantId = event.tenant_id ?? "decole";
      writeEngagementAe(event, env.ENGAGEMENT_AE as import("../dispatcher").AnalyticsEngineDataset | undefined, tenantId);
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

    async call_product_api(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      const eventConfig = resolveGenericEventConfig(event, env);
      if (!eventConfig?.product_api) {
        console.log(JSON.stringify({ stage: "handler_skip", handler: "call_product_api", reason: "no_product_api_config", event_id: event.event_id }));
        return;
      }
      const ctx = await getOrCreateContext(event, env);
      await callProductApi(ctx, eventConfig.product_api);
      persistProductApiResult(event, ctx);
    },

    async send_template_email(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      const eventConfig = resolveGenericEventConfig(event, env);
      if (!eventConfig?.template_email) {
        console.log(JSON.stringify({ stage: "handler_skip", handler: "send_template_email", reason: "no_template_email_config", event_id: event.event_id }));
        return;
      }
      const ctx = await getOrCreateContext(event, env);
      await sendTemplateEmail(ctx, eventConfig.template_email);
    },
  };
}
