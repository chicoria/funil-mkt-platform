import type { D1Database } from "@cloudflare/workers-types";

// ── Catalog shape (subset needed by dashboard-sync) ─────────────────────────

export interface TenantDashboardCatalog {
  tenants: Record<string, {
    dashboard?: {
      ga4?: { propertyIdEnv: string; serviceAccountKeyEnv: string };
      metaAds?: { accessTokenEnv: string };
    };
    products?: Record<string, {
      dashboard?: {
        metaAds?: { adAccountIdEnv: string };
      };
    }>;
  }>;
}

// ── Resolved configs (what catalog.ts produces) ──────────────────────────────

export interface TenantGa4Config {
  tenantId: string;
  propertyId: string;
  serviceAccountKey: string;
}

export interface ProductMetaConfig {
  tenantId: string;
  productCode: string;
  accessToken: string;
  adAccountId: string;
}

// ── Sync result ──────────────────────────────────────────────────────────────

export interface SyncResult {
  ga4Ok: boolean;
  metaOk: boolean;
  errors: string[];
}

export type SyncPart = "all" | "ga4" | "meta";

// ── Env ──────────────────────────────────────────────────────────────────────

export interface DashboardSyncEnv {
  EVENT_STORE_DB: D1Database;
  SYNC_SECRET: string;
  // Remaining fields are dynamic Secrets Store bindings (resolved via catalog env var names)
  [key: string]: unknown;
}

// ── D1 run record ────────────────────────────────────────────────────────────

export interface SyncRunRow {
  run_id: string;
  date: string;
  part: SyncPart;
  status: "running" | "ok" | "error";
  started_at: string;
  finished_at: string | null;
  error: string | null;
}
