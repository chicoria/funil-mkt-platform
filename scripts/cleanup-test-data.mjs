#!/usr/bin/env node
/**
 * cleanup-test-data.mjs
 *
 * Apaga todos os dados de teste/seed dos bancos D1 e Postgres.
 *
 * Padrões reconhecidos como teste:
 *   D1 funnel_events   — event_id LIKE 'e2e-%' | 'codex-%' | 'load-%' | 'test-%'
 *   D1 identity_links  — anonymous_id LIKE 'e2e-%' | 'codex-%' | 'load-%' | 'test-%'
 *   Postgres tokens    — token LIKE 'load-%' | 'e2e-%'
 *   Postgres candidatos — email LIKE '%-test.local' | 'e2e-%'
 *
 * Uso:
 *   node backend/cloudflare/scripts/cleanup-test-data.mjs           # dry-run
 *   node backend/cloudflare/scripts/cleanup-test-data.mjs --apply   # executa
 */

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../../..");
const wranglerCwd = resolve(rootDir, "backend/cloudflare/workers/funnel-dispatcher");

const EVENT_STORE_DB = "decole-d1-event-store";
const IDENTITY_DB = "decole-d1-identity";
const VPS_HOST = "45.55.244.11";
const VPS_POSTGRES_CONTAINER = "n8n-docker-caddy-postgres-1";
const VPS_POSTGRES_USER = "decole";
const VPS_POSTGRES_DB = "decole";

const TEST_PREFIXES_SQL = `event_id LIKE 'e2e-%' OR event_id LIKE 'codex-%' OR event_id LIKE 'load-%' OR event_id LIKE 'test-%'`;
const TEST_ANON_SQL     = `anonymous_id LIKE 'e2e-%' OR anonymous_id LIKE 'codex-%' OR anonymous_id LIKE 'load-%' OR anonymous_id LIKE 'test-%'`;

// ─── helpers ────────────────────────────────────────────────────────────────

function d1Query(dbName, sql) {
  const out = execFileSync(
    "npx", ["wrangler", "d1", "execute", dbName, "--remote", "--json", "--command", sql],
    { cwd: wranglerCwd, encoding: "utf8" }
  );
  return JSON.parse(out)?.[0]?.results ?? [];
}

function d1Execute(dbName, sql, apply) {
  if (!apply) {
    console.log(`  [dry-run] D1 ${dbName}:\n    ${sql}`);
    return { changes: 0 };
  }
  const out = execFileSync(
    "npx", ["wrangler", "d1", "execute", dbName, "--remote", "--json", "--command", sql],
    { cwd: wranglerCwd, encoding: "utf8" }
  );
  return JSON.parse(out)?.[0]?.meta ?? { changes: 0 };
}

function psql(sql, apply) {
  if (!apply) {
    console.log(`  [dry-run] Postgres:\n    ${sql}`);
    return [];
  }
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
  const apply = process.argv.includes("--apply");
  console.log(`\n=== cleanup-test-data [${apply ? "APPLY" : "dry-run"}] ===\n`);

  // ── 1. Contar / apagar funnel_events de teste ────────────────────────────
  console.log("1. D1 event-store — funnel_events de teste...");
  const countEvents = d1Query(EVENT_STORE_DB,
    `SELECT count(*) AS total FROM funnel_events WHERE ${TEST_PREFIXES_SQL}`
  );
  const totalEvents = countEvents[0]?.total ?? 0;
  console.log(`   Encontrados: ${totalEvents} eventos`);

  if (totalEvents > 0) {
    const meta = d1Execute(EVENT_STORE_DB,
      `DELETE FROM funnel_events WHERE ${TEST_PREFIXES_SQL}`,
      apply
    );
    if (apply) console.log(`   Apagados: ${meta.changes}`);
  }

  // ── 2. Contar / apagar identity_links de teste ───────────────────────────
  console.log("\n2. D1 identity — identity_links de teste...");
  const countLinks = d1Query(IDENTITY_DB,
    `SELECT count(*) AS total FROM identity_links WHERE ${TEST_ANON_SQL}`
  );
  const totalLinks = countLinks[0]?.total ?? 0;
  console.log(`   Encontrados: ${totalLinks} registros`);

  if (totalLinks > 0) {
    const meta = d1Execute(IDENTITY_DB,
      `DELETE FROM identity_links WHERE ${TEST_ANON_SQL}`,
      apply
    );
    if (apply) console.log(`   Apagados: ${meta.changes}`);
  }

  // ── 3. Postgres — plano_voo_resultados de teste (FK primeiro) ────────────
  console.log("\n3. Postgres — plano_voo_resultados de teste...");
  const resultadosRows = psql(
    `SELECT count(*) FROM plano_voo_resultados WHERE token LIKE 'load-%' OR token LIKE 'e2e-%'`,
    true
  );
  const totalResultados = parseInt(resultadosRows[0] ?? "0");
  console.log(`   Encontrados: ${totalResultados} resultados`);

  if (totalResultados > 0) {
    psql(
      `DELETE FROM plano_voo_resultados WHERE token LIKE 'load-%' OR token LIKE 'e2e-%'`,
      apply
    );
    if (apply) console.log(`   Apagados: ${totalResultados}`);
  }

  // ── 4. Postgres — plano_voo_tokens de teste ──────────────────────────────
  console.log("\n4. Postgres — plano_voo_tokens de teste...");
  const tokenRows = psql(
    `SELECT count(*) FROM plano_voo_tokens WHERE token LIKE 'load-%' OR token LIKE 'e2e-%'`,
    true
  );
  const totalTokens = parseInt(tokenRows[0] ?? "0");
  console.log(`   Encontrados: ${totalTokens} tokens`);

  if (totalTokens > 0) {
    psql(
      `DELETE FROM plano_voo_tokens WHERE token LIKE 'load-%' OR token LIKE 'e2e-%'`,
      apply
    );
    if (apply) console.log(`   Apagados: ${totalTokens}`);
  }

  // ── 5. Postgres — candidatos de teste ────────────────────────────────────
  console.log("\n5. Postgres — candidatos de teste...");
  const candRows = psql(
    `SELECT count(*) FROM candidatos WHERE email LIKE '%-test.local' OR email LIKE 'e2e-%'`,
    true
  );
  const totalCandidatos = parseInt(candRows[0] ?? "0");
  console.log(`   Encontrados: ${totalCandidatos} candidatos`);

  if (totalCandidatos > 0) {
    psql(
      `DELETE FROM candidatos WHERE email LIKE '%-test.local' OR email LIKE 'e2e-%'`,
      apply
    );
    if (apply) console.log(`   Apagados: ${totalCandidatos}`);
  }

  // ── Resumo ────────────────────────────────────────────────────────────────
  console.log(`\n─── Resumo ───────────────────────────────────────`);
  console.log(`   funnel_events (D1):      ${totalEvents}`);
  console.log(`   identity_links (D1):     ${totalLinks}`);
  console.log(`   plano_voo_resultados:    ${totalResultados}`);
  console.log(`   plano_voo_tokens:        ${totalTokens}`);
  console.log(`   candidatos:              ${totalCandidatos}`);
  console.log(`\n=== cleanup concluído [${apply ? "APPLY" : "dry-run"}] ===\n`);
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
