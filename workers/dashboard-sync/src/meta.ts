import type { D1Database } from "@cloudflare/workers-types";
import type { ProductMetaConfig } from "./types";

// ── API ──────────────────────────────────────────────────────────────────────

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

export async function fetchMetaInsights(
  adAccountId: string,
  accessToken: string,
  dateStr: string
): Promise<MetaInsight | null> {
  const params = new URLSearchParams({
    fields: ["spend", "impressions", "cpm", "cpc", "ctr", "actions", "cost_per_action_type"].join(","),
    time_range: JSON.stringify({ since: dateStr, until: dateStr }),
    time_increment: "1",
    access_token: accessToken,
  });

  const res = await fetch(`https://graph.facebook.com/v21.0/${adAccountId}/insights?${params}`);
  if (!res.ok) throw new Error(`Meta insights error: ${await res.text()}`);

  const data = (await res.json()) as { data?: MetaInsight[] };
  return data.data?.[0] ?? null;
}

// ── Data extraction ──────────────────────────────────────────────────────────

interface MetaMetrics {
  spend: number;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  leads: number;
  cpm: number;
  cpc: number;
  ctr: number;
  costPerLead: number;
}

export function extractMetaMetrics(insight: MetaInsight): MetaMetrics {
  return {
    spend: parseFloat(insight.spend ?? "0") || 0,
    impressions: parseInt(insight.impressions ?? "0", 10) || 0,
    linkClicks: extractAction(insight.actions, "link_click"),
    landingPageViews: extractAction(insight.actions, "landing_page_view"),
    leads: extractAction(insight.actions, "lead"),
    cpm: parseFloat(insight.cpm ?? "0") || 0,
    cpc: parseFloat(insight.cpc ?? "0") || 0,
    ctr: parseFloat(insight.ctr ?? "0") || 0,
    costPerLead: extractAction(insight.cost_per_action_type, "lead"),
  };
}

// ── Storage ──────────────────────────────────────────────────────────────────

export async function upsertMetaMetrics(
  db: D1Database,
  tenantId: string,
  productCode: string,
  dateStr: string,
  metrics: MetaMetrics
): Promise<void> {
  const fetchedAt = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO meta_daily_metrics
         (tenant_id, date, product_code, spend, impressions, link_clicks,
          landing_page_views, leads, cpm, cpc, ctr, cost_per_lead, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, date, product_code)
       DO UPDATE SET
         spend = excluded.spend, impressions = excluded.impressions,
         link_clicks = excluded.link_clicks, landing_page_views = excluded.landing_page_views,
         leads = excluded.leads, cpm = excluded.cpm, cpc = excluded.cpc,
         ctr = excluded.ctr, cost_per_lead = excluded.cost_per_lead, fetched_at = excluded.fetched_at`
    )
    .bind(
      tenantId, dateStr, productCode,
      metrics.spend, metrics.impressions, metrics.linkClicks,
      metrics.landingPageViews, metrics.leads,
      metrics.cpm, metrics.cpc, metrics.ctr, metrics.costPerLead,
      fetchedAt
    )
    .run();
}

// ── Orchestration helper ─────────────────────────────────────────────────────

export async function syncTenantProductMeta(
  db: D1Database,
  config: ProductMetaConfig,
  dateStr: string
): Promise<void> {
  const insight = await fetchMetaInsights(config.adAccountId, config.accessToken, dateStr);
  if (!insight) return;
  const metrics = extractMetaMetrics(insight);
  await upsertMetaMetrics(db, config.tenantId, config.productCode, dateStr, metrics);
}
