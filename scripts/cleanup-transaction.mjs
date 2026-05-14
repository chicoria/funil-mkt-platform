#!/usr/bin/env node
/**
 * cleanup-transaction.mjs
 *
 * Ferramenta operacional para gerir uma transação Hotmart.
 *
 * Modos de operação:
 *   (sem flags)              Inspeciona historial D1 + tokens Postgres (read-only)
 *   --replay                 Limpa DEDUPE_KV de todos os eventos → permite reenvio completo
 *   --remove-event <TIPO>    Remove evento(s) de um tipo específico do D1 + DEDUPE_KV
 *                            ⚠️  Apaga historial — só usar em testes
 *   --remove-all-events      Remove TODOS os eventos da transação do D1 + DEDUPE_KV
 *                            ⚠️  Apaga historial completo — só usar em testes
 *   --delete-tokens          Apaga tokens Postgres da transação (pergunta antes)
 *   --yes                    Responde "sim" a todas as perguntas (pipelines)
 *
 * Exemplos:
 *   # Inspecionar — não altera nada
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs HP4217962122
 *
 *   # Remover só o PURCHASE_REFUNDED e limpar dedupe (re-testar desde esse evento)
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs HP4217962122 --remove-event PURCHASE_REFUNDED
 *
 *   # Reset completo para re-testar desde o início (remove tudo + tokens)
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs HP4217962122 --remove-all-events --delete-tokens --yes
 *
 *   # Só limpar dedupe para reenvio sem perder historial
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs HP4217962122 --replay
 *
 *   # Apagar tokens Postgres (pergunta antes)
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs HP4217962122 --delete-tokens
 */

import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../../..");
const wranglerDispatcherCwd = resolve(rootDir, "backend/cloudflare/workers/funnel-dispatcher");

const DEDUPE_KV_BINDING = "DEDUPE_KV";
const EVENT_STORE_DB = "decole-d1-event-store";
const VPS_HOST = "45.55.244.11";
const VPS_POSTGRES_CONTAINER = "n8n-docker-caddy-postgres-1";
const VPS_POSTGRES_USER = "decole";
const VPS_POSTGRES_DB = "decole";

const KNOWN_HANDLERS = [
  "resolve_identity",
  "upsert_event_store",
  "enrich_attribution",
  "update_brevo_funnel",
  "emit_tracking",
  "forward_n8n",
  "call_product_api",
  "send_template_email",
  "invalidate_purchase_token",
  "send_brevo_doi",
  "send_cart_abandonment_email",
  "sync_brevo_segments",
];

// ─── helpers ────────────────────────────────────────────────────────────────

function prompt(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); res(answer.trim()); });
  });
}

function d1Query(dbName, sql) {
  const out = execFileSync(
    "npx", ["wrangler", "d1", "execute", dbName, "--remote", "--json", "--command", sql],
    { cwd: wranglerDispatcherCwd, encoding: "utf8" }
  );
  return JSON.parse(out)?.[0]?.results ?? [];
}

function d1Execute(dbName, sql) {
  const out = execFileSync(
    "npx", ["wrangler", "d1", "execute", dbName, "--remote", "--json", "--command", sql],
    { cwd: wranglerDispatcherCwd, encoding: "utf8" }
  );
  return JSON.parse(out)?.[0]?.meta ?? { changes: 0 };
}

function kvDeleteKey(binding, key) {
  execFileSync(
    "npx", ["wrangler", "kv", "key", "delete", key, `--binding=${binding}`, "--remote"],
    { cwd: wranglerDispatcherCwd, encoding: "utf8", stdio: "pipe" }
  );
}

function clearDedupeKeys(eventIds) {
  let deleted = 0;
  let notFound = 0;
  for (const eventId of eventIds) {
    for (const handler of KNOWN_HANDLERS) {
      try { kvDeleteKey(DEDUPE_KV_BINDING, `${eventId}:${handler}`); deleted++; }
      catch { notFound++; }
    }
  }
  return { deleted, notFound };
}

