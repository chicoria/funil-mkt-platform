#!/usr/bin/env node
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function usage() {
  console.log(`Usage:
  node verify-ga4-realtime.mjs --event-name <name> --event-id <id> [options]

Options:
  --property-id <id>                 GA4_PROPERTY_ID. Default: env GA4_PROPERTY_ID
  --credentials <path>               Service account JSON. Default: env GOOGLE_APPLICATION_CREDENTIALS
  --event-id-dimension <name>        Default: customEvent:event_id
  --timeout-seconds <n>              Default: 180
  --poll-seconds <n>                 Default: 10
  --require-event-id-dimension       Fail if dimension is unavailable
`);
}

function parseArgs(argv) {
  const args = {
    eventName: "",
    eventId: "",
    propertyId: process.env.GA4_PROPERTY_ID || "",
    credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
    eventIdDimension: process.env.GA4_EVENT_ID_DIMENSION || "customEvent:event_id",
    timeoutSeconds: 180,
    pollSeconds: 10,
    requireEventIdDimension: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--event-name") args.eventName = mustValue(argv, ++i, "--event-name");
    else if (arg === "--event-id") args.eventId = mustValue(argv, ++i, "--event-id");
    else if (arg === "--property-id") args.propertyId = mustValue(argv, ++i, "--property-id");
    else if (arg === "--credentials") args.credentials = resolve(mustValue(argv, ++i, "--credentials"));
    else if (arg === "--event-id-dimension") args.eventIdDimension = mustValue(argv, ++i, "--event-id-dimension");
    else if (arg === "--timeout-seconds") args.timeoutSeconds = Number(mustValue(argv, ++i, "--timeout-seconds"));
    else if (arg === "--poll-seconds") args.pollSeconds = Number(mustValue(argv, ++i, "--poll-seconds"));
    else if (arg === "--require-event-id-dimension") args.requireEventIdDimension = true;
    else throw new Error(`unknown_arg:${arg}`);
  }

  if (!args.help) {
    if (!args.eventName) throw new Error("missing_event_name");
    if (!args.eventId) throw new Error("missing_event_id");
    if (!args.propertyId) throw new Error("missing_property_id");
    if (!args.credentials) throw new Error("missing_credentials");
    if (!Number.isInteger(args.timeoutSeconds) || args.timeoutSeconds < 10) throw new Error("invalid_timeout");
    if (!Number.isInteger(args.pollSeconds) || args.pollSeconds < 2) throw new Error("invalid_poll");
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
  return String(token.access_token || "");
}

async function runRealtimeReport({ propertyId, accessToken, body }) {
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runRealtimeReport`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || JSON.stringify(data).slice(0, 300);
    throw new Error(`ga4_api_error:${response.status}:${msg}`);
  }
  return data;
}

function countRows(report) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  return rows.reduce((sum, row) => {
    const value = Number(row?.metricValues?.[0]?.value || "0");
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

function isUnknownDimensionError(error) {
  const msg = String(error?.message || "");
  return msg.includes("Unknown dimension") || msg.includes("is not a valid dimension");
}

async function pollUntil(timeoutSeconds, pollSeconds, fn) {
  const end = Date.now() + timeoutSeconds * 1000;
  let last = null;
  while (Date.now() <= end) {
    last = await fn();
    if (last?.ok) return last;
    await new Promise((r) => setTimeout(r, pollSeconds * 1000));
  }
  return last || { ok: false, reason: "timeout" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const accessToken = await fetchAccessToken(args.credentials, "https://www.googleapis.com/auth/analytics.readonly");
  const baseMetric = [{ name: "eventCount" }];
  const minuteRanges = [{ startMinutesAgo: 29, endMinutesAgo: 0 }];

  let idDimensionSupported = true;
  let idDimensionError = "";

  const result = await pollUntil(args.timeoutSeconds, args.pollSeconds, async () => {
    if (idDimensionSupported) {
      try {
        const strictReport = await runRealtimeReport({
          propertyId: args.propertyId,
          accessToken,
          body: {
            dimensions: [{ name: "eventName" }, { name: args.eventIdDimension }],
            metrics: baseMetric,
            minuteRanges,
            dimensionFilter: {
              andGroup: {
                expressions: [
                  { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: args.eventName } } },
                  { filter: { fieldName: args.eventIdDimension, stringFilter: { matchType: "EXACT", value: args.eventId } } },
                ],
              },
            },
            limit: "10",
          },
        });
        const strictCount = countRows(strictReport);
        if (strictCount > 0) {
          return { ok: true, mode: "event_id_dimension", count: strictCount };
        }
      } catch (error) {
        if (isUnknownDimensionError(error)) {
          idDimensionSupported = false;
          idDimensionError = String(error.message);
          if (args.requireEventIdDimension) {
            throw new Error(`ga4_event_id_dimension_required:${idDimensionError}`);
          }
        } else {
          throw error;
        }
      }
    }

    const fallbackReport = await runRealtimeReport({
      propertyId: args.propertyId,
      accessToken,
      body: {
        dimensions: [{ name: "eventName" }],
        metrics: baseMetric,
        minuteRanges,
        dimensionFilter: {
          filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: args.eventName } },
        },
        limit: "10",
      },
    });
    const fallbackCount = countRows(fallbackReport);
    if (fallbackCount > 0) {
      return {
        ok: true,
        mode: "event_name_only",
        count: fallbackCount,
        warning: idDimensionSupported ? "" : "event_id_dimension_unavailable",
        detail: idDimensionError,
      };
    }
    return { ok: false, reason: "event_not_visible_yet" };
  });

  if (!result?.ok) {
    console.log(JSON.stringify({ ok: false, stage: "ga4_realtime", reason: result?.reason || "not_found" }));
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      ok: true,
      stage: "ga4_realtime",
      mode: result.mode,
      count: result.count,
      ...(result.warning ? { warning: result.warning } : {}),
      ...(result.detail ? { detail: result.detail } : {}),
    })
  );
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, stage: "ga4_realtime", error: String(error.message || error) }));
  process.exit(1);
});
