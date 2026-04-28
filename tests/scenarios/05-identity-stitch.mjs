#!/usr/bin/env node
/**
 * Scenario 05: Identity Stitch
 * Verifies that a site event and a hotmart event with the same email
 * resolve to the same profile_id in identity_links
 */
import { loadEnv, applyEnv, requireEnv, DEFAULT_ENV_FILE } from "../lib/config.mjs";
import { d1Query, waitForRow, sqlEscape, sleep } from "../lib/d1.mjs";
import { postJson } from "../lib/http.mjs";
import { step, assertEqual, printResult, printSummary } from "../lib/assert.mjs";

export const SCENARIO_ID = "05";
export const SCENARIO_NAME = "05-identity-stitch";
export const TAGS = ["identity"];

export async function run(opts = {}) {
  const ts = Date.now();
  const envFile = opts.envFile || DEFAULT_ENV_FILE;
  const env = loadEnv(envFile);
  applyEnv(env);
  requireEnv(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);

  const funnel_ingress_url = process.env.FUNNEL_INGRESS_URL || "https://api.decolesuacarreiraesg.com.br";
  const hotmart_ingress_url = process.env.HOTMART_INGRESS_URL || "https://api.decolesuacarreiraesg.com.br";
  const email = `e2e.stitch.${ts}@example.com`;
  const anonymousId = `anon-stitch-${ts}`;
  const siteEventId = `e2e-stitch-site-${ts}`;
  const hotmartEventId = `e2e-stitch-pa-${ts}`;
  const webhookToken = process.env.HOTMART_WEBHOOK_TOKEN || "";

  const start = Date.now();
  const steps = [];

  // Step 1: site event (precheckout) with email
  steps.push(await step("site_event_sent", async () => {
    const res = await postJson(`${funnel_ingress_url}/funnel/precheckout`, {
      email,
      product_code: "DECOLE_PLANOVOO",
      anonymous_id: anonymousId,
    });
    if (res.status !== 202) throw new Error(`expected 202 got ${res.status}`);
    return `site event_id=${res.body?.event_id}`;
  }));

  await sleep(8000); // wait for dispatcher to process site event

  // Step 2: hotmart event with same email
  steps.push(await step("hotmart_event_sent", async () => {
    const headers = webhookToken ? { "x-hotmart-hottok": webhookToken } : {};
    const res = await postJson(
      `${hotmart_ingress_url}/webhooks/v1/planovoo/hotmart/purchase`,
      {
        event: "PURCHASE_COMPLETE",
        event_id: hotmartEventId,
        transaction: `txn-${hotmartEventId}`,
        buyer: { email },
        purchase: { price: { value: 297, currency_value: "BRL" } },
      },
      headers
    );
    if (res.status === 401) throw new Error("auth_failed: set HOTMART_WEBHOOK_TOKEN");
    if (res.status !== 202) throw new Error(`expected 202 got ${res.status}`);
    return `hotmart event_id=${hotmartEventId} → 202`;
  }));

  if (steps.some((s) => s.status === "fail")) return finalize(SCENARIO_NAME, steps, start);

  await sleep(8000);

  // Step 3: both events exist in D1
  let siteRow = null;
  let hotmartRow = null;
  steps.push(await step("both_events_in_d1", async () => {
    hotmartRow = await waitForRow(
      "decole-d1-event-store",
      `SELECT event_id, profile_id, email_hash FROM funnel_events WHERE event_id='${sqlEscape(hotmartEventId)}' LIMIT 1`,
      (r) => r.event_id === hotmartEventId,
      { timeout: 60000, poll: 3000, description: `hotmart event_id=${hotmartEventId}` }
    );
    const siteRows = d1Query(
      "decole-d1-event-store",
      `SELECT event_id, profile_id, email_hash FROM funnel_events WHERE anonymous_id='${sqlEscape(anonymousId)}' AND source='site' ORDER BY occurred_at DESC LIMIT 1`
    );
    siteRow = siteRows[0];
    if (!siteRow) throw new Error(`site event not found for anonymous_id=${anonymousId}`);
    return `site_profile=${siteRow.profile_id} hotmart_profile=${hotmartRow.profile_id}`;
  }));

  // Step 4: same profile_id
  steps.push(await step("same_profile_id", async () => {
    if (!siteRow?.profile_id || !hotmartRow?.profile_id) {
      throw new Error(`missing profile_id: site=${siteRow?.profile_id} hotmart=${hotmartRow?.profile_id}`);
    }
    assertEqual(hotmartRow.profile_id, siteRow.profile_id, "profile_ids must match");
    return `profile_id=${siteRow.profile_id} (matched)`;
  }));

  // Step 5: identity_links has single row for email_hash
  steps.push(await step("identity_links_unique", async () => {
    if (!hotmartRow?.email_hash) throw new Error("email_hash not set in hotmart funnel_events");
    const rows = d1Query(
      "decole-d1-identity",
      `SELECT profile_id, email_hash, anonymous_id FROM identity_links WHERE email_hash='${sqlEscape(hotmartRow.email_hash)}' LIMIT 5`
    );
    if (rows.length === 0) throw new Error("no identity_links row for email_hash");
    if (rows.length > 1) throw new Error(`expected 1 identity_links row, found ${rows.length}`);
    return `identity_links: profile_id=${rows[0].profile_id}`;
  }));

  return finalize(SCENARIO_NAME, steps, start);
}

function finalize(name, steps, start) {
  const status = steps.some((s) => s.status === "fail") ? "fail" : "pass";
  return { scenario: name, status, elapsed_ms: Date.now() - start, steps };
}

if (process.argv[1].endsWith("05-identity-stitch.mjs")) {
  const result = await run();
  console.log(`\n[${SCENARIO_NAME}]`);
  result.steps.forEach(printResult);
  printSummary(result);
  console.log("\n" + JSON.stringify(result, null, 2));
  process.exit(result.status === "pass" ? 0 : 1);
}
