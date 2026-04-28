#!/usr/bin/env node

export async function step(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    return { step: name, status: "pass", detail: String(detail ?? "ok"), elapsed_ms: Date.now() - start };
  } catch (err) {
    return { step: name, status: "fail", detail: err.message, elapsed_ms: Date.now() - start };
  }
}

export function skipStep(name, reason = "skipped") {
  return { step: name, status: "skip", detail: reason, elapsed_ms: 0 };
}

export function assertEqual(a, b, msg = "") {
  if (a !== b) throw new Error(`${msg ? msg + ": " : ""}expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

export function assertContains(obj, keys) {
  const missing = keys.filter((k) => obj[k] === undefined || obj[k] === null || obj[k] === "");
  if (missing.length > 0) throw new Error(`missing_fields: ${missing.join(", ")} in ${JSON.stringify(obj)}`);
}

export function assertPayloadJson(row, checks) {
  if (!row) throw new Error("row_is_null");
  let payload = {};
  try {
    payload = JSON.parse(row.payload_json || "{}");
  } catch {
    throw new Error("invalid_payload_json");
  }
  for (const [key, expected] of Object.entries(checks)) {
    const actual = payload[key];
    if (expected === true) {
      if (actual === undefined || actual === null || actual === "") {
        throw new Error(`payload_json.${key} expected truthy, got ${JSON.stringify(actual)}`);
      }
    } else if (expected === false) {
      if (actual !== undefined && actual !== null && actual !== "") {
        throw new Error(`payload_json.${key} expected absent/falsy, got ${JSON.stringify(actual)}`);
      }
    } else {
      if (actual !== expected) {
        throw new Error(`payload_json.${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }
  }
  return payload;
}

export function printResult(result) {
  const icon = result.status === "pass" ? "✓" : result.status === "skip" ? "·" : "✗";
  const color = result.status === "pass" ? "\x1b[32m" : result.status === "skip" ? "\x1b[33m" : "\x1b[31m";
  const reset = "\x1b[0m";
  console.log(`  ${color}${icon}${reset} ${result.step.padEnd(30)} ${result.detail}`);
}

export function printSummary(scenarioResult) {
  const total = scenarioResult.steps.length;
  const passed = scenarioResult.steps.filter((s) => s.status === "pass").length;
  const failed = scenarioResult.steps.filter((s) => s.status === "fail").length;
  const skipped = scenarioResult.steps.filter((s) => s.status === "skip").length;
  const icon = scenarioResult.status === "pass" ? "✓" : "✗";
  const color = scenarioResult.status === "pass" ? "\x1b[32m" : "\x1b[31m";
  const reset = "\x1b[0m";
  console.log(
    `\n${color}${icon} ${scenarioResult.scenario}${reset} — ` +
    `${passed}/${total} passed, ${failed} failed, ${skipped} skipped (${scenarioResult.elapsed_ms}ms)`
  );
}
