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

// ──────────────────────────────────────────────────────────
// GA4 helpers
// ──────────────────────────────────────────────────────────

async function getGa4AccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as {
    client_email: string;
    private_key: string;
  };

  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(
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

  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  const jwt = `${signingInput}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
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

  const res = await fetch(
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

async function runSync(env: Env, dateStr: string): Promise<void> {
  console.log(`[dashboard-sync] date=${dateStr}`);

  await syncGa4(env.EVENT_STORE_DB, env, dateStr);
  console.log("[dashboard-sync] GA4 done");

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

// ──────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────

export default {
  // Cron: runs daily at 4h UTC — syncs yesterday's data
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    ctx.waitUntil(runSync(env, yesterday.toISOString().slice(0, 10)));
  },

  // HTTP: manual trigger — GET /sync?date=YYYY-MM-DD&secret=...
  // Useful for backfilling a specific date or testing
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/sync") {
      return new Response("decole-dashboard-sync worker", { status: 200 });
    }

    if (url.searchParams.get("secret") !== env.SYNC_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const dateStr =
      url.searchParams.get("date") ??
      (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })();

    try {
      await runSync(env, dateStr);
      return new Response(JSON.stringify({ ok: true, date: dateStr }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ ok: false, error: msg }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
