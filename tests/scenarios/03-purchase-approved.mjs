#!/usr/bin/env node
/**
 * Scenario 03: PURCHASE_APPROVED
 * Trigger: POST hotmart ingress with PURCHASE_APPROVED
 * Verifies: event in D1, identity resolved, attribution enriched, sGTM via replay
 */
import { loadEnv, applyEnv, requireEnv, DEFAULT_ENV_FILE, parseScenarioArgs } from "../lib/config.mjs";
import { waitForRow, sqlEscape, sleep } from "../lib/d1.mjs";
import { postJson, assertStatus } from "../lib/http.mjs";
import { replayApply } from "../lib/replay.mjs";
import { step, skipStep, assertPayloadJson, printResult, printSummary } from "../lib/assert.mjs";

export const SCENARIO_ID = "03";
export const SCENARIO_NAME = "03-purchase-approved";
export const TAGS = ["hotmart", "identity", "tracking", "sgtm"];

export async function run(opts = {}) {
  const ts = Date.now();
  const envFile = opts.envFile || DEFAULT_ENV_FILE;
  const env = loadEnv(envFile);
  applyEnv(env);
  requireEnv(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);

  const hotmart_ingress_url = process.env.HOTMART_INGRESS_URL || "https://api.decolesuacarreiraesg.com.br";
  const eventId = opts.eventId || `e2e-pa-${ts}`;
  const email = opts.email || `e2e.pa.${ts}@example.com`;
  const productCode = opts.productCode || "DECOLE_PLANOVOO";
  const productPath = opts.productPath || "planovoo";
  const metaTestEventCode = opts.metaTestEventCode || process.env.META_TEST_EVENT_CODE_PLANOVOO || "";
  const webhookToken = process.env.HOTMART_WEBHOOK_TOKEN || "";

  const start = Date.now();
  const steps = [];

  // Step 1: POST hotmart webhook
  steps.push(await step("webhook_accepted", async () => {
    const headers = webhookToken ? { "x-hotmart-hottok": webhookToken } : {};
    const res = await postJson(
      `${hotmart_ingress_url}/webhooks/v1/${productPath}/hotmart/purchase`,
      {
        event: "PURCHASE_APPROVED",
        event_id: eventId,
        transaction: `txn-${eventId}`,
        buyer: { email },
        purchase: { price: { value: 297, currency_value: "BRL" } },
      },
      headers
    );
    if (res.status === 401) throw new Error("auth_failed: set HOTMART_WEBHOOK_TOKEN");
    assertStatus(res, 202, "hotmart webhook");
    return `event_id=${eventId} → 202`;
  }));

  if (steps[0].status === "fail") return finalize(SCENARIO_NAME, steps, start);

  await sleep(5000);

  // Step 2: event in D1
  let eventRow = null;
  steps.push(await step("event_in_d1", async () => {
    eventRow = await waitForRow(
      "decole-d1-event-store",
      `SELECT event_id, event_type, source, email_hash, profile_id, payload_json FROM funnel_events WHERE event_id='${sqlEscape(eventId)}' LIMIT 1`,
      (r) => r.event_id === eventId,
      { timeout: 90000, poll: 4000, description: `PURCHASE_APPROVED event_id=${eventId}` }
    );
    if (eventRow.event_type !== "PURCHASE_APPROVED") throw new Error(`expected PURCHASE_APPROVED got ${eventRow.event_type}`);
    if (eventRow.source !== "hotmart") throw new Error(`expected source=hotmart got ${eventRow.source}`);
    return `event_type=${eventRow.event_type} profile_id=${eventRow.profile_id}`;
  }));

  // Step 3: identity resolved
  steps.push(await step("identity_resolved", async () => {
    if (!eventRow?.email_hash) throw new Error("email_hash not in funnel_events");
    return `email_hash=${eventRow.email_hash.slice(0, 12)}... profile_id=${eventRow.profile_id}`;
  }));

  // Step 4: attribution enrichment (best-effort — only present if a prior site event exists for the same profile)
  steps.push(await step("attribution_enrichment_checked", async () => {
    let payload = {};
    try { payload = JSON.parse(eventRow?.payload_json || "{}"); } catch { /* ignore */ }
    const hasEnrichment = payload.fbp || payload.fbc || payload.client_ip;
    if (hasEnrichment) {
      return `enriched: fbp=${!!payload.fbp} fbc=${!!payload.fbc} client_ip=${!!payload.client_ip}`;
    }
    return "no prior site event for this profile (enrichment skipped — expected for isolated canary)";
  }));

  // Step 5: sGTM via replay
  if (!opts.skipSgtm) {
    steps.push(await step("sgtm_replay", async () => {
      const result = await replayApply(eventId, { metaTestEventCode, envFile });
      if (!result.planned.sgtm) throw new Error("replay planned.sgtm=false (missing tracking config)");
      if (!result.sent.includes("sgtm")) throw new Error("replay did not send to sgtm");
      return `sent=${result.sent.join(",")} meta_code=${result.meta_test_event_code_applied}`;
    }));
  } else {
    steps.push(skipStep("sgtm_replay", "skipSgtm=true"));
  }

  return finalize(SCENARIO_NAME, steps, start);
}

function finalize(name, steps, start) {
  const status = steps.some((s) => s.status === "fail") ? "fail" : "pass";
  return { scenario: name, status, elapsed_ms: Date.now() - start, steps };
}

if (process.argv[1].endsWith("03-purchase-approved.mjs")) {
  const result = await run(parseScenarioArgs());
  console.log(`\n[${SCENARIO_NAME}]`);
  result.steps.forEach(printResult);
  printSummary(result);
  console.log("\n" + JSON.stringify(result, null, 2));
  process.exit(result.status === "pass" ? 0 : 1);
}
