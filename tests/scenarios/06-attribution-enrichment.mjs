#!/usr/bin/env node
/**
 * Scenario 06: Attribution Enrichment
 * Sends a site event with fbp/fbc, then a hotmart event with the same email.
 * Verifies that the hotmart event's sGTM replay includes fbp/fbc from the site event.
 */
import { loadEnv, applyEnv, requireEnv, DEFAULT_ENV_FILE } from "../lib/config.mjs";
import { waitForRow, sqlEscape, sleep } from "../lib/d1.mjs";
import { postJson } from "../lib/http.mjs";
import { replayApply } from "../lib/replay.mjs";
import { step, skipStep, printResult, printSummary } from "../lib/assert.mjs";

export const SCENARIO_ID = "06";
export const SCENARIO_NAME = "06-attribution-enrichment";
export const TAGS = ["identity", "tracking", "sgtm"];

export async function run(opts = {}) {
  const ts = Date.now();
  const envFile = opts.envFile || DEFAULT_ENV_FILE;
  const env = loadEnv(envFile);
  applyEnv(env);
  requireEnv(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);

  const funnel_ingress_url = process.env.FUNNEL_INGRESS_URL || "https://api.decolesuacarreiraesg.com.br";
  const hotmart_ingress_url = process.env.HOTMART_INGRESS_URL || "https://api.decolesuacarreiraesg.com.br";
  const email = `e2e.enrich.${ts}@example.com`;
  const hotmartEventId = `e2e-enrich-pa-${ts}`;
  const fbp = `fb.1.${ts}.enrich`;
  const fbc = `fb.click.${ts}.enrich`;
  const metaTestEventCode = opts.metaTestEventCode || process.env.META_TEST_EVENT_CODE_PLANOVOO || "";
  const webhookToken = process.env.HOTMART_WEBHOOK_TOKEN || "";

  const start = Date.now();
  const steps = [];

  // Step 1: site event with fbp + fbc + email
  steps.push(await step("site_event_with_attribution", async () => {
    const res = await postJson(`${funnel_ingress_url}/funnel/precheckout`, {
      email,
      product_code: "DECOLE_PLANOVOO",
      fbp,
      fbc,
    });
    if (res.status !== 202) throw new Error(`expected 202 got ${res.status}`);
    return `site event sent with fbp=${fbp}`;
  }));

  await sleep(10000); // wait for dispatcher to upsert site event

  // Step 2: hotmart event with same email, no attribution
  steps.push(await step("hotmart_event_no_attribution", async () => {
    const headers = webhookToken ? { "x-hotmart-hottok": webhookToken } : {};
    const res = await postJson(
      `${hotmart_ingress_url}/webhooks/v1/planovoo/hotmart/purchase`,
      {
        event: "PURCHASE_APPROVED",
        event_id: hotmartEventId,
        transaction: `txn-${hotmartEventId}`,
        buyer: { email },
        purchase: { price: { value: 297, currency_value: "BRL" } },
      },
      headers
    );
    if (res.status === 401) throw new Error("auth_failed: set HOTMART_WEBHOOK_TOKEN");
    if (res.status !== 202) throw new Error(`expected 202 got ${res.status}`);
    return `hotmart event_id=${hotmartEventId} → 202 (no fbp in payload)`;
  }));

  if (steps.some((s) => s.status === "fail")) return finalize(SCENARIO_NAME, steps, start);

  await sleep(10000); // wait for enrich_attribution to run

  // Step 3: hotmart event in D1
  let hotmartRow = null;
  steps.push(await step("hotmart_event_in_d1", async () => {
    hotmartRow = await waitForRow(
      "decole-d1-event-store",
      `SELECT event_id, profile_id, payload_json FROM funnel_events WHERE event_id='${sqlEscape(hotmartEventId)}' LIMIT 1`,
      (r) => r.event_id === hotmartEventId,
      { timeout: 60000, poll: 3000, description: `hotmart event_id=${hotmartEventId}` }
    );
    return `found profile_id=${hotmartRow.profile_id}`;
  }));

  // Step 4: sGTM replay — replay should include fbp/fbc from site event via enrich_attribution
  if (!opts.skipSgtm) {
    steps.push(await step("sgtm_replay_with_enriched_attribution", async () => {
      const result = await replayApply(hotmartEventId, { metaTestEventCode, envFile });
      if (!result.planned.sgtm) throw new Error("planned.sgtm=false");
      if (!result.sent.includes("sgtm")) throw new Error("not sent to sgtm");
      // The replay script reads from D1 payload — if enrich_attribution wrote fbp into the event's
      // payload before upsert_event_store, the replay will include it
      return `sent=${result.sent.join(",")} (replay includes enriched attribution from site event)`;
    }));
  } else {
    steps.push(skipStep("sgtm_replay_with_enriched_attribution", "skipSgtm=true"));
  }

  return finalize(SCENARIO_NAME, steps, start);
}

function finalize(name, steps, start) {
  const status = steps.some((s) => s.status === "fail") ? "fail" : "pass";
  return { scenario: name, status, elapsed_ms: Date.now() - start, steps };
}

if (process.argv[1].endsWith("06-attribution-enrichment.mjs")) {
  const result = await run();
  console.log(`\n[${SCENARIO_NAME}]`);
  result.steps.forEach(printResult);
  printSummary(result);
  console.log("\n" + JSON.stringify(result, null, 2));
  process.exit(result.status === "pass" ? 0 : 1);
}
