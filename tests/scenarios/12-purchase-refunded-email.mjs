#!/usr/bin/env node
/**
 * Scenario 12: PURCHASE_REFUNDED email
 * Trigger: POST Hotmart PURCHASE_REFUNDED
 * Verifies: D1 event, Brevo template 13 and rendered refund content.
 */
import { runCli, runPurchaseEmailScenario } from "../lib/purchase-email-scenario.mjs";

export const SCENARIO_ID = "12";
export const SCENARIO_NAME = "12-purchase-refunded-email";
export const TAGS = ["hotmart", "brevo", "retention", "planovoo", "external"];

const config = {
  scenarioName: SCENARIO_NAME,
  eventSlug: "purchase-refunded",
  eventType: "PURCHASE_REFUNDED",
  templateId: 13,
  expectedTexts: [
    "Reembolso confirmado",
    "Confirmamos o reembolso",
    "Código da transação",
  ],
};

export async function run(opts = {}) {
  return runPurchaseEmailScenario(config, opts);
}

if (process.argv[1].endsWith("12-purchase-refunded-email.mjs")) {
  await runCli(config);
}
