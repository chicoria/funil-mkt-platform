import type { D1Database } from "@cloudflare/workers-types";
import type { TenantGa4Config } from "./types";

// ── Auth ─────────────────────────────────────────────────────────────────────

function toBase64Url(input: string | Uint8Array): string {
  let b64 = "";
  if (typeof input === "string") {
    b64 = btoa(input);
  } else {
    let binary = "";
    for (let i = 0; i < input.length; i += 1) binary += String.fromCharCode(input[i]);
    b64 = btoa(binary);
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGoogleRateLimited(status: number, body: string): boolean {
  if (status === 429 || status === 503 || status === 502) return true;
  const lower = body.toLowerCase();
  return lower.includes("automated queries") || lower.includes("we're sorry");
}

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit, tries = 4): Promise<Response> {
  let lastRes: Response | null = null;
  let lastBody = "";
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    const res = await fetch(input, init);
    if (res.ok) return res;
    const body = await res.text();
    lastRes = res;
    lastBody = body;
    if (!isGoogleRateLimited(res.status, body) || attempt === tries) {
      return new Response(body, { status: res.status, headers: res.headers });
    }
    const waitMs = Math.min(10_000, 2 ** (attempt - 1) * 1000 + Math.floor(Math.random() * 300));
    console.log(JSON.stringify({ stage: "ga4_retry", attempt, wait_ms: waitMs }));
    await sleep(waitMs);
  }
  return lastRes
    ? new Response(lastBody, { status: lastRes.status, headers: lastRes.headers })
    : new Response("ga4_fetch_unknown_error", { status: 500 });
}

export async function getGa4AccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as { client_email: string; private_key: string };

  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  const signingInput = `${header}.${payload}`;
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${toBase64Url(new Uint8Array(sigBytes))}`;

  const res = await fetchWithRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`GA4 token error: ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

// ── API ──────────────────────────────────────────────────────────────────────

interface Ga4Row {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

export async function fetchGa4Report(
  propertyId: string,
  accessToken: string,
  dateStr: string
): Promise<Ga4Row[]> {
  const res = await fetchWithRetry(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: dateStr, endDate: dateStr }],
        dimensions: [{ name: "eventName" }, { name: "customEvent:produto" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            inListFilter: {
              values: [
                "page_view", "cta_click",
                "section_view", "section_engaged",
                "vsl_section_start", "vsl_section_end",
              ],
            },
          },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`GA4 report error: ${await res.text()}`);
  return (((await res.json()) as { rows?: Ga4Row[] }).rows ?? []);
}

// ── Storage ──────────────────────────────────────────────────────────────────

export async function upsertGa4Metrics(
  db: D1Database,
  tenantId: string,
  dateStr: string,
  rows: Ga4Row[],
  productLookup: Record<string, string>
): Promise<void> {
  const fetchedAt = new Date().toISOString();

  for (const row of rows) {
    const eventName = row.dimensionValues[0].value;
    const rawProduct = (row.dimensionValues[1].value ?? "").toLowerCase();
    const productCode = productLookup[rawProduct] ?? rawProduct.toUpperCase();
    const eventCount = parseInt(row.metricValues[0].value, 10);

    if (!productCode || !eventName) continue;

    await db
      .prepare(
        `INSERT INTO ga4_daily_metrics (tenant_id, date, product_code, event_name, event_count, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, date, product_code, event_name)
         DO UPDATE SET event_count = excluded.event_count, fetched_at = excluded.fetched_at`
      )
      .bind(tenantId, dateStr, productCode, eventName, eventCount, fetchedAt)
      .run();
  }
}

// ── Orchestration helper ─────────────────────────────────────────────────────

export async function syncTenantGa4(
  db: D1Database,
  config: TenantGa4Config,
  dateStr: string,
  productLookup: Record<string, string>
): Promise<void> {
  const token = await getGa4AccessToken(config.serviceAccountKey);
  const rows = await fetchGa4Report(config.propertyId, token, dateStr);
  await upsertGa4Metrics(db, config.tenantId, dateStr, rows, productLookup);
}
