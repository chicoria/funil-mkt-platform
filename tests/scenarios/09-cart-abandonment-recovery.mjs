#!/usr/bin/env node
/**
 * Scenario 09: Cart abandonment recovery email
 * Trigger: POST Hotmart PURCHASE_OUT_OF_SHOPPING_CART
 * Verifies: Brevo transactional email log/content and links-redirect recovery params.
 */
import { loadEnv, applyEnv, requireEnv, DEFAULT_ENV_FILE } from "../lib/config.mjs";
import { waitForRow, sqlEscape, sleep } from "../lib/d1.mjs";
import { postJson, getUrl, assertStatus } from "../lib/http.mjs";
import { waitForTransactionalEmail, getTransactionalEmailContent } from "../lib/brevo.mjs";
import { step, printResult, printSummary } from "../lib/assert.mjs";

export const SCENARIO_ID = "09";
export const SCENARIO_NAME = "09-cart-abandonment-recovery";
export const TAGS = ["hotmart", "brevo", "recovery"];

function parseArgs(argv = process.argv.slice(2)) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env-file") opts.envFile = argv[++i];
    else if (arg === "--email") opts.email = argv[++i];
    else if (arg === "--product-path") opts.productPath = argv[++i];
  }
  return opts;
}

function e2eEmail(ts, opts) {
  if (opts.email) return opts.email;
  const fixed = process.env.E2E_CART_ABANDONMENT_EMAIL || process.env.E2E_BREVO_EMAIL || "";
  if (fixed) return fixed.replace("{{ts}}", String(ts));

  const localPart = process.env.E2E_EMAIL_LOCAL_PART || "e2e.cart";
  const domain = process.env.E2E_EMAIL_DOMAIN || "";
  if (!domain) {
    throw new Error("missing_required_env: E2E_EMAIL_DOMAIN or E2E_CART_ABANDONMENT_EMAIL");
  }
  return `${localPart}.${ts}@${domain}`;
}

function extractCheckoutHref(html) {
  const normalized = String(html || "").replaceAll("&amp;", "&");
  const hrefs = [...normalized.matchAll(/\bhref=["']([^"']+)["']/gi)].map((match) => match[1]);
  return hrefs.find((href) => href.includes("/plano-de-voo/checkout") && href.includes("rid=")) || "";
}

function extractTrackedHref(html) {
  const normalized = String(html || "").replaceAll("&amp;", "&");
  const hrefs = [...normalized.matchAll(/\bhref=["']([^"']+)["']/gi)].map((match) => match[1]);
  return hrefs.find((href) => href.includes("/tr/cl/")) || "";
}

async function resolveEmailHref(html) {
  const direct = extractCheckoutHref(html);
  if (direct) return direct;

  const tracked = extractTrackedHref(html);
  if (!tracked) return "";
  const response = await fetch(tracked, { redirect: "manual" });
  const location = response.headers.get("location") || "";
  if (response.status < 300 || response.status >= 400 || !location) {
    throw new Error(`Brevo tracked link did not redirect: status=${response.status}`);
  }
  return location.replaceAll("&amp;", "&");
}

function recoveryIdFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).searchParams.get("rid") || "";
  } catch {
    return "";
  }
}

function assertUrlContainsParam(url, key, expected) {
  const parsed = new URL(url);
  const actual = parsed.searchParams.get(key);
  if (actual !== expected) {
    throw new Error(`expected redirect param ${key}=${expected}, got ${actual} in ${url}`);
  }
}

function assertExpectedHotmartRedirect(location) {
  const expected = process.env.EXPECTED_PLANOVOO_HOTMART_URL || process.env.PLANO_DE_VOO_CHECKOUT_URL || "https://pay.hotmart.com/R105463680A";
  const expectedUrl = new URL(expected);
  const actualUrl = new URL(location);
  if (actualUrl.hostname !== expectedUrl.hostname || !actualUrl.pathname.startsWith(expectedUrl.pathname)) {
    throw new Error(`unexpected Hotmart redirect: ${location}`);
  }
}

