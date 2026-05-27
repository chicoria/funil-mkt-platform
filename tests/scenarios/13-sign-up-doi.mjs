#!/usr/bin/env node
/**
 * Scenario 13: SIGN_UP — DOI Confirmation (server-side)
 *
 * Simulates a user clicking a DOI confirmation link handled by links-redirect.
 * Verifies that:
 *   - links-redirect returns 302 → confirmacao.html
 *   - SIGN_UP event is enqueued and processed by funnel-dispatcher
 *   - Event appears in D1 with correct type and source
 *   - Identity is resolved (profile_id set)
 *   - Attribution (fbp) is captured in the payload
 *   - emit_tracking runs and sGTM receives meta_event_name=CompleteRegistration
 *
 * Trigger:  GET {DECOLE_LINKS_URL}/decole-esg/signup?event_id=...&email=...&fbp=...
 * Chain:    resolve_identity → upsert_event_store → enrich_attribution → update_brevo_funnel → emit_tracking
 * sGTM:     GA4 sign_up / Meta CompleteRegistration
 */
import { loadEnv, applyEnv, requireEnv, DEFAULT_ENV_FILE, parseScenarioArgs } from "../lib/config.mjs";
import { waitForRow, sqlEscape, sleep } from "../lib/d1.mjs";
import { getUrl } from "../lib/http.mjs";
import { replayApply } from "../lib/replay.mjs";
import { step, skipStep, assertPayloadJson, printResult, printSummary } from "../lib/assert.mjs";

export const SCENARIO_ID = "13";
export const SCENARIO_NAME = "13-sign-up-doi";
export const TAGS = ["ingress", "identity", "tracking", "sgtm"];

export async function run(opts = {}) {
  const ts = Date.now();
  const envFile = opts.envFile || DEFAULT_ENV_FILE;
  const env = loadEnv(envFile);
  applyEnv(env);
  requireEnv(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);

  const linksUrl = process.env.DECOLE_LINKS_URL || "https://links.decolesuacarreiraesg.com.br";
  const metaTestEventCode = opts.metaTestEventCode || process.env.META_TEST_EVENT_CODE_DECOLE_ESG || "";

  // Use a deterministic event_id so we can query D1 and replay without @-chars
  const eventId = `sign-up-e2e-13-${ts}`;
  const email = `e2e.doi.${ts}@example.com`;
  const fbp = `fb.1.${ts}.doi`;
  const utmSource = "e2e-test";
  const productCode = "DECOLE_ESG_MENTORIA";

  const start = Date.now();
  const steps = [];

  // Step 1: GET /decole-esg/signup → 302 to confirmacao.html
  steps.push(await step("redirect_302_to_confirmacao", async () => {
    const res = await getUrl(`${linksUrl}/decole-esg/signup`, {
      event_id: eventId,
      email,
      fbp,
      utm_source: utmSource,
    });
    if (res.status !== 302) throw new Error(`expected 302 got ${res.status}`);
    if (!res.location?.includes("confirmacao")) {
      throw new Error(`unexpected redirect location: ${res.location}`);
    }
    return `→ ${res.location}`;
  }));

  if (steps[0].status === "fail") return finalize(SCENARIO_NAME, steps, start);

  // Wait for queue processing (links-redirect enqueues → funnel-dispatcher processes)
  await sleep(10000);

  // Step 2: SIGN_UP event in D1
  let eventRow = null;
  steps.push(await step("sign_up_in_d1", async () => {
    eventRow = await waitForRow(
      "decole-d1-event-store",
      `SELECT event_id, event_type, source, profile_id, payload_json FROM funnel_events WHERE event_id='${sqlEscape(eventId)}' LIMIT 1`,
      (r) => r.event_id === eventId,
      { timeout: 60000, poll: 3000, description: `SIGN_UP event_id=${eventId}` }
    );
    if (eventRow.event_type !== "SIGN_UP") throw new Error(`expected SIGN_UP got ${eventRow.event_type}`);
    if (eventRow.source !== "site") throw new Error(`expected source=site got ${eventRow.source}`);
    return `event_type=${eventRow.event_type} source=${eventRow.source}`;
  }));

  if (steps[1].status === "fail") return finalize(SCENARIO_NAME, steps, start);

  // Step 3: identity resolved — profile_id set
  steps.push(await step("identity_resolved", async () => {
    if (!eventRow?.profile_id) throw new Error("profile_id not set — resolve_identity did not run");
    return `profile_id=${eventRow.profile_id}`;
  }));

  // Step 4: attribution captured — payload contains fbp
  steps.push(await step("payload_has_fbp", async () => {
    const payload = assertPayloadJson(eventRow, { fbp: true });
    if (payload.fbp !== fbp) throw new Error(`expected fbp=${fbp} got ${payload.fbp}`);
    return `fbp=${payload.fbp}`;
  }));

  // Step 5: sGTM via replay — GA4 sign_up + Meta CompleteRegistration
  if (!opts.skipSgtm) {
    steps.push(await step("sgtm_planned", async () => {
      const { replayDryRun } = await import("../lib/replay.mjs");
      const result = await replayDryRun(eventId, { envFile });
      if (!result.planned?.sgtm) {
        throw new Error(
          "planned.sgtm=false — tracking config missing or emit_tracking not in SIGN_UP chain"
        );
      }
      return `planned.sgtm=true event_type=${result.event_type}`;
    }));

    steps.push(await step("sgtm_send_complete_registration", async () => {
      const result = await replayApply(eventId, { metaTestEventCode, envFile });
      if (!result.sent.includes("sgtm")) throw new Error("sgtm not in sent list");
      const codeNote = result.meta_test_event_code_applied
        ? ` meta_test_event_code=${metaTestEventCode}`
        : " (no test event code — hit goes to production Meta)";
      return `sent=${result.sent.join(",")}${codeNote}`;
    }));
  } else {
    steps.push(skipStep("sgtm_planned", "skipSgtm=true"));
    steps.push(skipStep("sgtm_send_complete_registration", "skipSgtm=true"));
  }

  return finalize(SCENARIO_NAME, steps, start);
}

function finalize(name, steps, start) {
  const status = steps.some((s) => s.status === "fail") ? "fail" : "pass";
  return { scenario: name, status, elapsed_ms: Date.now() - start, steps };
}

if (process.argv[1].endsWith("13-sign-up-doi.mjs")) {
  const result = await run(parseScenarioArgs());
  console.log(`\n[${SCENARIO_NAME}]`);
  result.steps.forEach(printResult);
  printSummary(result);
  console.log("\n" + JSON.stringify(result, null, 2));
  process.exit(result.status === "pass" ? 0 : 1);
}
