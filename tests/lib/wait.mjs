#!/usr/bin/env node

export async function poll(fn, opts = {}) {
  const { timeout = 60000, interval = 3000, description = "condition" } = opts;
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result !== null && result !== undefined && result !== false) return result;
    } catch (err) {
      lastError = err;
    }
    await sleep(interval);
  }
  const msg = lastError ? lastError.message : "returned falsy";
  throw new Error(`poll_timeout[${description}]: ${msg}`);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
