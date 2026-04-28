#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { DEFAULT_WRANGLER_CWD } from "./config.mjs";

export function d1Query(dbName, sql, wranglerCwd = DEFAULT_WRANGLER_CWD) {
  let raw = "";
  try {
    raw = execFileSync("npx", ["wrangler", "d1", "execute", dbName, "--remote", "--command", sql], {
      cwd: wranglerCwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new Error(`d1_query_failed: ${err.message}`);
  }
  const lines = raw.split(/\r?\n/);
  const jsonStart = lines.findIndex((l) => l.trim().startsWith("["));
  const json = jsonStart >= 0 ? lines.slice(jsonStart).join("\n").trim() : "";
  if (!json) return [];
  const parsed = JSON.parse(json);
  return parsed.flatMap((entry) => entry.results || []);
}

export async function waitForRow(dbName, sql, check, opts = {}) {
  const { timeout = 60000, poll = 3000, wranglerCwd = DEFAULT_WRANGLER_CWD, description = "row" } = opts;
  const deadline = Date.now() + timeout;
  let lastRows = [];
  while (Date.now() < deadline) {
    lastRows = d1Query(dbName, sql, wranglerCwd);
    const found = lastRows.find(check);
    if (found) return found;
    await sleep(poll);
  }
  throw new Error(`timeout_waiting_for_${description}: last_rows=${JSON.stringify(lastRows)}`);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sqlEscape(value) {
  return String(value).replaceAll("'", "''");
}
