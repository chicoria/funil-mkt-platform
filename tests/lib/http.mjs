#!/usr/bin/env node

export async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  let responseBody = "";
  try {
    responseBody = await response.text();
  } catch { /* ignore */ }
  let parsed = null;
  try {
    parsed = JSON.parse(responseBody);
  } catch { /* ignore */ }
  return { status: response.status, headers: response.headers, body: parsed ?? responseBody };
}

export async function getUrl(url, params = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, v);
  }
  const response = await fetch(u.toString(), { redirect: "manual" });
  const location = response.headers.get("location") || "";
  return { status: response.status, location, headers: response.headers };
}

export function assertStatus(response, expected, context = "") {
  if (response.status !== expected) {
    throw new Error(
      `assert_status_failed${context ? `[${context}]` : ""}: expected=${expected} got=${response.status} body=${JSON.stringify(response.body ?? "")}`
    );
  }
}
