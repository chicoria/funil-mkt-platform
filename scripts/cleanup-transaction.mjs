#!/usr/bin/env node
/**
 * cleanup-transaction.mjs
 *
 * Ferramenta operacional para gerir uma transação Hotmart.
 *
 * O que FAZ:
 *   1. Inspeciona o historial de eventos no D1 (read-only — nunca apaga)
 *   2. Limpa chaves DEDUPE_KV → permite reprocessar/replay de eventos
 *   3. (Opcional/interativo) Apaga tokens Postgres da transação
 *
 * O que NÃO FAZ:
 *   - Não apaga funnel_events do D1 (historial é permanente)
 *   - Não apaga identity_links (identidade do perfil é permanente)
 *
 * Uso:
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs <TRANSACTION_ID> [opções]
 *
 * Opções:
 *   --replay          Limpa chaves DEDUPE_KV para permitir reprocessar os eventos
 *   --delete-tokens   Apaga tokens Postgres (pergunta interativamente; combinar com --yes para forçar)
 *   --yes             Responde "sim" a todas as perguntas (útil em pipelines)
 *
 * Exemplos:
 *   # Só inspecionar — não altera nada
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs HP4217962122
 *
 *   # Limpar dedupe para reprocessar eventos (ex: reenvio do Hotmart)
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs HP4217962122 --replay
 *
 *   # Apagar tokens Postgres (pergunta antes)
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs HP4217962122 --delete-tokens
 *
 *   # Replay + apagar tokens sem perguntar
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs HP4217962122 --replay --delete-tokens --yes
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

function usage() {
  console.log(`
Uso: node backend/cloudflare/scripts/cleanup-transaction.mjs <TRANSACTION_ID> [opções]

  --replay          Limpa DEDUPE_KV para permitir replay dos eventos
  --delete-tokens   Apaga tokens Postgres da transação (pergunta antes)
  --yes             Responde "sim" a todas as perguntas sem interação
`);
}

function d1Query(dbName, sql) {
  const out = execFileSync(
    "npx", ["wrangler", "d1", "execute", dbName, "--remote", "--json", "--command", sql],
    { cwd: wranglerDispatcherCwd, encoding: "utf8" }
  );
  return JSON.parse(out)?.[0]?.results ?? [];
}

function kvDelete(binding, key) {
  execFileSync(
    "npx", ["wrangler", "kv", "key", "delete", key, `--binding=${binding}`, "--remote"],
    { cwd: wranglerDispatcherCwd, encoding: "utf8", stdio: "pipe" }
  );
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
  const yes = args.includes("--yes");

  if (!transactionId) { usage(); process.exit(1); }

  const flags = [doReplay && "--replay", doDeleteTokens && "--delete-tokens", yes && "--yes"]
    .filter(Boolean).join(" ") || "(só inspecionar)";
  console.log(`\n=== transaction ${transactionId} [${flags}] ===\n`);

  // ── 1. Inspecionar historial no D1 (read-only) ────────────────────────────
  console.log("1. Historial de eventos no D1 (read-only)...");
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
    console.log(`   ${events.length} evento(s) no historial:`);
    for (const e of events) {
      console.log(`   ${e.occurred_at.slice(0, 19)}  ${e.event_type.padEnd(25)} ${e.event_id}`);
    }
  }

  const eventIds = [...new Set(events.map((e) => e.event_id).filter(Boolean))];
  const profileIds = [...new Set(events.map((e) => e.profile_id).filter(Boolean))];
  if (profileIds.length) console.log(`   profile: ${profileIds[0]}`);

  // ── 2. Inspecionar Postgres ───────────────────────────────────────────────
  console.log("\n2. Tokens no Postgres...");
  const tokenRows = psql(
    `SELECT token, status, hotmart_transacao, criado_at FROM plano_voo_tokens WHERE hotmart_transacao = '${transactionId}' ORDER BY criado_at`
  );

  if (tokenRows.length === 0) {
    console.log("   Nenhum token encontrado para esta transação.");
  } else {
    console.log(`   ${tokenRows.length} token(s) encontrado(s):`);
    tokenRows.forEach((r) => console.log(`   ${r}`));
  }

  // ── 3. Replay — limpar DEDUPE_KV ─────────────────────────────────────────
  if (doReplay) {
    console.log("\n3. Limpando DEDUPE_KV para permitir replay...");
    if (eventIds.length === 0) {
      console.log("   Nenhum event_id encontrado — nada a limpar.");
    } else {
      let deleted = 0;
      let notFound = 0;
      for (const eventId of eventIds) {
        for (const handler of KNOWN_HANDLERS) {
          try {
            kvDelete(DEDUPE_KV_BINDING, `${eventId}:${handler}`);
            deleted++;
          } catch {
            notFound++;
          }
        }
      }
      console.log(`   ${deleted} chave(s) removida(s), ${notFound} já não existiam.`);
      console.log("   ✓ Eventos prontos para replay — reenvie o webhook do Hotmart.");
    }
  } else {
    console.log("\n3. Replay DEDUPE_KV — não solicitado (use --replay para activar).");
  }

  // ── 4. Apagar tokens Postgres (opcional/interativo) ───────────────────────
  if (doDeleteTokens) {
    console.log("\n4. Apagar tokens Postgres...");
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
  } else {
    console.log("\n4. Apagar tokens — não solicitado (use --delete-tokens para activar).");
  }

  console.log(`\n=== concluído ===\n`);
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
