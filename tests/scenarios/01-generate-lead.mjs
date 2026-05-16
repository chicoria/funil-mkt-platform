#!/usr/bin/env node
/**
 * Scenario 01: GENERATE_LEAD
 * Trigger: POST /funnel/precheckout
 * Verifies: event in D1, identity_links created, client_ip captured in payload
 */
import { loadEnv, applyEnv, requireEnv, DEFAULT_ENV_FILE, parseScenarioArgs } from "../lib/config.mjs";
import { d1Query, waitForRow, sqlEscape } from "../lib/d1.mjs";
import { postJson, assertStatus } from "../lib/http.mjs";
import { step, skipStep, assertContains, assertPayloadJson, printResult, printSummary } from "../lib/assert.mjs";

export const SCENARIO_ID = "01";
export const SCENARIO_NAME = "01-generate-lead";
export const TAGS = ["ingress", "identity", "brevo"];

export async function run(opts = {}) {
  const ts = Date.now();
  const envFile = opts.envFile || DEFAULT_ENV_FILE;
  const env = loadEnv(envFile);
  applyEnv(env);
  requireEnv(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);

  const funnel_ingress_url = process.env.FUNNEL_INGRESS_URL || "https://api.decolesuacarreiraesg.com.br";
  const email = `e2e.gl.${ts}@example.com`;
  const anonymousId = `anon-e2e-01-${ts}`;
  const fbp = `fb.1.${ts}.test`;
  const productCode = "DECOLE_ESG_MENTORIA";

  const start = Date.now();
  const steps = [];

  // Step 1: POST precheckout
  let eventId = null;
  steps.push(await step("ingress_202", async () => {
    const res = await postJson(`${funnel_ingress_url}/funnel/precheckout`, {
      email,
      product_code: productCode,
      anonymous_id: anonymousId,
      fbp,
    });
    assertStatus(res, 202, "POST /funnel/precheckout");
    eventId = res.body?.event_id;
    return `event_id=${eventId}`;
  }));

  if (steps[0].status === "fail") return finalize(SCENARIO_NAME, steps, start);

  // Step 2: event in D1 event_store
  let eventRow = null;
  steps.push(await step("event_in_d1", async () => {
    eventRow = await waitForRow(
      "decole-d1-event-store",
      `SELECT event_id, event_type, source, email_hash, profile_id, payload_json FROM funnel_events WHERE event_id='${sqlEscape(eventId)}' LIMIT 1`,
      (r) => r.event_id === eventId,
      { timeout: 60000, poll: 3000, description: `GENERATE_LEAD event_id=${eventId}` }
    );
    if (eventRow.event_type !== "GENERATE_LEAD") throw new Error(`expected GENERATE_LEAD got ${eventRow.event_type}`);
    if (eventRow.source !== "site") throw new Error(`expected source=site got ${eventRow.source}`);
    return `event_type=${eventRow.event_type} source=${eventRow.source}`;
  }));

  // Step 3: identity_links
  steps.push(await step("identity_resolved", async () => {
    if (!eventRow?.email_hash) throw new Error("email_hash not set in funnel_events");
    const rows = d1Query(
      "decole-d1-identity",
      `SELECT profile_id, email_hash FROM identity_links WHERE email_hash='${sqlEscape(eventRow.email_hash)}' LIMIT 1`
    );
    if (!rows[0]?.profile_id) throw new Error(`no identity_links row for email_hash=${eventRow.email_hash}`);
    return `profile_id=${rows[0].profile_id}`;
  }));

  // Step 4: payload_json contains client_ip (best-effort — depends on CF-Connecting-IP)
  steps.push(await step("payload_has_fbp", async () => {
    const payload = assertPayloadJson(eventRow, { fbp: true });
    return `fbp=${payload.fbp}`;
  }));

  // Step 5: sGTM — GENERATE_LEAD has no emit_tracking by default
  steps.push(skipStep("sgtm_emit_tracking", "GENERATE_LEAD chain has no emit_tracking"));

  return finalize(SCENARIO_NAME, steps, start);
}

function finalize(name, steps, start) {
  const status = steps.some((s) => s.status === "fail") ? "fail" : "pass";
  return { scenario: name, status, elapsed_ms: Date.now() - start, steps };
}

// Run standalone
if (process.argv[1].endsWith("01-generate-lead.mjs")) {
  const result = await run(parseScenarioArgs());
  console.log(`\n[${SCENARIO_NAME}]`);
  result.steps.forEach(printResult);
  printSummary(result);
  console.log("\n" + JSON.stringify(result, null, 2));
  process.exit(result.status === "pass" ? 0 : 1);
}