export async function run(opts = {}) {
  const ts = Date.now();
  const envFile = opts.envFile || DEFAULT_ENV_FILE;
  const env = loadEnv(envFile);
  applyEnv(env);
  requireEnv(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);

  const hotmartIngressUrl = process.env.HOTMART_INGRESS_URL || "https://api.decolesuacarreiraesg.com.br";
  const linksUrl = process.env.DECOLE_LINKS_URL || process.env.LINKS_BASE_URL || "https://links.decolesuacarreiraesg.com.br";
  const eventStoreDbName = process.env.EVENT_STORE_DB_NAME || process.env.D1_EVENT_STORE_DB_NAME || "decole-d1-event-store";
  const eventId = opts.eventId || `e2e-cart-recovery-${ts}`;
  const email = e2eEmail(ts, opts);
  const name = opts.name || "Maria QA";
  const phone = opts.phone || "11999998888";
  const fbp = opts.fbp || `fb.2.${ts}.recovery`;
  const productPath = opts.productPath || "plano-de-voo";
  const templateId = Number(process.env.BREVO_CART_ABANDONMENT_TEMPLATE_ID_PLANOVOO || 11);
  const webhookToken = process.env.HOTMART_WEBHOOK_TOKEN || "";

  const start = Date.now();
  const steps = [];
  let brevoEmail = null;
  let checkoutHref = "";
  let recoveryId = "";

  steps.push(await step("webhook_accepted", async () => {
    const headers = webhookToken ? { "x-hotmart-hottok": webhookToken } : {};
    const res = await postJson(
      `${hotmartIngressUrl}/webhooks/v1/${productPath}/hotmart/purchase`,
      {
        event: "PURCHASE_OUT_OF_SHOPPING_CART",
        event_id: eventId,
        buyer: {
          email,
          name,
          phone,
        },
        purchase: {
          transaction: `HP-E2E-CART-${ts}`,
          price: { value: 297, currency_value: "BRL" },
        },
        fbp,
        utm_source: "e2e",
        utm_medium: "test",
      },
      headers
    );
    if (res.status === 401) throw new Error("auth_failed: set HOTMART_WEBHOOK_TOKEN");
    assertStatus(res, 202, "hotmart webhook cart recovery");
    return `event_id=${eventId} email=${email} → 202`;
  }));

  if (steps[0].status === "fail") return finalize(SCENARIO_NAME, steps, start);

  await sleep(8000);

  steps.push(await step("event_in_d1", async () => {
    const row = await waitForRow(
      eventStoreDbName,
      `SELECT event_id, event_type, source FROM funnel_events WHERE event_id='${sqlEscape(eventId)}' LIMIT 1`,
      (r) => r.event_id === eventId,
      { timeout: 90000, poll: 4000, description: `cart recovery event_id=${eventId}` }
    );
    if (row.event_type !== "PURCHASE_OUT_OF_SHOPPING_CART") {
      throw new Error(`expected PURCHASE_OUT_OF_SHOPPING_CART got ${row.event_type}`);
    }
    return `event_type=${row.event_type} source=${row.source}`;
  }));

  steps.push(await step("brevo_email_logged", async () => {
    brevoEmail = await waitForTransactionalEmail(email, {
      templateId,
      timeout: Number(process.env.BREVO_E2E_TIMEOUT_MS || 120000),
      interval: Number(process.env.BREVO_E2E_POLL_MS || 5000),
      description: `Brevo cart email to ${email}`,
    });
    if (Number(brevoEmail.templateId) !== templateId) {
      throw new Error(`expected templateId=${templateId}, got ${brevoEmail.templateId}`);
    }
    return `uuid=${brevoEmail.uuid} templateId=${brevoEmail.templateId}`;
  }));

  if (steps[steps.length - 1].status === "fail") return finalize(SCENARIO_NAME, steps, start);

  steps.push(await step("brevo_content_has_recovery_link", async () => {
    const content = await getTransactionalEmailContent(brevoEmail.uuid);
    if (Number(content.templateId) !== templateId) {
      throw new Error(`expected content.templateId=${templateId}, got ${content.templateId}`);
    }
    checkoutHref = await resolveEmailHref(content.body);
    if (!checkoutHref) throw new Error("checkout recovery link not found in Brevo rendered body");
    if (!checkoutHref.includes("links.decolesuacarreiraesg.com.br") && !checkoutHref.includes(new URL(linksUrl).hostname)) {
      throw new Error(`checkout link does not point to links worker: ${checkoutHref}`);
    }
    recoveryId = recoveryIdFromUrl(checkoutHref);
    if (!recoveryId) throw new Error(`rid not found in checkout link: ${checkoutHref}`);
    return `rid=${recoveryId} href=${checkoutHref.slice(0, 120)}...`;
  }));

  if (steps[steps.length - 1].status === "fail") return finalize(SCENARIO_NAME, steps, start);

  steps.push(await step("links_redirect_recovers_params", async () => {
    const res = await getUrl(`${linksUrl}/plano-de-voo/checkout`, { rid: recoveryId });
    if (res.status !== 302) throw new Error(`expected 302 got ${res.status}`);
    assertExpectedHotmartRedirect(res.location);
    assertUrlContainsParam(res.location, "email", email);
    assertUrlContainsParam(res.location, "name", name);
    assertUrlContainsParam(res.location, "fbp", fbp);
    return `→ ${res.location.slice(0, 140)}...`;
  }));

  return finalize(SCENARIO_NAME, steps, start);
}

function finalize(name, steps, start) {
  const status = steps.some((s) => s.status === "fail") ? "fail" : "pass";
  return { scenario: name, status, elapsed_ms: Date.now() - start, steps };
}

if (process.argv[1].endsWith("09-cart-abandonment-recovery.mjs")) {
  const result = await run(parseArgs());
  console.log(`\n[${SCENARIO_NAME}]`);
  result.steps.forEach(printResult);
  printSummary(result);
  console.log("\n" + JSON.stringify(result, null, 2));
  process.exit(result.status === "pass" ? 0 : 1);
}
