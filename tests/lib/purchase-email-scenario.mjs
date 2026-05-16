#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { loadEnv, applyEnv, requireEnv, DEFAULT_ENV_FILE } from "./config.mjs";
import { waitForRow, sqlEscape, sleep, d1Execute } from "./d1.mjs";
import { postJson, assertStatus } from "./http.mjs";
import { waitForTransactionalEmail, getTransactionalEmailContent, deleteBrevoContact } from "./brevo.mjs";
import { step, printResult, printSummary } from "./assert.mjs";

const KNOWN_HANDLERS = [
  "resolve_identity",
  "upsert_event_store",
  "enrich_attribution",
  "update_brevo_funnel",
  "emit_tracking",
  "call_product_api",
  "send_template_email",
  "invalidate_purchase_token",
];

function parseArgs(argv = process.argv.slice(2)) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env-file") opts.envFile = argv[++i];
    else if (arg === "--email") opts.email = argv[++i];
    else if (arg === "--product-path") opts.productPath = argv[++i];
    else if (arg === "--no-cleanup") opts.cleanup = false;
  }
  return opts;
}

function e2eEmail(ts, opts, eventSlug) {
  if (opts.email) return opts.email;
  const fixed = process.env.E2E_PURCHASE_EMAIL || process.env.E2E_BREVO_EMAIL || "";
  if (fixed) return fixed.replace("{{ts}}", String(ts)).replace("{{event}}", eventSlug);

  const localPart = process.env.E2E_EMAIL_LOCAL_PART || `e2e.${eventSlug}`;
  const domain = process.env.E2E_EMAIL_DOMAIN || "";
  if (!domain) {
    throw new Error("missing_required_env: E2E_EMAIL_DOMAIN, E2E_PURCHASE_EMAIL or --email");
  }
  return `${localPart}.${ts}@${domain}`;
}

