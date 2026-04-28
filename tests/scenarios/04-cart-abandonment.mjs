#!/usr/bin/env node
/**
 * Scenario 04: PURCHASE_OUT_OF_SHOPPING_CART (cart abandonment)
 * Trigger: POST hotmart ingress
 * Verifies: event in D1, NO emit_tracking (replay planned.sgtm=false)
 */
import { loadEnv, applyEnv, requireEnv, DEFAULT_ENV_FILE } from "../lib/config.mjs";
import { waitForRow, sqlEscape, sleep } from "../lib/d1.mjs";
import { postJson, assertStatus } from "../lib/http.mjs";
import { replayDryRun } from "../lib/replay.mjs";
import { step, printResult, printSummary } from "../lib/assert.mjs";

export const SCENARIO_ID = "04";
export const SCENARIO_NAME = "04-cart-abandonment";
export const TAGS = ["hotmart", "brevo"];

export async function run(opts = {}) {
  const ts = Date.now();
  const envFile = opts.envFile || DEFAULT_ENV_FILE;
  const env = loadEnv(envFile);
  applyEnv(env);
  requireEnv(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);

  const hotmart_ingress_url = process.env.HOTMART_INGRESS_URL || "https://api.decolesuacarreiraesg.com.br";
  const eventId = `e2e-cart-${ts}`;
  const email = `e2e.cart.${ts}@example.com`;
  const productPath = opts.productPath || "planovoo";
  const webhookToken = process.env.HOTMART_WEBHOOK_TOKEN || "";

  const start = Date.now();
  const steps = [];

  // Step 1: POST hotmart webhook
  steps.push(await step("webhook_accepted", async () => {
    const headers = webhookToken ? { "x-hotmart-hottok": webhookToken } : {};
    const res = await postJson(
      `${hotmart_ingress_url}/webhooks/v1/${productPath}/hotmart/purchase`,
      {
        event: "PURCHASE_OUT_OF_SHOPPING_CART",
        event_id: eventId,
        buyer: { email },
        purchase: { price: { value: 297, currency_value: "BRL" } },
      },
      headers
    );
    if (res.status === 401) throw new Error("auth_failed: set HOTMART_WEBHOOK_TOKEN");
    assertStatus(res, 202, "hotmart webhook cart abandonment");
    return `event_id=${eventId} → 202`;
  }));

  if (steps[0].status === "fail") return finalize(SCENARIO_NAME, steps, start);

  await sleep(5000);

  // Step 2: event in D1
  let eventRow = null;
  steps.push(await step("event_in_d1", async () => {
    eventRow = await waitForRow(
      "decole-d1-event-store",
      `SELECT event_id, event_type, source FROM funnel_events WHERE event_id='${sqlEscape(eventId)}' LIMIT 1`,
      (r) => r.event_id === eventId,
      { timeout: 90000, poll: 4000, description: `PURCHASE_OUT_OF_SHOPPING_CART event_id=${eventId}` }
    );
    if (eventRow.event_type !== "PURCHASE_OUT_OF_SHOPPING_CART") {
      throw new Error(`expected PURCHASE_OUT_OF_SHOPPING_CART got ${eventRow.event_type}`);
    }
    return `event_type=${eventRow.event_type} source=${eventRow.source}`;
  }));

  // Step 3: confirm NO sGTM planned (replay dry-run should return planned.sgtm=false)
  steps.push(await step("no_sgtm_emit_tracking", async () => {
    const result = await replayDryRun(eventId, { envFile });
    // planned.sgtm=false means the product/event_type config has no emit_tracking
    // OR the catalog resolves no sGTM endpoint for this event_type
    // Either way: no tracking destination expected
    if (result.planned?.sgtm === true) {
      throw new Error("planned.sgtm=true — PURCHASE_OUT_OF_SHOPPING_CART should NOT have sGTM tracking (dedup with BEGIN_CHECKOUT)");
    }
    return `planned.sgtm=${result.planned?.sgtm} (correct: no tracking)`;
  }));

  return finalize(SCENARIO_NAME, steps, start);
}

function finalize(name, steps, start) {
  const status = steps.some((s) => s.status === "fail") ? "fail" : "pass";
  return { scenario: name, status, elapsed_ms: Date.now() - start, steps };
}

if (process.argv[1].endsWith("04-cart-abandonment.mjs")) {
  const result = await run();
  console.log(`\n[${SCENARIO_NAME}]`);
  result.steps.forEach(printResult);
  printSummary(result);
  console.log("\n" + JSON.stringify(result, null, 2));
  process.exit(result.status === "pass" ? 0 : 1);
}
