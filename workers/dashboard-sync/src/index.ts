import type { D1Database } from "@cloudflare/workers-types";

interface Env {
  EVENT_STORE_DB: D1Database;
  GA4_SERVICE_ACCOUNT_KEY: string;
  GA4_PROPERTY_ID: string;
  META_ACCESS_TOKEN: string;
  META_AD_ACCOUNT_ID_ESG: string;
  META_AD_ACCOUNT_ID_PLANOVOO: string;
  SYNC_SECRET: string;
}

type SyncPart = "all" | "ga4" | "meta";

interface SyncRunRow {
  run_id: string;
  date: string;
  part: SyncPart;
  status: "running" | "ok" | "error";
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

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

async function fetchGoogleWithRetry(input: RequestInfo | URL, init: RequestInit, tries = 4): Promise<Response> {
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

    // jittered exponential backoff: 1s, 2s, 4s...
    const waitMs = Math.min(10_000, (2 ** (attempt - 1)) * 1000 + Math.floor(Math.random() * 300));
    console.log(`[dashboard-sync] google_retry attempt=${attempt} wait_ms=${waitMs}`);
    await sleep(waitMs);
  }

  if (lastRes) {
    return new Response(lastBody, { status: lastRes.status, headers: lastRes.headers });
  }
  return new Response("google_fetch_unknown_error", { status: 500 });
}

// ──────────────────────────────────────────────────────────
// GA4 helpers
// ──────────────────────────────────────────────────────────

async function getGa4AccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as {
    client_email: string;
    private_key: string;
  };

  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );

  const signingInput = `${header}.${payload}`;

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sig = toBase64Url(new Uint8Array(sigBytes));
  const jwt = `${signingInput}.${sig}`;

  const res = await fetchGoogleWithRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) throw new Error(`GA4 token error: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

interface Ga4Row {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

async function syncGa4(db: D1Database, env: Env, dateStr: string): Promise<void> {
  const token = await getGa4AccessToken(env.GA4_SERVICE_ACCOUNT_KEY);

  const body = {
    dateRanges: [{ startDate: dateStr, endDate: dateStr }],
    dimensions: [{ name: "eventName" }, { name: "customEvent:produto" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        inListFilter: {
          values: ["page_view", "cta_click", "button_click"],
        },
      },
    },
  };

  const res = await fetchGoogleWithRetry(
    `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) throw new Error(`GA4 report error: ${await res.text()}`);

  const data = (await res.json()) as { rows?: Ga4Row[] };
  const rows = data.rows ?? [];
  const fetched_at = new Date().toISOString();

  const productMap: Record<string, string> = {
    esg: "DECOLE_ESG_MENTORIA",
    planovoo: "DECOLE_PLANOVOO",
    decole_esg_mentoria: "DECOLE_ESG_MENTORIA",
    decole_planovoo: "DECOLE_PLANOVOO",
  };

  for (const row of rows) {
    const event_name = row.dimensionValues[0].value;
    const rawProduct = (row.dimensionValues[1].value ?? "").toLowerCase();
    const product_code = productMap[rawProduct] ?? rawProduct.toUpperCase();
    const event_count = parseInt(row.metricValues[0].value, 10);

    if (!product_code || !event_name) continue;

    await db
      .prepare(
        `INSERT INTO ga4_daily_metrics (date, product_code, event_name, event_count, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(date, product_code, event_name)
         DO UPDATE SET event_count = excluded.event_count, fetched_at = excluded.fetched_at`
      )
      .bind(dateStr, product_code, event_name, event_count, fetched_at)
      .run();
  }
}

// ──────────────────────────────────────────────────────────
// Meta helpers
// ──────────────────────────────────────────────────────────

type MetaAction = { action_type: string; value: string };

interface MetaInsight {
  spend?: string;
  impressions?: string;
  cpm?: string;
  cpc?: string;
  ctr?: string;
  actions?: MetaAction[];
  cost_per_action_type?: MetaAction[];
}

function extractAction(actions: MetaAction[] | undefined, type: string): number {
  return parseFloat(actions?.find((a) => a.action_type === type)?.value ?? "0") || 0;
}