function psql(sql) {
  const out = execFileSync(
    "ssh",
    [
      "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10",
      `root@${VPS_HOST}`,
      `docker exec -i ${VPS_POSTGRES_CONTAINER} psql -U ${VPS_POSTGRES_USER} -d ${VPS_POSTGRES_DB} -t`,
    ],
    { encoding: "utf8", input: sql + "\n" }
  );
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const transactionId = args.find((a) => !a.startsWith("--"));
  const doReplay = args.includes("--replay");
  const doDeleteTokens = args.includes("--delete-tokens");
  const doRemoveAllEvents = args.includes("--remove-all-events");
  const yes = args.includes("--yes");

  // --remove-event PURCHASE_REFUNDED  (valor após o flag)
  const removeEventIdx = args.indexOf("--remove-event");
  const removeEventType = removeEventIdx !== -1 ? args[removeEventIdx + 1]?.toUpperCase() : null;

  if (!transactionId) {
    console.log("Uso: node cleanup-transaction.mjs <TRANSACTION_ID> [--replay] [--remove-event TIPO] [--remove-all-events] [--delete-tokens] [--yes]");
    process.exit(1);
  }

  const activeFlags = [
    doReplay && "--replay",
    removeEventType && `--remove-event ${removeEventType}`,
    doRemoveAllEvents && "--remove-all-events",
    doDeleteTokens && "--delete-tokens",
    yes && "--yes",
  ].filter(Boolean).join(" ") || "inspecionar";

  console.log(`\n=== transaction ${transactionId} [${activeFlags}] ===\n`);

  // ── 1. Inspecionar historial no D1 (sempre read-only) ────────────────────
  console.log("1. Historial de eventos no D1...");
  const events = d1Query(
    EVENT_STORE_DB,
    `SELECT event_id, event_type, source, occurred_at, profile_id
     FROM funnel_events
     WHERE payload_json LIKE '%${transactionId}%'
     ORDER BY occurred_at ASC`
  );

  if (events.length === 0) {
    console.log("   Nenhum evento encontrado para esta transação.");
  } else {
    console.log(`   ${events.length} evento(s):`);
    for (const e of events) {
      console.log(`   ${e.occurred_at.slice(0, 19)}  ${e.event_type.padEnd(28)} ${e.event_id}`);
    }
  }

  const allEventIds = [...new Set(events.map((e) => e.event_id).filter(Boolean))];
  const profileIds  = [...new Set(events.map((e) => e.profile_id).filter(Boolean))];
  if (profileIds.length) console.log(`   profile: ${profileIds[0]}`);

  // ── 2. Inspecionar Postgres ───────────────────────────────────────────────
  console.log("\n2. Tokens no Postgres...");
  const tokenRows = psql(
    `SELECT token, status, hotmart_transacao, criado_at FROM plano_voo_tokens WHERE hotmart_transacao = '${transactionId}' ORDER BY criado_at`
  );

  if (tokenRows.length === 0) {
    console.log("   Nenhum token encontrado.");
  } else {
    console.log(`   ${tokenRows.length} token(s):`);
    tokenRows.forEach((r) => console.log(`   ${r}`));
  }

  // ── 3. Replay — limpar DEDUPE_KV sem apagar historial ────────────────────
  if (doReplay) {
    console.log("\n3. --replay: limpando DEDUPE_KV (historial D1 preservado)...");
    if (allEventIds.length === 0) {
      console.log("   Nenhum event_id — nada a limpar.");
    } else {
      const { deleted, notFound } = clearDedupeKeys(allEventIds);
      console.log(`   ${deleted} chave(s) removida(s), ${notFound} já não existiam.`);
      console.log("   ✓ Prontos para replay — reenvie os webhooks pelo Hotmart.");
    }
  }

  // ── 4. Remover evento específico do D1 + DEDUPE_KV ───────────────────────
  if (removeEventType) {
    console.log(`\n4. --remove-event ${removeEventType}: ⚠️  apaga do historial D1...`);

    const toRemove = events.filter((e) => e.event_type === removeEventType);
    if (toRemove.length === 0) {
      console.log(`   Nenhum evento do tipo ${removeEventType} encontrado.`);
    } else {
      console.log(`   Encontrado(s): ${toRemove.length}`);
      toRemove.forEach((e) => console.log(`   ${e.occurred_at.slice(0, 19)}  ${e.event_id}`));

      let confirmed = yes;
      if (!confirmed) {
        const answer = await prompt(`   Apagar estes ${toRemove.length} evento(s) do D1 + DEDUPE_KV? [s/N] `);
        confirmed = answer.toLowerCase() === "s" || answer.toLowerCase() === "sim";
      }

      if (!confirmed) {
        console.log("   Cancelado — eventos mantidos.");
      } else {
        const toRemoveIds = toRemove.map((e) => e.event_id);
        const inClause = toRemoveIds.map((id) => `'${id}'`).join(",");
        const meta = d1Execute(EVENT_STORE_DB, `DELETE FROM funnel_events WHERE event_id IN (${inClause})`);
        console.log(`   D1: ${meta.changes} evento(s) apagado(s).`);
        const { deleted, notFound } = clearDedupeKeys(toRemoveIds);
        console.log(`   DEDUPE_KV: ${deleted} chave(s) removida(s), ${notFound} já não existiam.`);
        console.log(`   ✓ Reenvie o evento ${removeEventType} pelo Hotmart para re-testar.`);
      }
    }
  }

  // ── 5. Remover TODOS os eventos do D1 + DEDUPE_KV ────────────────────────
  if (doRemoveAllEvents) {
    console.log("\n5. --remove-all-events: ⚠️  apaga TODO o historial D1 da transação...");

    if (allEventIds.length === 0) {
      console.log("   Nenhum evento encontrado — nada a apagar.");
    } else {
      console.log(`   Serão apagados ${allEventIds.length} evento(s):`);
      events.forEach((e) => console.log(`   ${e.occurred_at.slice(0, 19)}  ${e.event_type.padEnd(28)} ${e.event_id}`));

      let confirmed = yes;
      if (!confirmed) {
        const answer = await prompt(`\n   ⚠️  Apagar TODOS os ${allEventIds.length} eventos do D1 + DEDUPE_KV? [s/N] `);
        confirmed = answer.toLowerCase() === "s" || answer.toLowerCase() === "sim";
      }

      if (!confirmed) {
        console.log("   Cancelado — eventos mantidos.");
      } else {
        const inClause = allEventIds.map((id) => `'${id}'`).join(",");
        const meta = d1Execute(EVENT_STORE_DB, `DELETE FROM funnel_events WHERE event_id IN (${inClause})`);
        console.log(`   D1: ${meta.changes} evento(s) apagado(s).`);
        const { deleted, notFound } = clearDedupeKeys(allEventIds);
        console.log(`   DEDUPE_KV: ${deleted} chave(s) removida(s), ${notFound} já não existiam.`);
        console.log("   ✓ Historial limpo — podes re-testar desde o início.");
      }
    }
  }

  // ── 6. Apagar tokens Postgres (opcional/interativo) ───────────────────────
  if (doDeleteTokens) {
    console.log("\n6. --delete-tokens: apagar tokens Postgres...");
    if (tokenRows.length === 0) {
      console.log("   Nenhum token para apagar.");
    } else {
      let confirmed = yes;
      if (!confirmed) {
        const answer = await prompt(`   Apagar ${tokenRows.length} token(s) e seus resultados? [s/N] `);
        confirmed = answer.toLowerCase() === "s" || answer.toLowerCase() === "sim";
      }

      if (!confirmed) {
        console.log("   Tokens mantidos.");
      } else {
        const deletedResultados = psql(
          `DELETE FROM plano_voo_resultados WHERE token IN (SELECT token FROM plano_voo_tokens WHERE hotmart_transacao = '${transactionId}') RETURNING token`
        );
        console.log(`   plano_voo_resultados apagados: ${deletedResultados.length}`);
        const deletedTokens = psql(
          `DELETE FROM plano_voo_tokens WHERE hotmart_transacao = '${transactionId}' RETURNING token, status`
        );
        console.log(`   plano_voo_tokens apagados: ${deletedTokens.length}`);
        deletedTokens.forEach((r) => console.log(`   ${r}`));
      }
    }
  }

  console.log(`\n=== concluído ===\n`);
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
