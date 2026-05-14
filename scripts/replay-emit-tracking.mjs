#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const defaultCatalogPath = resolve(rootDir, "config/products.catalog.json");
const defaultEnvFile = resolve(rootDir, ".env.local");
const defaultWranglerCwd = resolve(rootDir, "workers/funnel-dispatcher");

function usage() {
  console.log(`Usage:
  node scripts/replay-emit-tracking.mjs --event-id <id> [--event-id <id>] [--apply]
  node scripts/replay-emit-tracking.mjs --since <iso-date> [--limit 20] [--apply]

Options:
  --event-id <id>        Replays emit_tracking for a stored event_id. Repeatable.
  --since <iso-date>     Replays recent events from funnel_events since this timestamp.
  --limit <n>            Max rows when using --since. Default: 20.
  --db <name>            D1 database name. Default: decole-d1-event-store.
  --env-file <path>      Env file with local secrets. Default: .env.local.
  --wrangler-cwd <path>  Directory used to run wrangler.
  --meta-test-event-code <code>  Optional override to inject test_event_code in payload sent to sGTM.
  --apply                Send to sGTM /mp/collect (GA4 MP). Without this flag, runs dry-run only.`);
}

function parseArgs(argv) {
  const args = {
    eventIds: [],
    since: "",
    limit: 20,
    dbName: "decole-d1-event-store",
    envFile: defaultEnvFile,
    wranglerCwd: defaultWranglerCwd,
    metaTestEventCode: "",
    apply: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--event-id") {
      args.eventIds.push(requiredValue(argv, ++i, "--event-id"));
    } else if (arg === "--since") {
      args.since = requiredValue(argv, ++i, "--since");
    } else if (arg === "--limit") {
      args.limit = Number(requiredValue(argv, ++i, "--limit"));
    } else if (arg === "--db") {
      args.dbName = requiredValue(argv, ++i, "--db");
    } else if (arg === "--env-file") {
      args.envFile = resolve(requiredValue(argv, ++i, "--env-file"));
    } else if (arg === "--wrangler-cwd") {
      args.wranglerCwd = resolve(requiredValue(argv, ++i, "--wrangler-cwd"));
    } else if (arg === "--meta-test-event-code") {
      args.metaTestEventCode = requiredValue(argv, ++i, "--meta-test-event-code");
    } else {
      throw new Error(`unknown_arg:${arg}`);
    }
  }

  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 500) {
    throw new Error("invalid_limit");
  }
  if (!args.help && args.eventIds.length === 0 && !args.since) {
    throw new Error("missing_event_id_or_since");
  }
  for (const eventId of args.eventIds) {
    if (!/^[A-Za-z0-9._:-]+$/.test(eventId)) {
      throw new Error(`invalid_event_id:${eventId}`);
    }
  }
  if (args.since && Number.isNaN(Date.parse(args.since))) {
    throw new Error("invalid_since");
  }

  return args;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`missing_value:${flag}`);
  return value;
}

