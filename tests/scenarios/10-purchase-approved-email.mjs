#!/usr/bin/env node
/**
 * Scenario 10: PURCHASE_APPROVED email
 * Trigger: POST Hotmart PURCHASE_APPROVED
 * Verifies: D1 event, Brevo template 12 and rendered form link.
 */
import { runCli, runPurchaseEmailScenario } from "../lib/purchase-email-scenario.mjs";

export const SCENARIO_ID = "10";
export const SCENARIO_NAME = "10-purchase-approved-email";
export const TAGS = ["hotmart", "brevo", "purchase", "planovoo", "external"];

const config = {
  scenarioName: SCENARIO_NAME,
  eventSlug: "purchase-approved",
  eventType: "PURCHASE_APPROVED",
  templateId: 12,
  expectedTexts: [
    "Plano de Voo",
    "Quero começar meu Plano de Voo já",
    "Código da transação",
  ],
  expectedHref: {
    description: "formulario Plano de Voo",
    predicate: (href) => {
      try {
        const url = new URL(href);
        return url.hostname === "plano.decolesuacarreiraesg.com.br" && url.pathname.startsWith("/formulario/");
      } catch {
        return false;
      }
    },
  },
};

export async function run(opts = {}) {
  return runPurchaseEmailScenario(config, opts);
}

if (process.argv[1].endsWith("10-purchase-approved-email.mjs")) {
  await runCli(config);
}
