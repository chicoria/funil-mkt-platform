#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(__dirname, "../..");
export const DEFAULT_ENV_FILE = resolve(ROOT_DIR, ".env.local");
export const DEFAULT_CATALOG_PATH = resolve(ROOT_DIR, "config/products.catalog.json");
export const DEFAULT_WRANGLER_CWD = resolve(ROOT_DIR, "workers/funnel-dispatcher");

export function loadEnv(envFile = DEFAULT_ENV_FILE) {
  const env = {};
  let raw = "";
  try {
    raw = readFileSync(envFile, "utf8");
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    if (match[1] in env) continue; // first occurrence wins — ignore duplicates
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

export function applyEnv(envFileValues) {
  for (const [key, value] of Object.entries(envFileValues)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadCatalog(catalogPath = DEFAULT_CATALOG_PATH) {
  return JSON.parse(readFileSync(catalogPath, "utf8"));
}

export function getProductTracking(catalog, productCode) {
  const products = catalog.products || {};
  const normalizedCode = String(productCode).toUpperCase();
  const product =
    products[normalizedCode] ||
    Object.values(products).find((p) =>
      (p.aliases || []).some((a) => String(a).toUpperCase() === normalizedCode)
    );
  if (!product) return {};
  const tracking = product.tracking || {};
  const envKey = (k) => String(k || "").trim();
  const sgtmEndpointUrl =
    (tracking.sgtm?.endpointEnvVar ? process.env[envKey(tracking.sgtm.endpointEnvVar)] : "") ||
    String(tracking.sgtm?.endpointUrl || "").trim() ||
    process.env.SGTM_ENDPOINT_URL || "";
  const ga4MeasurementId =
    (tracking.ga4?.measurementIdEnvVar ? process.env[envKey(tracking.ga4.measurementIdEnvVar)] : "") ||
    String(tracking.ga4?.measurementId || "").trim() ||
    process.env.GA4_MEASUREMENT_ID || "";
  const ga4ApiSecret =
    (tracking.ga4?.apiSecretEnvVar ? process.env[envKey(tracking.ga4.apiSecretEnvVar)] : "") ||
    process.env.GA4_API_SECRET || "";
  const metaTestEventCode =
    (tracking.metaPixel?.testEventCodeEnvVar ? process.env[envKey(tracking.metaPixel.testEventCodeEnvVar)] : "") ||
    process.env.META_TEST_EVENT_CODE || "";
  return { sgtmEndpointUrl, ga4MeasurementId, ga4ApiSecret, metaTestEventCode };
}

export function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`missing_required_env: ${missing.join(", ")}`);
  }
}

export function parseScenarioArgs(argv = process.argv.slice(2)) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env-file") opts.envFile = argv[++i];
    else if (arg === "--meta-test-event-code") opts.metaTestEventCode = argv[++i];
    else if (arg === "--skip-sgtm") opts.skipSgtm = true;
    else if (arg === "--verify-destinations") opts.verifyDestinations = true;
  }
  return opts;
}