function loadEnvFile(path) {
  const env = {};
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return env;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function envValue(envFileValues, key) {
  if (!key) return "";
  return String(process.env[key] ?? envFileValues[key] ?? "").trim();
}

function applyEnvDefaults(envFileValues) {
  for (const [key, value] of Object.entries(envFileValues)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function sqlEscape(value) {
  return String(value).replaceAll("'", "''");
}

function buildSql(args) {
  const columns = "event_id, profile_id, anonymous_id, email_hash, event_type, product_code, source, occurred_at, payload_json";
  if (args.eventIds.length > 0) {
    const ids = args.eventIds.map((id) => `'${sqlEscape(id)}'`).join(", ");
    return `SELECT ${columns} FROM funnel_events WHERE event_id IN (${ids}) ORDER BY occurred_at ASC`;
  }
  return `SELECT ${columns} FROM funnel_events WHERE occurred_at >= '${sqlEscape(args.since)}' ORDER BY occurred_at ASC LIMIT ${args.limit}`;
}

function d1Query(args, sql) {
  const output = execFileSync("npx", ["wrangler", "d1", "execute", args.dbName, "--remote", "--command", sql], {
    cwd: args.wranglerCwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = output.split(/\r?\n/);
  const jsonStart = lines.findIndex((line) => line.trim().startsWith("["));
  const json = jsonStart >= 0 ? lines.slice(jsonStart).join("\n").trim() : "";
  if (!json) return [];
  const parsed = JSON.parse(json);
  return parsed.flatMap((entry) => entry.results || []);
}

function loadCatalog() {
  return JSON.parse(readFileSync(defaultCatalogPath, "utf8"));
}

function getCatalogProduct(catalog, productCode) {
  const productPools = [
    catalog.products || {},
    ...Object.values(catalog.tenants || {}).map((tenant) => tenant?.products || {}),
  ];
  const normalizedProductCode = String(productCode || "").toUpperCase();
  for (const products of productPools) {
    if (products[productCode]) return products[productCode];
    const byAlias = Object.values(products).find((product) =>
      (product?.aliases || []).some((alias) => String(alias).toUpperCase() === normalizedProductCode)
    );
    if (byAlias) return byAlias;
  }
  return undefined;
}

function catalogChainHasEmitTracking(catalog, productCode, eventType) {
  const product = getCatalogProduct(catalog, productCode) || {};
  // Catalog uses product.funnelEventArchitecture.events (mirrors dispatcher resolveChain)
  const events = Array.isArray(product?.funnelEventArchitecture?.events) ? product.funnelEventArchitecture.events : [];
  const normalizedType = String(eventType || "").toUpperCase();
  const eventConfig = events.find((e) => String(e.eventType || e.id || "").toUpperCase() === normalizedType);
  if (!eventConfig) return false; // event not in catalog → no emit_tracking
  return Array.isArray(eventConfig.chain) && eventConfig.chain.includes("emit_tracking");
}

function getPath(value, path) {
  return path.split(".").reduce((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return current[key];
  }, value);
}

function firstString(source, paths) {
  for (const path of paths) {
    const value = getPath(source, path);
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function firstNumber(source, paths) {
  for (const path of paths) {
    const value = getPath(source, path);
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function eventToGa4Name(eventType) {
  if (eventType === "PURCHASE_APPROVED") return "purchase";
  if (eventType === "GENERATE_LEAD" || eventType === "PRECHECKOUT_SUBMIT_SUCCESS") return "generate_lead";
  if (eventType === "BEGIN_CHECKOUT" || eventType === "PURCHASE_OUT_OF_SHOPPING_CART") return "begin_checkout";
  return eventType.toLowerCase();
}

function eventToMetaName(eventType) {
  if (eventType === "PURCHASE_APPROVED") return "Purchase";
  if (eventType === "BEGIN_CHECKOUT" || eventType === "PURCHASE_OUT_OF_SHOPPING_CART") return "InitiateCheckout";
  if (eventType === "GENERATE_LEAD" || eventType === "PRECHECKOUT_SUBMIT_SUCCESS") return "Lead";
  return eventType;
}

function unixTime(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

function stableHash32(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeGa4ClientId(rawValue, fallbackSeed, occurredAt) {
  const raw = String(rawValue || "").trim();
  if (/^\\d+\\.\\d+$/.test(raw)) return raw;
  const hash = stableHash32(raw || fallbackSeed || String(Date.now()));
  return `${hash}.${unixTime(occurredAt)}`;
}

function rowToEvent(row) {
  const payload = JSON.parse(row.payload_json || "{}");
  const email = firstString(payload, ["lead.email", "data.buyer.email", "buyer.email", "email"]);
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    product_code: row.product_code,
    source: row.source,
    occurred_at: row.occurred_at,
    identity: {
      anonymous_id: row.anonymous_id || undefined,
      email_hash: row.email_hash || undefined,
    },
    lead: email ? { email } : undefined,
    payload,
  };
}

function resolveTracking(event, catalog, envFileValues) {
  const product = getCatalogProduct(catalog, event.product_code) || {};
  const tracking = product.tracking || {};
  const fallbackMeta = product.meta || {};

  const sgtmEndpointUrl =
    envValue(envFileValues, tracking.sgtm?.endpointEnvVar) ||
    String(tracking.sgtm?.endpointUrl || "").trim() ||
    envValue(envFileValues, "SGTM_ENDPOINT_URL");
  const ga4MeasurementId =
    envValue(envFileValues, tracking.ga4?.measurementIdEnvVar) ||
    String(tracking.ga4?.measurementId || "").trim() ||
    envValue(envFileValues, "GA4_MEASUREMENT_ID");
  const ga4ApiSecret =
    envValue(envFileValues, tracking.ga4?.apiSecretEnvVar) ||
    envValue(envFileValues, "GA4_API_SECRET");
  const metaTestEventCode =
    envValue(envFileValues, tracking.metaPixel?.testEventCodeEnvVar) ||
    envValue(envFileValues, fallbackMeta.testEventCodeEnvVar) ||
    envValue(envFileValues, "META_TEST_EVENT_CODE");
  const productDimensionValue =
    String(tracking.ga4?.differentiationKeys?.produto || "").trim() ||
    String(tracking.productCode || "").trim() ||
    event.product_code;

  return { sgtmEndpointUrl, ga4MeasurementId, ga4ApiSecret, metaTestEventCode, productDimensionValue };
}

function trackingFields(event, forcedMetaTestEventCode = "") {
  const payload = event.payload || {};
  const payloadMetaTestEventCode = firstString(payload, ["meta_test_event_code", "test_event_code", "meta.test_event_code"]);
  return {
    currency:
      firstString(payload, ["currency", "currency_code", "currencyCode", "purchase.price.currency_value", "data.purchase.price.currency_value"]) ||
      "BRL",
    value:
      firstNumber(payload, [
        "value",
        "amount",
        "price",
        "purchase_value",
        "total_value",
        "purchase.price.value",
        "data.purchase.price.value",
      ]) ?? 0,
    transactionId: firstString(payload, [
      "transaction",
      "transaction_id",
      "transactionId",
      "purchase.transaction",
      "data.purchase.transaction",
    ]),
    eventSourceUrl: firstString(payload, ["event_source_url", "eventSourceUrl", "page_url", "checkout_url", "checkoutUrl"]),
    metaTestEventCode: forcedMetaTestEventCode || payloadMetaTestEventCode,
  };
}

async function postJson(destination, url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${destination}_http_error:${response.status}:${text.slice(0, 300)}`);
  }
}

async function replayEvent(event, tracking, apply, args) {
  const fields = trackingFields(event, args.metaTestEventCode || tracking.metaTestEventCode);

  if (!tracking.sgtmEndpointUrl || !tracking.ga4MeasurementId || !tracking.ga4ApiSecret) {
    return [];
  }

  if (apply) {
    const clientId = normalizeGa4ClientId(event.identity?.anonymous_id, event.event_id, event.occurred_at);
    const mpUrl = `${tracking.sgtmEndpointUrl}/mp/collect?measurement_id=${encodeURIComponent(tracking.ga4MeasurementId)}&api_secret=${encodeURIComponent(tracking.ga4ApiSecret)}`;

    await postJson("sgtm", mpUrl, {
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
            currency: fields.currency,
            value: fields.value,
            ...(fields.transactionId ? { transaction_id: fields.transactionId } : {}),
            ...(fields.eventSourceUrl ? { page_location: fields.eventSourceUrl } : {}),
            ...(event.identity?.email_hash ? { em: event.identity.email_hash } : {}),
            ...(fields.metaTestEventCode ? { meta_test_event_code: fields.metaTestEventCode, test_event_code: fields.metaTestEventCode } : {}),
            meta_event_name: eventToMetaName(event.event_type),
          },
        },
      ],
    });
  }

  return ["sgtm"];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const envFileValues = loadEnvFile(args.envFile);
  applyEnvDefaults(envFileValues);
  const catalog = loadCatalog();
  const rows = d1Query(args, buildSql(args));

  console.log(JSON.stringify({ mode: args.apply ? "apply" : "dry_run", rows: rows.length }));
  for (const row of rows) {
    const event = rowToEvent(row);
    const tracking = resolveTracking(event, catalog, envFileValues);
    const chainHasEmitTracking = catalogChainHasEmitTracking(catalog, event.product_code, event.event_type);
    const planned = {
      sgtm: Boolean(tracking.sgtmEndpointUrl && tracking.ga4MeasurementId && tracking.ga4ApiSecret && chainHasEmitTracking),
    };
    const destinations = await replayEvent(event, tracking, args.apply, args);
    console.log(
      JSON.stringify({
        event_id: event.event_id,
        event_type: event.event_type,
        product_code: event.product_code,
        meta_test_event_code_applied: Boolean(args.metaTestEventCode || tracking.metaTestEventCode),
        planned,
        sent: args.apply ? destinations : [],
      })
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