async function syncMeta(
  db: D1Database,
  token: string,
  adAccountId: string,
  productCode: string,
  dateStr: string
): Promise<void> {
  const fields = [
    "spend",
    "impressions",
    "cpm",
    "cpc",
    "ctr",
    "actions",
    "cost_per_action_type",
  ].join(",");

  const params = new URLSearchParams({
    fields,
    time_range: JSON.stringify({ since: dateStr, until: dateStr }),
    time_increment: "1",
    access_token: token,
  });

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${adAccountId}/insights?${params}`
  );

  if (!res.ok) throw new Error(`Meta insights error (${productCode}): ${await res.text()}`);

  const data = (await res.json()) as { data?: MetaInsight[] };
  const insight = data.data?.[0];
  if (!insight) return;

  const spend = parseFloat(insight.spend ?? "0") || 0;
  const impressions = parseInt(insight.impressions ?? "0", 10) || 0;
  const link_clicks = extractAction(insight.actions, "link_click");
  const landing_page_views = extractAction(insight.actions, "landing_page_view");
  const leads = extractAction(insight.actions, "lead");
  const cpm = parseFloat(insight.cpm ?? "0") || 0;
  const cpc = parseFloat(insight.cpc ?? "0") || 0;
  const ctr = parseFloat(insight.ctr ?? "0") || 0;
  const cost_per_lead = extractAction(insight.cost_per_action_type, "lead");
  const fetched_at = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO meta_daily_metrics
         (date, product_code, spend, impressions, link_clicks, landing_page_views,
          leads, cpm, cpc, ctr, cost_per_lead, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date, product_code)
       DO UPDATE SET
         spend = excluded.spend,
         impressions = excluded.impressions,
         link_clicks = excluded.link_clicks,
         landing_page_views = excluded.landing_page_views,
         leads = excluded.leads,
         cpm = excluded.cpm,
         cpc = excluded.cpc,
         ctr = excluded.ctr,
         cost_per_lead = excluded.cost_per_lead,
         fetched_at = excluded.fetched_at`
    )
    .bind(
      dateStr, productCode, spend, impressions, link_clicks,
      landing_page_views, leads, cpm, cpc, ctr, cost_per_lead, fetched_at
    )
    .run();
}

// ──────────────────────────────────────────────────────────
// Core sync logic (shared by cron + manual trigger)
// ──────────────────────────────────────────────────────────

async function runSync(env: Env, dateStr: string, part: SyncPart): Promise<void> {
  console.log(`[dashboard-sync] date=${dateStr} part=${part}`);

  if (part === "all" || part === "ga4") {
    await syncGa4(env.EVENT_STORE_DB, env, dateStr);
    console.log("[dashboard-sync] GA4 done");
  }

  if (part === "all" || part === "meta") {
    await syncMeta(
      env.EVENT_STORE_DB,
      env.META_ACCESS_TOKEN,
      env.META_AD_ACCOUNT_ID_ESG,
      "DECOLE_ESG_MENTORIA",
      dateStr
    );
    await syncMeta(
      env.EVENT_STORE_DB,
      env.META_ACCESS_TOKEN,
      env.META_AD_ACCOUNT_ID_PLANOVOO,
      "DECOLE_PLANOVOO",
      dateStr
    );
    console.log("[dashboard-sync] Meta done");
  }
}

async function ensureSyncControlSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS dashboard_sync_runs (
         run_id TEXT PRIMARY KEY,
         date TEXT NOT NULL,
         part TEXT NOT NULL,
         status TEXT NOT NULL,
         started_at TEXT NOT NULL,
         finished_at TEXT,
         error TEXT
       )`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS dashboard_sync_control (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`
    )
    .run();
}

function asJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resolveDateStr(input: string | null): string {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function resolveSyncPart(input: string | null): SyncPart {
  const raw = (input || "all").toLowerCase();
  if (raw === "ga4" || raw === "meta" || raw === "all") return raw;
  return "all";
}

function isAuthorized(request: Request, env: Env, url: URL): boolean {
  // Backward compatibility: GET /sync?secret=...
  if (url.searchParams.get("secret") === env.SYNC_SECRET) return true;

  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ") && auth.slice(7) === env.SYNC_SECRET) return true;
  if ((request.headers.get("x-sync-secret") || "") === env.SYNC_SECRET) return true;
  return false;
}

async function tryAcquireLock(db: D1Database): Promise<boolean> {
  const now = new Date().toISOString();
  // soft lock: refreshed on start and released on finish.
  const result = await db
    .prepare(
      `INSERT INTO dashboard_sync_control (key, value, updated_at)
       VALUES ('sync_lock', '1', ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at
       WHERE dashboard_sync_control.value != '1'`
    )
    .bind(now)
    .run();
  return Number(result.meta?.changes || 0) > 0;
}

async function releaseLock(db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO dashboard_sync_control (key, value, updated_at)
       VALUES ('sync_lock', '0', ?)
       ON CONFLICT(key) DO UPDATE SET value = '0', updated_at = excluded.updated_at`
    )
    .bind(now)
    .run();
}

async function saveRunStart(db: D1Database, runId: string, date: string, part: SyncPart): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dashboard_sync_runs (run_id, date, part, status, started_at, finished_at, error)
       VALUES (?, ?, ?, 'running', ?, NULL, NULL)`
    )
    .bind(runId, date, part, new Date().toISOString())
    .run();
}

async function saveRunFinish(db: D1Database, runId: string, ok: boolean, error: string | null): Promise<void> {
  await db
    .prepare(
      `UPDATE dashboard_sync_runs
       SET status = ?, finished_at = ?, error = ?
       WHERE run_id = ?`
    )
    .bind(ok ? "ok" : "error", new Date().toISOString(), error, runId)
    .run();
}

async function getLatestRun(db: D1Database): Promise<SyncRunRow | null> {
  const row = await db
    .prepare(
      `SELECT run_id, date, part, status, started_at, finished_at, error
       FROM dashboard_sync_runs
       ORDER BY started_at DESC
       LIMIT 1`
    )
    .first<SyncRunRow>();
  return row || null;
}

// ──────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────

export default {
  // Cron: runs daily at 4h UTC — syncs yesterday's data
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await ensureSyncControlSchema(env.EVENT_STORE_DB);
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    ctx.waitUntil(runSync(env, yesterday.toISOString().slice(0, 10), "all"));
  },

  // HTTP: manual trigger — GET /sync?date=YYYY-MM-DD&secret=...
  // Useful for backfilling a specific date or testing
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    await ensureSyncControlSchema(env.EVENT_STORE_DB);

    if (url.pathname === "/sync/status") {
      if (!isAuthorized(request, env, url)) return new Response("Unauthorized", { status: 401 });
      return asJson({ ok: true, latest: await getLatestRun(env.EVENT_STORE_DB) });
    }

    if (url.pathname !== "/sync" && url.pathname !== "/sync/run") {
      return new Response("decole-dashboard-sync worker", { status: 200 });
    }

    if (!isAuthorized(request, env, url)) {
      return new Response("Unauthorized", { status: 401 });
    }

    let dateStr = resolveDateStr(url.searchParams.get("date"));
    let part = resolveSyncPart(url.searchParams.get("part"));
    if (request.method === "POST") {
      try {
        const body = (await request.json()) as { date?: string; part?: string };
        if (body.part) part = resolveSyncPart(body.part);
        if (body.date) dateStr = resolveDateStr(body.date);
      } catch {
        // keep query/default values if body is missing or invalid JSON
      }
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const lock = await tryAcquireLock(env.EVENT_STORE_DB);
    if (!lock) {
      const latest = await getLatestRun(env.EVENT_STORE_DB);
      return asJson(
        { ok: false, error: "sync_already_running", latest },
        409
      );
    }

    const runId = `sync-${Date.now()}`;

    try {
      await saveRunStart(env.EVENT_STORE_DB, runId, dateStr, part);
      await runSync(env, dateStr, part);
      await saveRunFinish(env.EVENT_STORE_DB, runId, true, null);
      await releaseLock(env.EVENT_STORE_DB);
      return asJson({ ok: true, run_id: runId, date: dateStr, part });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await saveRunFinish(env.EVENT_STORE_DB, runId, false, msg);
      await releaseLock(env.EVENT_STORE_DB);
      return asJson({ ok: false, run_id: runId, date: dateStr, part, error: msg }, 500);
    }
  },
};
