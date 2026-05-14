#!/usr/bin/env node
/**
 * cleanup-test-data.mjs
 *
 * Apaga todos os dados de teste/seed dos bancos D1 e Postgres.
 *
 * Padrões reconhecidos como teste:
 *
 *   D1 funnel_events — event_id:
 *     'e2e-%' | 'codex-%' | 'load-%' | 'test-%' | 'begin_checkout:%'
 *   D1 funnel_events — payload_json:
 *     '%@example.com%' | '%-test.local%'
 *
 *   D1 identity_links — profile_id:
 *     IN (profile_ids dos funnel_events de teste)  ← cruzamento entre bases
 *   D1 identity_links — anonymous_id:
 *     'e2e-%' | 'anon-e2e-%' | 'codex-%' | 'load-%' | 'test-%'
 *
 *   Postgres tokens    — token LIKE 'load-%' | 'e2e-%'
 *   Postgres candidatos — email LIKE '%-test.local' | '%@example.com' | 'e2e-%'
 *
 *   Brevo contacts     — email LIKE '%@example.com' | 'e2e.%' | '%-test.local'
 *                        (obtidos via paginação da API Brevo)
 *
 * Uso:
 *   node scripts/cleanup-test-data.mjs           # dry-run
 *   node scripts/cleanup-test-data.mjs --apply   # executa
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
const wranglerCwd = resolve(rootDir, "workers/funnel-dispatcher");

const EVENT_STORE_DB = "decole-d1-event-store";
const IDENTITY_DB = "decole-d1-identity";
const BREVO_BASE_URL = "https://api.brevo.com/v3";

function getBrevoApiKey() {
  // Lê do .env.local na raiz do repo (nunca hardcoded)
  try {
    const envPath = resolve(rootDir, ".env.local");
    const env = readFileSync(envPath, "utf8");
    const match = env.match(/^BREVO_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch { /* sem .env.local — usa variável de ambiente */ }
  return process.env.BREVO_API_KEY ?? "";
}

