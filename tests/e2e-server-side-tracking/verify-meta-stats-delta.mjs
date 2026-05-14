#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../..");
const defaultCatalogPath = resolve(rootDir, "config/products.catalog.json");
const defaultEnvFile = resolve(rootDir, ".env.local");

function usage() {
  console.log(`Usage:
  node verify-meta-stats-delta.mjs --product-code <code> --event-type <type> [options]

Modes:
  - count (default): retorna count atual no periodo
  - verify: compara com --baseline-count e espera delta >= 1

Options:
  --mode <count|verify>            Default: count
  --baseline-count <n>             Obrigatorio no modo verify
  --product-code <code>            Ex: DECOLE_ESG_MENTORIA
  --event-type <type>              Ex: PURCHASE_APPROVED
  --window-minutes <n>             Default: 180
  --timeout-seconds <n>            Default: 240 (somente verify)
  --poll-seconds <n>               Default: 12  (somente verify)
  --catalog <path>                 Default: config/products.catalog.json
  --env-file <path>                Default: .env.local
`);
}

function parseArgs(argv) {
  const args = {
    mode: "count",
    baselineCount: null,
    productCode: "",
    eventType: "",
    windowMinutes: 180,
    timeoutSeconds: 240,
    pollSeconds: 12,
    catalogPath: defaultCatalogPath,
    envFile: defaultEnvFile,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--mode") args.mode = mustValue(argv, ++i, "--mode");
    else if (arg === "--baseline-count") args.baselineCount = Number(mustValue(argv, ++i, "--baseline-count"));
    else if (arg === "--product-code") args.productCode = mustValue(argv, ++i, "--product-code");
    else if (arg === "--event-type") args.eventType = mustValue(argv, ++i, "--event-type");
    else if (arg === "--window-minutes") args.windowMinutes = Number(mustValue(argv, ++i, "--window-minutes"));
    else if (arg === "--timeout-seconds") args.timeoutSeconds = Number(mustValue(argv, ++i, "--timeout-seconds"));
    else if (arg === "--poll-seconds") args.pollSeconds = Number(mustValue(argv, ++i, "--poll-seconds"));
    else if (arg === "--catalog") args.catalogPath = resolve(mustValue(argv, ++i, "--catalog"));
    else if (arg === "--env-file") args.envFile = resolve(mustValue(argv, ++i, "--env-file"));
    else throw new Error(`unknown_arg:${arg}`);
  }

  if (!args.help) {
    if (!["count", "verify"].includes(args.mode)) throw new Error("invalid_mode");
    if (!args.productCode) throw new Error("missing_product_code");
    if (!args.eventType) throw new Error("missing_event_type");
    if (!Number.isInteger(args.windowMinutes) || args.windowMinutes < 10) throw new Error("invalid_window_minutes");
    if (!Number.isInteger(args.timeoutSeconds) || args.timeoutSeconds < 10) throw new Error("invalid_timeout");
    if (!Number.isInteger(args.pollSeconds) || args.pollSeconds < 2) throw new Error("invalid_poll");
    if (args.mode === "verify" && (!Number.isFinite(args.baselineCount) || args.baselineCount < 0)) {
      throw new Error("missing_or_invalid_baseline_count");
    }
  }

  return args;
}