function requireExternalSafety(config, { eventId, transaction, email }) {
  const ingressUrl = process.env.HOTMART_INGRESS_URL || "";
  if (!ingressUrl) {
    throw new Error(`${config.scenarioName}: HOTMART_INGRESS_URL is required for external transactional-email scenarios`);
  }
  if (!process.env.PLANOVOO_API_BASE_URL) {
    throw new Error(`${config.scenarioName}: PLANOVOO_API_BASE_URL is required; use an isolated staging product API`);
  }
  if (!eventId.startsWith("e2e-")) {
    throw new Error(`${config.scenarioName}: unsafe event_id ${eventId}; expected e2e-*`);
  }
  if (!transaction.startsWith("HP-E2E-")) {
    throw new Error(`${config.scenarioName}: unsafe transaction ${transaction}; expected HP-E2E-*`);
  }
  if (!isDisposableEmail(email)) {
    throw new Error(`${config.scenarioName}: unsafe email ${email}; use e2e.* or qa+e2e* disposable address, or E2E_ALLOW_NON_DISPOSABLE_EMAIL=true`);
  }
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function hrefsFromHtml(html) {
  return [...String(html || "").replaceAll("&amp;", "&").matchAll(/\bhref=["']([^"']+)["']/gi)].map((match) => match[1]);
}

async function resolveTrackedHref(href) {
  if (!href.includes("/tr/cl/")) return href;
  const response = await fetch(href, { redirect: "manual" });
  const location = response.headers.get("location") || "";
  if (response.status < 300 || response.status >= 400 || !location) {
    throw new Error(`Brevo tracked link did not redirect: status=${response.status}`);
  }
  return location.replaceAll("&amp;", "&");
}

async function findResolvedHref(html, predicate) {
  for (const href of hrefsFromHtml(html)) {
    const resolved = await resolveTrackedHref(href);
    if (predicate(resolved)) return resolved;
  }
  return "";
}

function assertTextContains(text, expected) {
  if (!text.toLowerCase().includes(String(expected).toLowerCase())) {
    throw new Error(`expected rendered email to contain ${JSON.stringify(expected)}`);
  }
}

function cleanupEnabled(opts) {
  if (opts.cleanup === false) return false;
  return !["0", "false", "no"].includes(String(process.env.E2E_CLEANUP || "true").toLowerCase());
}

function isDisposableEmail(email) {
  if (String(process.env.E2E_ALLOW_NON_DISPOSABLE_EMAIL || "").toLowerCase() === "true") return true;
  const localPart = String(email).split("@")[0] || "";
  return localPart.startsWith("e2e.") || localPart.startsWith("qa+e2e");
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function kvDelete(binding, key) {
  execFileSync("npx", ["wrangler", "kv", "key", "delete", key, `--binding=${binding}`, "--remote"], {
    cwd: process.env.WRANGLER_CWD || new URL("../../workers/funnel-dispatcher", import.meta.url).pathname,
    encoding: "utf8",
    stdio: "pipe",
  });
}

function cleanupKv({ eventId, email, anonymousId }) {
  let deleted = 0;
  let notFound = 0;
  const emailHash = sha256Hex(String(email).toLowerCase());
  const keys = [
    ["IDENTITY_KV", `decole:identity:anon:${anonymousId}`],
    ["IDENTITY_KV", `identity:anon:${anonymousId}`],
    ["IDENTITY_KV", `decole:identity:email:${emailHash}`],
    ["IDENTITY_KV", `identity:email:${emailHash}`],
  ];

  for (const handler of KNOWN_HANDLERS) {
    keys.push(["DEDUPE_KV", `decole:DECOLE_PLANOVOO:${eventId}:${handler}`]);
    keys.push(["DEDUPE_KV", `decole:PLANOVOO:${eventId}:${handler}`]);
    keys.push(["DEDUPE_KV", `${eventId}:${handler}`]);
  }

  for (const [binding, key] of keys) {
    try {
      kvDelete(binding, key);
      deleted += 1;
    } catch {
      notFound += 1;
    }
  }

  return { deleted, notFound };
}

function canDeleteBrevoContact(email) {
  if (String(process.env.E2E_DELETE_BREVO_CONTACT || "").toLowerCase() === "true") return true;
  return isDisposableEmail(email);
}

async function cleanupScenarioData({ eventStoreDbName, identityDbName, eventId, transaction, email, anonymousId }) {
  const details = [];
  const escapedEventId = sqlEscape(eventId);
  const escapedTransaction = sqlEscape(transaction);
  const escapedAnonymousId = sqlEscape(anonymousId);

  const eventMeta = d1Execute(
    eventStoreDbName,
    `DELETE FROM funnel_events
     WHERE event_id='${escapedEventId}'
        OR anonymous_id='${escapedAnonymousId}'
        OR payload_json LIKE '%${escapedTransaction}%'`
  );
  details.push(`event_store=${eventMeta.changes ?? 0}`);

  const identityMeta = d1Execute(
    identityDbName,
    `DELETE FROM identity_links
     WHERE anonymous_id='${escapedAnonymousId}'`
  );
  details.push(`identity=${identityMeta.changes ?? 0}`);

  const kv = cleanupKv({ eventId, email, anonymousId });
  details.push(`kv_deleted=${kv.deleted}`);

  if (canDeleteBrevoContact(email)) {
    try {
      const brevoResult = await deleteBrevoContact(email);
      details.push(`brevo_contact=${brevoResult.deleted ? "deleted" : "not_found"}`);
    } catch (err) {
      details.push(`brevo_contact_error=${String(err.message || err).slice(0, 80)}`);
    }
  } else {
    details.push("brevo_contact=skipped");
  }

  return details.join(" ");
}

export async function runPurchaseEmailScenario(config, opts = {}) {
  const ts = Date.now();
  const startedAt = new Date().toISOString();
  const envFile = opts.envFile || DEFAULT_ENV_FILE;
  const env = loadEnv(envFile);
  applyEnv(env);
  requireEnv(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);

  const hotmartIngressUrl = process.env.HOTMART_INGRESS_URL || "https://api.decolesuacarreiraesg.com.br";
  const eventStoreDbName = process.env.EVENT_STORE_DB_NAME || process.env.D1_EVENT_STORE_DB_NAME || "decole-d1-event-store";
  const identityDbName = process.env.IDENTITY_DB_NAME || process.env.D1_IDENTITY_DB_NAME || "decole-d1-identity";
  const eventId = opts.eventId || `e2e-${config.eventSlug}-${ts}`;
  const transaction = opts.transaction || `HP-E2E-${config.eventSlug.toUpperCase()}-${ts}`;
  const email = e2eEmail(ts, opts, config.eventSlug);
  const name = opts.name || "Maria QA";
  const anonymousId = opts.anonymousId || `anon-${eventId}`;
  const productPath = opts.productPath || "plano-de-voo";
  const webhookToken = process.env.HOTMART_WEBHOOK_TOKEN || "";

  requireExternalSafety(config, { eventId, transaction, email });

  const start = Date.now();
  const steps = [];
  let brevoEmail = null;

  try {
    steps.push(await step("webhook_accepted", async () => {
      const headers = webhookToken ? { "x-hotmart-hottok": webhookToken } : {};
      const res = await postJson(
        `${hotmartIngressUrl}/webhooks/v1/${productPath}/hotmart/purchase`,
        {
          event: config.eventType,
          event_id: eventId,
          anonymous_id: anonymousId,
          data: {
            buyer: {
              email,
              name,
              phone: "11999998888",
            },
            product: {
              name: "DECOLE - Plano de Voo",
            },
            purchase: {
              transaction,
              offer_code: "f3yweqek",
              payment: { type: "CREDIT_CARD" },
              price: { value: 297, currency_value: "BRL" },
            },
          },
        },
        headers
      );
      if (res.status === 401) throw new Error("auth_failed: set HOTMART_WEBHOOK_TOKEN");
      assertStatus(res, 202, `hotmart webhook ${config.eventType}`);
      return `event_id=${eventId} email=${email} → 202`;
    }));

    if (steps[0].status === "fail") return finalize(config.scenarioName, steps, start);

    await sleep(8000);

    steps.push(await step("event_in_d1", async () => {
      const row = await waitForRow(
        eventStoreDbName,
        `SELECT event_id, event_type, source, product_code FROM funnel_events WHERE event_id='${sqlEscape(eventId)}' LIMIT 1`,
        (r) => r.event_id === eventId,
        { timeout: 90000, poll: 4000, description: `${config.eventType} event_id=${eventId}` }
      );
      if (row.event_type !== config.eventType) throw new Error(`expected ${config.eventType} got ${row.event_type}`);
      if (row.product_code !== "DECOLE_PLANOVOO") throw new Error(`expected DECOLE_PLANOVOO got ${row.product_code}`);
      return `event_type=${row.event_type} source=${row.source}`;
    }));

    steps.push(await step("brevo_email_logged", async () => {
      brevoEmail = await waitForTransactionalEmail(email, {
        templateId: config.templateId,
        timeout: Number(process.env.BREVO_E2E_TIMEOUT_MS || 180000),
        interval: Number(process.env.BREVO_E2E_POLL_MS || 10000),
        description: `Brevo ${config.eventType} email to ${email}`,
        since: startedAt,
      });
      if (Number(brevoEmail.templateId) !== Number(config.templateId)) {
        throw new Error(`expected templateId=${config.templateId}, got ${brevoEmail.templateId}`);
      }
      return `uuid=${brevoEmail.uuid} templateId=${brevoEmail.templateId}`;
    }));

    if (steps[steps.length - 1].status === "fail") return finalize(config.scenarioName, steps, start);

    steps.push(await step("brevo_content_matches", async () => {
      const content = await getTransactionalEmailContent(brevoEmail.uuid);
      if (Number(content.templateId) !== Number(config.templateId)) {
        throw new Error(`expected content.templateId=${config.templateId}, got ${content.templateId}`);
      }
      if (String(content.body || "") === "Mail content not available") {
        throw new Error("Brevo rendered body unavailable; use an email address that accepts delivery");
      }

      const text = stripHtml(content.body);
      for (const expectedText of config.expectedTexts) {
        assertTextContains(text, expectedText);
      }
      assertTextContains(text, transaction);

      if (config.expectedHref) {
        const href = await findResolvedHref(content.body, config.expectedHref.predicate);
        if (!href) throw new Error(`expected rendered email href: ${config.expectedHref.description}`);
        return `subject=${content.subject} href=${href.slice(0, 120)}...`;
      }

      return `subject=${content.subject}`;
    }));
  } finally {
    if (cleanupEnabled(opts)) {
      steps.push(await step("cleanup_test_data", async () => cleanupScenarioData({
        eventStoreDbName,
        identityDbName,
        eventId,
        transaction,
        email,
        anonymousId,
      })));
    }
  }

  return finalize(config.scenarioName, steps, start);
}

function finalize(name, steps, start) {
  const status = steps.some((s) => s.status === "fail") ? "fail" : "pass";
  return { scenario: name, status, elapsed_ms: Date.now() - start, steps };
}

export async function runCli(config) {
  const result = await runPurchaseEmailScenario(config, parseArgs());
  console.log(`\n[${config.scenarioName}]`);
  result.steps.forEach(printResult);
  printSummary(result);
  console.log("\n" + JSON.stringify(result, null, 2));
  process.exit(result.status === "pass" ? 0 : 1);
}