async function brevoFetch(path, options = {}) {
  const apiKey = getBrevoApiKey();
  if (!apiKey) throw new Error("BREVO_API_KEY não encontrada em .env.local nem em variáveis de ambiente");
  const res = await fetch(`${BREVO_BASE_URL}${path}`, {
    ...options,
    headers: { "api-key": apiKey, "content-type": "application/json", ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo API ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function brevoGetTestContacts() {
  const testContacts = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const data = await brevoFetch(`/contacts?limit=${limit}&offset=${offset}&sort=desc`);
    const contacts = data?.contacts ?? [];
    for (const c of contacts) {
      const email = c.email ?? "";
      if (!email) continue;
      if (
        email.endsWith("@example.com") ||
        email.startsWith("e2e.") ||
        email.includes("-test.local")
      ) {
        testContacts.push({ id: c.id, email });
      }
    }
    if (contacts.length < limit) break;
    offset += limit;
  }
  return testContacts;
}
const VPS_HOST = "45.55.244.11";
const VPS_POSTGRES_CONTAINER = "n8n-docker-caddy-postgres-1";
const VPS_POSTGRES_USER = "decole";
const VPS_POSTGRES_DB = "decole";

// KV: padrões de chaves de teste
const isTestDedupeKey = (key) =>
  key.includes("e2e") || key.includes("codex") || key.startsWith("begin_checkout:");

const isTestIdentityKey = (key) =>
  key.includes("e2e") || key.includes("codex") || key.includes("example.com");

// funnel_events: event_id prefix + payload_json content
const TEST_EVENTS_SQL = `
  event_id LIKE 'e2e-%'
  OR event_id LIKE 'codex-%'
  OR event_id LIKE 'load-%'
  OR event_id LIKE 'test-%'
  OR event_id LIKE 'begin_checkout:%'
  OR payload_json LIKE '%@example.com%'
  OR payload_json LIKE '%-test.local%'
`.trim().replace(/\n\s+/g, " ");

// identity_links: anonymous_id contendo e2e (qualquer posição) ou outros prefixos de teste
const TEST_ANON_SQL = `
  anonymous_id LIKE '%e2e%'
  OR anonymous_id LIKE 'codex-%'
  OR anonymous_id LIKE 'load-%'
  OR anonymous_id LIKE 'test-%'
`.trim().replace(/\n\s+/g, " ");

// ─── helpers ────────────────────────────────────────────────────────────────

function kvListAll(binding) {
  const out = execFileSync(
    "npx", ["wrangler", "kv", "key", "list", `--binding=${binding}`, "--remote"],
    { cwd: wranglerCwd, encoding: "utf8" }
  );
  return JSON.parse(out).map((k) => k.name);
}

function kvBulkDelete(binding, keys, apply) {
  if (keys.length === 0) return 0;
  if (!apply) {
    console.log(`  [dry-run] KV ${binding}: apagaria ${keys.length} chaves`);
    return 0;
  }
  const tmpFile = `/tmp/kv-cleanup-${binding}-${Date.now()}.json`;
  writeFileSync(tmpFile, JSON.stringify(keys));
  try {
    execFileSync(
      "npx", ["wrangler", "kv", "bulk", "delete", `--binding=${binding}`, "--remote", tmpFile],
      { cwd: wranglerCwd, encoding: "utf8", stdio: "pipe" }
    );
  } finally {
    unlinkSync(tmpFile);
  }
  return keys.length;
}

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

  // ── 0a. KV DEDUPE_KV ──────────────────────────────────────────────────────
  console.log("0a. KV DEDUPE_KV — chaves de teste...");
  const allDedupeKeys = kvListAll("DEDUPE_KV");
  const testDedupeKeys = allDedupeKeys.filter(isTestDedupeKey);
  console.log(`   Total: ${allDedupeKeys.length} — Teste: ${testDedupeKeys.length}`);
  if (testDedupeKeys.length > 0) {
    const deleted = kvBulkDelete("DEDUPE_KV", testDedupeKeys, apply);
    if (apply) console.log(`   Apagadas: ${deleted}`);
  }

  // ── 0b. KV IDENTITY_KV ────────────────────────────────────────────────────
  console.log("\n0b. KV IDENTITY_KV — chaves de teste...");
  const allIdentityKeys = kvListAll("IDENTITY_KV");
  const testIdentityKeys = allIdentityKeys.filter(isTestIdentityKey);
  console.log(`   Total: ${allIdentityKeys.length} — Teste: ${testIdentityKeys.length}`);
  if (testIdentityKeys.length > 0) {
    const deleted = kvBulkDelete("IDENTITY_KV", testIdentityKeys, apply);
    if (apply) console.log(`   Apagadas: ${deleted}`);
  }

  // ── 1. Contar / apagar funnel_events de teste ────────────────────────────
  console.log("1. D1 event-store — funnel_events de teste...");

  // Preview dos padrões encontrados
  const previewEvents = d1Query(EVENT_STORE_DB, `
    SELECT
      SUM(CASE WHEN event_id LIKE 'e2e-%' OR event_id LIKE 'codex-%' OR event_id LIKE 'load-%' OR event_id LIKE 'test-%' THEN 1 ELSE 0 END) AS por_event_id_prefix,
      SUM(CASE WHEN event_id LIKE 'begin_checkout:%' THEN 1 ELSE 0 END) AS por_begin_checkout,
      SUM(CASE WHEN payload_json LIKE '%@example.com%' THEN 1 ELSE 0 END) AS por_example_com,
      SUM(CASE WHEN payload_json LIKE '%-test.local%' THEN 1 ELSE 0 END) AS por_test_local,
      COUNT(*) AS total_combinado
    FROM funnel_events WHERE ${TEST_EVENTS_SQL}
  `);
  const p = previewEvents[0] ?? {};
  const totalEvents = p.total_combinado ?? 0;
  console.log(`   Encontrados: ${totalEvents} eventos`);
  if (totalEvents > 0) {
    console.log(`   ├─ event_id prefix (e2e/codex/load/test): ${p.por_event_id_prefix}`);
    console.log(`   ├─ event_id begin_checkout:*:             ${p.por_begin_checkout}`);
    console.log(`   ├─ payload @example.com:                  ${p.por_example_com}`);
    console.log(`   └─ payload -test.local:                   ${p.por_test_local}`);
  }

  // Recolher profile_ids de teste ANTES de apagar (para limpar identity_links)
  const testProfileRows = d1Query(EVENT_STORE_DB, `
    SELECT DISTINCT profile_id FROM funnel_events
    WHERE (${TEST_EVENTS_SQL}) AND profile_id IS NOT NULL
  `);
  const testProfileIds = testProfileRows.map((r) => r.profile_id).filter(Boolean);
  console.log(`   Profile IDs de teste associados: ${testProfileIds.length}`);

  if (totalEvents > 0) {
    const meta = d1Execute(EVENT_STORE_DB,
      `DELETE FROM funnel_events WHERE ${TEST_EVENTS_SQL}`,
      apply
    );
    if (apply) console.log(`   Apagados: ${meta.changes}`);
  }

  // ── 2. Contar / apagar identity_links de teste ───────────────────────────
  console.log("\n2. D1 identity — identity_links de teste...");

  // Critério A: anonymous_id com prefix de teste
  const countByAnon = d1Query(IDENTITY_DB,
    `SELECT count(*) AS total FROM identity_links WHERE ${TEST_ANON_SQL}`
  );
  const totalByAnon = countByAnon[0]?.total ?? 0;

  // Critério B: profile_id cruzado com funnel_events de teste (cross-DB manual)
  let totalByProfile = 0;
  let profileIdFilter = "";
  if (testProfileIds.length > 0) {
    const ids = testProfileIds.map((id) => `'${id}'`).join(",");
    profileIdFilter = `profile_id IN (${ids})`;
    const countByProfile = d1Query(IDENTITY_DB,
      `SELECT count(*) AS total FROM identity_links WHERE ${profileIdFilter}`
    );
    totalByProfile = countByProfile[0]?.total ?? 0;
  }

  const totalLinks = totalByAnon + totalByProfile;
  console.log(`   Encontrados: ${totalLinks} registros`);
  console.log(`   ├─ por anonymous_id prefix: ${totalByAnon}`);
  console.log(`   └─ por profile_id de evento de teste: ${totalByProfile}`);

  if (totalByAnon > 0) {
    const meta = d1Execute(IDENTITY_DB,
      `DELETE FROM identity_links WHERE ${TEST_ANON_SQL}`,
      apply
    );
    if (apply) console.log(`   Apagados por anon_id: ${meta.changes}`);
  }
  if (totalByProfile > 0 && profileIdFilter) {
    const meta = d1Execute(IDENTITY_DB,
      `DELETE FROM identity_links WHERE ${profileIdFilter}`,
      apply
    );
    if (apply) console.log(`   Apagados por profile_id: ${meta.changes}`);
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
    `SELECT count(*) FROM candidatos WHERE email LIKE '%-test.local' OR email LIKE 'e2e-%' OR email LIKE '%@example.com'`,
    true
  );
  const totalCandidatos = parseInt(candRows[0] ?? "0");
  console.log(`   Encontrados: ${totalCandidatos} candidatos`);

  if (totalCandidatos > 0) {
    psql(
      `DELETE FROM candidatos WHERE email LIKE '%-test.local' OR email LIKE 'e2e-%' OR email LIKE '%@example.com'`,
      apply
    );
    if (apply) console.log(`   Apagados: ${totalCandidatos}`);
  }

  // ── 6. Brevo — contactos de teste ────────────────────────────────────────
  console.log("\n6. Brevo — contactos de teste...");
  const brevoTestContacts = await brevoGetTestContacts();
  console.log(`   Encontrados: ${brevoTestContacts.length} contacto(s)`);
  brevoTestContacts.forEach((c) => console.log(`   ${c.email} (id=${c.id})`));

  let totalBrevo = 0;
  if (brevoTestContacts.length > 0) {
    if (!apply) {
      console.log(`  [dry-run] DELETE /contacts/{email} × ${brevoTestContacts.length}`);
    } else {
      for (const c of brevoTestContacts) {
        await brevoFetch(`/contacts/${encodeURIComponent(c.email)}`, { method: "DELETE" });
        console.log(`   ✓ apagado: ${c.email}`);
        totalBrevo++;
      }
    }
  }

  // ── Resumo ────────────────────────────────────────────────────────────────
  console.log(`\n─── Resumo ───────────────────────────────────────`);
  console.log(`   DEDUPE_KV:               ${testDedupeKeys.length}`);
  console.log(`   IDENTITY_KV:             ${testIdentityKeys.length}`);
  console.log(`   funnel_events (D1):      ${totalEvents}`);
  console.log(`   identity_links (D1):     ${totalLinks}`);
  console.log(`   plano_voo_resultados:    ${totalResultados}`);
  console.log(`   plano_voo_tokens:        ${totalTokens}`);
  console.log(`   candidatos:              ${totalCandidatos}`);
  console.log(`   brevo contactos:         ${apply ? totalBrevo : brevoTestContacts.length}`);
  console.log(`\n=== cleanup concluído [${apply ? "APPLY" : "dry-run"}] ===\n`);
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
