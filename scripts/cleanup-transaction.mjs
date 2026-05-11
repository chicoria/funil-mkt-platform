#!/usr/bin/env node
/**
 * cleanup-transaction.mjs
 *
 * Limpa todos os dados associados a uma transação Hotmart dos bancos D1 e Postgres.
 * Operações realizadas:
 *   1. D1 event-store  — localiza events pelo transaction, resolve profile_id e event_ids
 *   2. D1 event-store  — apaga funnel_events do profile
 *   3. D1 identity     — apaga identity_links do profile
 *   4. KV DEDUPE_KV    — apaga chaves de dedupe de cada event_id encontrado
 *   5. Postgres (VPS)  — apaga plano_voo_tokens PENDENTE/ERRO + plano_voo_resultados órfãos do email
 *
 * Uso:
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs <TRANSACTION_ID> [--apply]
 *
 * Exemplos:
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs HP4217962122           # dry-run
 *   node backend/cloudflare/scripts/cleanup-transaction.mjs HP4217962122 --apply   # executa
 */

import { execFileSync, execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../../..");
const wranglerDispatcherCwd = resolve(rootDir, "backend/cloudflare/workers/funnel-dispatcher");

const DEDUPE_KV_BINDING = "DEDUPE_KV";
const EVENT_STORE_DB = "decole-d1-event-store";
const IDENTITY_DB = "decole-d1-identity";
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

function usage() {
  console.log(`
Uso: node backend/cloudflare/scripts/cleanup-transaction.mjs <TRANSACTION_ID> [--apply]

  TRANSACTION_ID   Número de transação Hotmart (ex: HP4217962122)
  --apply          Executa as deleções. Sem este flag roda em dry-run.
`);
}

function d1Query(dbName, sql) {
  const result = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", dbName, "--remote", "--json", "--command", sql],
    { cwd: wranglerDispatcherCwd, encoding: "utf8" }
  );
  const parsed = JSON.parse(result);
  return parsed?.[0]?.results ?? [];
}

function d1Execute(dbName, sql, apply) {
  if (!apply) {
    console.log(`  [dry-run] D1 ${dbName}: ${sql}`);
    return { changes: 0 };
  }
  const result = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", dbName, "--remote", "--json", "--command", sql],
    { cwd: wranglerDispatcherCwd, encoding: "utf8" }
  );
  const parsed = JSON.parse(result);
  return parsed?.[0]?.meta ?? { changes: 0 };
}

function kvDelete(binding, key, apply) {
  if (!apply) {
    console.log(`  [dry-run] KV ${binding}: delete "${key}"`);
    return;
  }
  execFileSync(
    "npx",
    ["wrangler", "kv", "key", "delete", key, `--binding=${binding}`, "--remote"],
    { cwd: wranglerDispatcherCwd, encoding: "utf8", stdio: "pipe" }
  );
}

