#!/usr/bin/env node
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function usage() {
  console.log(`Usage:
  node verify-sgtm-meta-delivery.mjs --event-id <id> [options]

Options:
  --project-id <id>           GCP project id (default: env SGTM_GCP_PROJECT_ID or service account project_id)
  --service <name>            Cloud Run service (default: env SGTM_CLOUD_RUN_SERVICE or server-side-tagging)
  --credentials <path>        Service account JSON (default: env GOOGLE_APPLICATION_CREDENTIALS)
  --lookback-minutes <n>      Default: 20
`);
}

function parseArgs(argv) {
  const args = {
    eventId: "",
    projectId: process.env.SGTM_GCP_PROJECT_ID || "",
    service: process.env.SGTM_CLOUD_RUN_SERVICE || "server-side-tagging,server-side-tagging-preview",
    credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
    lookbackMinutes: 20,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--event-id") args.eventId = mustValue(argv, ++i, "--event-id");
    else if (arg === "--project-id") args.projectId = mustValue(argv, ++i, "--project-id");
    else if (arg === "--service") args.service = mustValue(argv, ++i, "--service");
    else if (arg === "--credentials") args.credentials = resolve(mustValue(argv, ++i, "--credentials"));
    else if (arg === "--lookback-minutes") args.lookbackMinutes = Number(mustValue(argv, ++i, "--lookback-minutes"));
    else throw new Error(`unknown_arg:${arg}`);
  }

  if (!args.help) {
    if (!args.eventId) throw new Error("missing_event_id");
    if (!args.credentials) throw new Error("missing_credentials");
    if (!Number.isInteger(args.lookbackMinutes) || args.lookbackMinutes < 1) throw new Error("invalid_lookback");
  }
  return args;
}

function mustValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`missing_value:${flag}`);
  return value;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

async function fetchAccessToken(credentialsPath, scope) {
  const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: credentials.client_email,
    scope,
    aud: credentials.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(credentials.private_key, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch(credentials.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`oauth_error:${response.status}:${text.slice(0, 300)}`);
  }
  const token = await response.json();
  return { accessToken: String(token.access_token || ""), credentials };
}

function stringFromEntry(entry) {
  const candidates = [];
  if (entry.textPayload) candidates.push(String(entry.textPayload));
  if (entry.jsonPayload && typeof entry.jsonPayload === "object") candidates.push(JSON.stringify(entry.jsonPayload));
  if (entry.protoPayload && typeof entry.protoPayload === "object") candidates.push(JSON.stringify(entry.protoPayload));
  return candidates.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const { accessToken, credentials } = await fetchAccessToken(args.credentials, "https://www.googleapis.com/auth/logging.read");
  const projectId = args.projectId || String(credentials.project_id || "");
  if (!projectId) throw new Error("missing_project_id");

  const since = new Date(Date.now() - args.lookbackMinutes * 60_000).toISOString();
  const services = args.service
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const serviceFilter =
    services.length === 0
      ? ""
      : `(${services.map((svc) => `resource.labels.service_name="${svc}"`).join(" OR ")})`;

  const filter = [
    'resource.type="cloud_run_revision"',
    serviceFilter,
    `timestamp>="${since}"`,
  ].join(" AND ");

  const response = await fetch("https://logging.googleapis.com/v2/entries:list", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      resourceNames: [`projects/${projectId}`],
      filter,
      orderBy: "timestamp desc",
      pageSize: 200,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || JSON.stringify(data).slice(0, 300);
    throw new Error(`logging_api_error:${response.status}:${msg}`);
  }

  const entries = Array.isArray(data.entries) ? data.entries : [];
  let hasEventId = false;
  let hasMetaHint = false;
  let hasMetaDeliveryHint = false;

  for (const entry of entries) {
    const text = stringFromEntry(entry);
    if (!text) continue;
    if (text.includes(args.eventId)) hasEventId = true;
    if (text.includes("facebook.com") || text.includes("graph.facebook.com") || text.includes("meta")) hasMetaHint = true;
    if (text.includes("events_received") || text.includes("\"200\"") || text.includes("status\":200")) hasMetaDeliveryHint = true;
  }

  const ok = hasEventId && hasMetaHint;
  console.log(
    JSON.stringify({
      ok,
      stage: "meta_delivery_logs",
      project_id: projectId,
      service: args.service,
      lookback_minutes: args.lookbackMinutes,
      entries_scanned: entries.length,
      has_event_id: hasEventId,
      has_meta_hint: hasMetaHint,
      has_meta_delivery_hint: hasMetaDeliveryHint,
    })
  );

  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, stage: "meta_delivery_logs", error: String(error.message || error) }));
  process.exit(1);
});
