#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { ROOT_DIR, DEFAULT_ENV_FILE, DEFAULT_WRANGLER_CWD } from "./config.mjs";

const REPLAY_SCRIPT = resolve(ROOT_DIR, "scripts/replay-emit-tracking.mjs");

export async function replayApply(eventId, opts = {}) {
  const { metaTestEventCode = "", envFile = DEFAULT_ENV_FILE, wranglerCwd = DEFAULT_WRANGLER_CWD, dbName = "decole-d1-event-store" } = opts;

  const args = [REPLAY_SCRIPT, "--event-id", eventId, "--apply", "--db", dbName, "--env-file", envFile, "--wrangler-cwd", wranglerCwd];
  if (metaTestEventCode) args.push("--meta-test-event-code", metaTestEventCode);

  let raw = "";
  try {
    raw = execFileSync("node", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    throw new Error(`replay_failed: ${err.stderr || err.message}`);
  }

  // Parse JSONL output — last line with event_id is the event row
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let eventRow = null;
  let modeRow = null;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.event_id) eventRow = obj;
      if (obj.mode !== undefined) modeRow = obj;
    } catch { /* skip */ }
  }

  if (!eventRow) throw new Error(`replay_no_event_row: raw=${raw.slice(0, 400)}`);

  return {
    event_id: eventRow.event_id,
    event_type: eventRow.event_type,
    product_code: eventRow.product_code,
    planned: eventRow.planned || {},
    sent: eventRow.sent || [],
    meta_test_event_code_applied: Boolean(eventRow.meta_test_event_code_applied),
    mode: modeRow?.mode ?? "apply",
  };
}

export async function replayDryRun(eventId, opts = {}) {
  const { envFile = DEFAULT_ENV_FILE, wranglerCwd = DEFAULT_WRANGLER_CWD, dbName = "decole-d1-event-store" } = opts;
  const args = [REPLAY_SCRIPT, "--event-id", eventId, "--db", dbName, "--env-file", envFile, "--wrangler-cwd", wranglerCwd];

  let raw = "";
  try {
    raw = execFileSync("node", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    throw new Error(`replay_dry_run_failed: ${err.stderr || err.message}`);
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  let eventRow = null;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.event_id) eventRow = obj;
    } catch { /* skip */ }
  }

  if (!eventRow) throw new Error(`replay_dry_run_no_event_row: raw=${raw.slice(0, 400)}`);
  return eventRow;
}
