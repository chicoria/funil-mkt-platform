#!/usr/bin/env node
/**
 * Scenario 11: PURCHASE_PROTEST email
 * Trigger: POST Hotmart PURCHASE_PROTEST
 * Verifies: D1 event, Brevo template 14 and rendered protest content.
 */
import { runCli, runPurchaseEmailScenario } from "../lib/purchase-email-scenario.mjs";

export const SCENARIO_ID = "11";
export const SCENARIO_NAME = "11-purchase-protest-email";
export const TAGS = ["hotmart", "brevo", "retention", "planovoo", "external"];

const config = {
  scenarioName: SCENARIO_NAME,
  eventSlug: "purchase-protest",
  eventType: "PURCHASE_PROTEST",
  templateId: 14,
  expectedTexts: [
    "Contestação recebida",
    "temporariamente suspenso",
    "Código da transação",
  ],
};

export async function run(opts = {}) {
  return runPurchaseEmailScenario(config, opts);
}

if (process.argv[1].endsWith("11-purchase-protest-email.mjs")) {
  await runCli(config);
}
