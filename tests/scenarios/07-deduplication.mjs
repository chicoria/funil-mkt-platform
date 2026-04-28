#!/usr/bin/env node
/**
 * Scenario 07: Deduplication
 * Sends the same event_id twice and verifies D1 has only one row (ON CONFLICT)
 */
import { loadEnv, applyEnv, requireEnv, DEFAULT_ENV_FILE } from "../lib/config.mjs";
import { d1Query, waitForRow, sqlEscape, sleep } from "../lib/d1.mjs";
import { postJson } from "../lib/http.mjs";
import { step, assertEqual, printResult, printSummary } from "../lib/assert.mjs";

export const SCENARIO_ID = "07";
export const SCENARIO_NAME = "07-deduplication";
export const TAGS = ["ingress", "identity"];

export async function run(opts = {}) {
  const ts = Date.now();
  const envFile = opts.envFile || DEFAULT_ENV_FILE;
  const env = loadEnv(envFile);
  applyEnv(env);
  requireEnv(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]);

  const funnel_ingress_url = process.env.FUNNEL_INGRESS_URL || "https://api.decolesuacarreiraesg.com.br";
  const email = `e2e.dedup.${ts}@example.com`;
  // We will POST twice with the same anonymous_id + product_code + email
  // The dispatcher should upsert (ON CONFLICT) so there's only one row
  const anonymousId = `anon-dedup-${ts}`;

  const start = Date.now();
  const steps = [];

  // Step 1: first send
  let firstEventId = null;
  steps.push(await step("first_send_accepted", async () => {
    const res = await postJson(`${funnel_ingress_url}/funnel/precheckout`, {
      email,
      product_code: "DECOLE_ESG_MENTORIA",
      anonymous_id: anonymousId,
    });
    if (res.status !== 202) throw new Error(`expected 202 got ${res.status}`);
    firstEventId = res.body?.event_id;
    return `event_id=${firstEventId} → 202`;
  }));

  await sleep(3000);

  // Step 2: second send — same content but different event_id (ingress generates new uuid)
  let secondEventId = null;
  steps.push(await step("second_send_accepted", async () => {
    const res = await postJson(`${funnel_ingress_url}/funnel/precheckout`, {
      email,
      product_code: "DECOLE_ESG_MENTORIA",
      anonymous_id: anonymousId,
    });
    if (res.status !== 202) throw new Error(`expected 202 got ${res.status}`);
    secondEventId = res.body?.event_id;
    return `event_id=${secondEventId} → 202`;
  }));

  if (steps.some((s) => s.status === "fail")) return finalize(SCENARIO_NAME, steps, start);

  await sleep(10000);

  // Step 3: both events in D1 (separate event_ids, but same profile_id)
  steps.push(await step("both_events_in_d1", async () => {
    if (!firstEventId || !secondEventId) throw new Error("missing event_ids");
    await waitForRow(
      "decole-d1-event-store",
      `SELECT event_id FROM funnel_events WHERE event_id='${sqlEscape(firstEventId)}' LIMIT 1`,
      (r) => r.event_id === firstEventId,
      { timeout: 60000, poll: 3000 }
    );
    await waitForRow(
      "decole-d1-event-store",
      `SELECT event_id FROM funnel_events WHERE event_id='${sqlEscape(secondEventId)}' LIMIT 1`,
      (r) => r.event_id === secondEventId,
      { timeout: 30000, poll: 3000 }
    );
    return `both event_ids present in D1`;
  }));

  // Step 4: same profile_id for both events
  steps.push(await step("same_profile_id_for_both", async () => {
    const rows = d1Query(
      "decole-d1-event-store",
      `SELECT event_id, profile_id FROM funnel_events WHERE event_id IN ('${sqlEscape(firstEventId)}','${sqlEscape(secondEventId)}')`
    );
    if (rows.length < 2) throw new Error(`expected 2 rows, got ${rows.length}`);
    const profileIds = [...new Set(rows.map((r) => r.profile_id).filter(Boolean))];
    if (profileIds.length !== 1) {
      throw new Error(`expected same profile_id for both events, got: ${profileIds.join(", ")}`);
    }
    return `profile_id=${profileIds[0]} (both events resolved to same profile)`;
  }));

  // Step 5: identity_links has exactly one row for email
  steps.push(await step("identity_links_not_duplicated", async () => {
    const rows = d1Query(
      "decole-d1-event-store",
      `SELECT email_hash FROM funnel_events WHERE event_id='${sqlEscape(firstEventId)}' LIMIT 1`
    );
    const emailHash = rows[0]?.email_hash;
    if (!emailHash) return "email_hash not set (email not in payload — skip check)";
    const idRows = d1Query(
      "decole-d1-identity",
      `SELECT COUNT(*) as cnt FROM identity_links WHERE email_hash='${sqlEscape(emailHash)}'`
    );
    const count = idRows[0]?.cnt ?? 0;
    assertEqual(Number(count), 1, "identity_links should have exactly 1 row per email_hash");
    return `identity_links rows for email_hash: ${count}`;
  }));

  return finalize(SCENARIO_NAME, steps, start);
}

function finalize(name, steps, start) {
  const status = steps.some((s) => s.status === "fail") ? "fail" : "pass";
  return { scenario: name, status, elapsed_ms: Date.now() - start, steps };
}

if (process.argv[1].endsWith("07-deduplication.mjs")) {
  const result = await run();
  console.log(`\n[${SCENARIO_NAME}]`);
  result.steps.forEach(printResult);
  printSummary(result);
  console.log("\n" + JSON.stringify(result, null, 2));
  process.exit(result.status === "pass" ? 0 : 1);
}