function psql(sql, apply) {
  if (!apply) {
    console.log(`  [dry-run] Postgres: ${sql}`);
    return [];
  }
  // Passa o SQL via stdin para evitar quaisquer problemas de escaping de aspas
  const result = execFileSync(
    "ssh",
    [
      "-o", "StrictHostKeyChecking=no",
      "-o", "ConnectTimeout=10",
      `root@${VPS_HOST}`,
      `docker exec -i ${VPS_POSTGRES_CONTAINER} psql -U ${VPS_POSTGRES_USER} -d ${VPS_POSTGRES_DB} -t`,
    ],
    { encoding: "utf8", input: sql + "\n" }
  );
  return result
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const transactionId = args.find((a) => !a.startsWith("--"));
  const apply = args.includes("--apply");

  if (!transactionId) {
    usage();
    process.exit(1);
  }

  console.log(`\n=== cleanup-transaction ${transactionId} [${apply ? "APPLY" : "dry-run"}] ===\n`);

  // ── 1. Buscar eventos no D1 event-store ──────────────────────────────────
  console.log("1. Buscando eventos no D1 event-store...");
  const events = d1Query(
    EVENT_STORE_DB,
    `SELECT event_id, event_type, profile_id, occurred_at, payload_json FROM funnel_events WHERE payload_json LIKE '%${transactionId}%'`
  );

  if (events.length === 0) {
    console.log("   Nenhum evento encontrado para esta transação no event-store.");
  } else {
    console.log(`   ${events.length} evento(s) encontrado(s):`);
    for (const e of events) {
      console.log(`   - ${e.event_type} (${e.event_id}) profile=${e.profile_id}`);
    }
  }

  const profileIds = [...new Set(events.map((e) => e.profile_id).filter(Boolean))];
  const eventIds = [...new Set(events.map((e) => e.event_id).filter(Boolean))];

  console.log(`   profile_ids: ${profileIds.join(", ") || "(nenhum)"}`);
  console.log(`   event_ids:   ${eventIds.join(", ") || "(nenhum)"}`);

  // ── 2. Apagar funnel_events por profile_id ───────────────────────────────
  if (profileIds.length > 0) {
    console.log("\n2. Apagando funnel_events do D1 event-store...");
    for (const profileId of profileIds) {
      const meta = d1Execute(
        EVENT_STORE_DB,
        `DELETE FROM funnel_events WHERE profile_id = '${profileId}'`
      );
      console.log(`   profile=${profileId} → ${apply ? `${meta.changes} linhas apagadas` : "dry-run"}`);
    }
  } else {
    console.log("\n2. Nenhum profile_id — pulando deleção de funnel_events.");
  }

  // ── 3. Apagar identity_links por profile_id ──────────────────────────────
  if (profileIds.length > 0) {
    console.log("\n3. Apagando identity_links do D1 identity...");
    for (const profileId of profileIds) {
      const meta = d1Execute(
        IDENTITY_DB,
        `DELETE FROM identity_links WHERE profile_id = '${profileId}'`
      );
      console.log(`   profile=${profileId} → ${apply ? `${meta.changes} linhas apagadas` : "dry-run"}`);
    }
  } else {
    console.log("\n3. Nenhum profile_id — pulando deleção de identity_links.");
  }

  // ── 4. Apagar chaves DEDUPE_KV ───────────────────────────────────────────
  if (eventIds.length > 0) {
    console.log("\n4. Apagando chaves DEDUPE_KV...");
    for (const eventId of eventIds) {
      for (const handler of KNOWN_HANDLERS) {
        const key = `${eventId}:${handler}`;
        try {
          kvDelete(DEDUPE_KV_BINDING, key, apply);
          if (apply) console.log(`   deleted: ${key}`);
        } catch {
          // chave pode não existir — ignorar erro
        }
      }
    }
    if (!apply) console.log(`   [dry-run] ${eventIds.length * KNOWN_HANDLERS.length} chaves seriam apagadas`);
  } else {
    console.log("\n4. Nenhum event_id — pulando deleção de DEDUPE_KV.");
  }

  // ── 5. Apagar tokens associados à transação no Postgres ─────────────────
  console.log("\n5. Operações no Postgres (VPS)...");

  const tokenFilter = `hotmart_transacao = '${transactionId}' AND status IN ('PENDENTE','ERRO')`;

  // Listar tokens candidatos
  const candidateRows = psql(
    `SELECT token, status, hotmart_transacao, criado_at FROM plano_voo_tokens WHERE ${tokenFilter} ORDER BY criado_at`,
    true
  );
  console.log(`   Tokens candidatos: ${candidateRows.length}`);
  candidateRows.forEach((r) => console.log(`   ${r}`));

  if (candidateRows.length === 0) {
    console.log("   Nenhum token PENDENTE/ERRO para esta transação.");
  } else {
    // Apagar resultados órfãos primeiro (FK)
    const deletedResultados = psql(
      `DELETE FROM plano_voo_resultados WHERE token IN (SELECT token FROM plano_voo_tokens WHERE ${tokenFilter}) RETURNING token`,
      apply
    );
    if (apply) console.log(`   plano_voo_resultados apagados: ${deletedResultados.length}`);

    // Apagar tokens
    const deletedTokens = psql(
      `DELETE FROM plano_voo_tokens WHERE ${tokenFilter} RETURNING token, status, criado_at`,
      apply
    );
    if (apply) {
      console.log(`   plano_voo_tokens apagados: ${deletedTokens.length}`);
      deletedTokens.forEach((r) => console.log(`   ${r}`));
    }
  }

  console.log(`\n=== cleanup concluído [${apply ? "APPLY" : "dry-run"}] ===\n`);
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