function mustValue(argv, index, flag) {
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

function envValue(env, key) {
  if (!key) return "";
  return String(process.env[key] ?? env[key] ?? "").trim();
}

function parseCatalog(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function eventToMetaName(eventType) {
  if (eventType === "PURCHASE_APPROVED") return "Purchase";
  if (eventType === "BEGIN_CHECKOUT" || eventType === "PURCHASE_OUT_OF_SHOPPING_CART") return "InitiateCheckout";
  if (eventType === "GENERATE_LEAD" || eventType === "PRECHECKOUT_SUBMIT_SUCCESS") return "Lead";
  return eventType;
}

function getCatalogProduct(catalog, productCode) {
  const products = catalog.products || {};
  if (products[productCode]) return products[productCode];
  const normalized = String(productCode).toUpperCase();
  return Object.values(products).find((product) =>
    (product.aliases || []).some((alias) => String(alias).toUpperCase() === normalized)
  );
}

function resolveMetaConfig({ catalog, productCode, env }) {
  const product = getCatalogProduct(catalog, productCode) || {};
  const tracking = product.tracking || {};
  const metaPixel = tracking.metaPixel || {};
  const fallbackMeta = product.meta || {};

  const pixelId =
    envValue(env, metaPixel.pixelIdEnvVar) ||
    envValue(env, fallbackMeta.pixelIdEnvVar) ||
    String(metaPixel.pixelId || "").trim() ||
    envValue(env, "META_PIXEL_ID");

  const token =
    envValue(env, "META_SYSTEM_USER_ACCESS_TOKEN") ||
    envValue(env, metaPixel.capiTokenEnvVar) ||
    envValue(env, fallbackMeta.capiTokenEnvVar) ||
    envValue(env, "META_CAPI_ACCESS_TOKEN");

  return { pixelId, token };
}

async function fetchStatsCount({ pixelId, token, eventName, windowMinutes }) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - windowMinutes * 60;
  const url = new URL(`https://graph.facebook.com/v22.0/${encodeURIComponent(pixelId)}/stats`);
  url.searchParams.set("aggregation", "event");
  url.searchParams.set("start_time", String(start));
  url.searchParams.set("end_time", String(now));
  url.searchParams.set("access_token", token);

  const response = await fetch(url.toString());
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.error) {
    const msg = body?.error?.message || JSON.stringify(body).slice(0, 300);
    throw new Error(`meta_stats_error:${response.status}:${msg}`);
  }

  const groups = Array.isArray(body?.data) ? body.data : [];
  let count = 0;
  for (const group of groups) {
    const rows = Array.isArray(group?.data) ? group.data : [];
    for (const row of rows) {
      if (String(row?.value || "") !== eventName) continue;
      const rowCount = Number(row?.count || 0);
      if (Number.isFinite(rowCount)) count += rowCount;
    }
  }
  return count;
}

async function waitForDelta(checkFn, timeoutSeconds, pollSeconds) {
  const endAt = Date.now() + timeoutSeconds * 1000;
  let lastCount = 0;
  while (Date.now() <= endAt) {
    lastCount = await checkFn();
    if (lastCount > 0) return { ok: true, delta: lastCount };
    await new Promise((r) => setTimeout(r, pollSeconds * 1000));
  }
  return { ok: false, delta: lastCount };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const env = loadEnvFile(args.envFile);
  const catalog = parseCatalog(args.catalogPath);
  const { pixelId, token } = resolveMetaConfig({ catalog, productCode: args.productCode, env });
  if (!pixelId || !token) {
    throw new Error("missing_meta_pixel_or_token");
  }

  const eventName = eventToMetaName(args.eventType);
  const currentCount = await fetchStatsCount({
    pixelId,
    token,
    eventName,
    windowMinutes: args.windowMinutes,
  });

  if (args.mode === "count") {
    console.log(
      JSON.stringify({
        ok: true,
        stage: "meta_stats",
        mode: "count",
        product_code: args.productCode,
        event_type: args.eventType,
        meta_event_name: eventName,
        count: currentCount,
        window_minutes: args.windowMinutes,
      })
    );
    return;
  }

  const baseline = Number(args.baselineCount);
  const initialDelta = currentCount - baseline;
  if (initialDelta >= 1) {
    console.log(
      JSON.stringify({
        ok: true,
        stage: "meta_stats",
        mode: "verify",
        baseline_count: baseline,
        current_count: currentCount,
        delta: initialDelta,
        product_code: args.productCode,
        event_type: args.eventType,
        meta_event_name: eventName,
      })
    );
    return;
  }

  const waited = await waitForDelta(async () => {
    const latestCount = await fetchStatsCount({
      pixelId,
      token,
      eventName,
      windowMinutes: args.windowMinutes,
    });
    return latestCount - baseline;
  }, args.timeoutSeconds, args.pollSeconds);

  if (!waited.ok) {
    console.log(
      JSON.stringify({
        ok: false,
        stage: "meta_stats",
        mode: "verify",
        reason: "delta_not_observed",
        baseline_count: baseline,
        current_count: baseline + waited.delta,
        delta: waited.delta,
        product_code: args.productCode,
        event_type: args.eventType,
        meta_event_name: eventName,
      })
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      ok: true,
      stage: "meta_stats",
      mode: "verify",
      baseline_count: baseline,
      current_count: baseline + waited.delta,
      delta: waited.delta,
      product_code: args.productCode,
      event_type: args.eventType,
      meta_event_name: eventName,
    })
  );
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, stage: "meta_stats", error: String(error.message || error) }));
  process.exit(1);
});
