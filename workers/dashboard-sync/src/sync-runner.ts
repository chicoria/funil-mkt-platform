import type { D1Database } from "@cloudflare/workers-types";
import type { TenantDashboardCatalog, DashboardSyncEnv, SyncResult, SyncPart } from "./types";
import {
  resolveTenantGa4Config,
  resolveProductMetaConfig,
  buildProductLookup,
  listTenantsWithGa4,
  listProductsWithMeta,
} from "./catalog";
import { syncTenantGa4 } from "./ga4";
import { syncTenantProductMeta } from "./meta";

function normalizeSyncError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("automated queries") || lower.includes("we're sorry")) {
    return "GA4 temporarily blocked by Google anti-automation. Retry in a few minutes.";
  }
  if (lower.includes("<html")) return "External provider returned HTML error page";
  return raw.slice(0, 600);
}

// Returns the tenant IDs to sync, filtered by the optional tenantFilter.
// Throws a descriptive error if tenantFilter names a tenant not in the catalog.
export function resolveTenantList(
  catalog: TenantDashboardCatalog,
  tenantFilter: string | undefined
): string[] {
  const allTenants = Object.keys(catalog.tenants);
  if (!tenantFilter) return allTenants;

  if (!allTenants.includes(tenantFilter)) {
    throw new Error(`tenant_not_found:${tenantFilter}`);
  }
  return [tenantFilter];
}

// Runs GA4 + Meta sync for all tenants (or a filtered subset), collecting
// per-tenant errors without aborting the run for other tenants.
export async function runSync(
  db: D1Database,
  catalog: TenantDashboardCatalog,
  env: DashboardSyncEnv,
  dateStr: string,
  part: SyncPart,
  tenantFilter?: string
): Promise<SyncResult> {
  console.log(JSON.stringify({ stage: "sync_start", date: dateStr, part, tenant_filter: tenantFilter ?? "all" }));

  const tenants = resolveTenantList(catalog, tenantFilter);
  const productLookup = buildProductLookup(catalog);
  const errors: string[] = [];
  let ga4Ok = part === "meta";
  let metaOk = part === "ga4";

  for (const tenantId of tenants) {
    if (part === "all" || part === "ga4") {
      const config = resolveTenantGa4Config(catalog, env as Record<string, unknown>, tenantId);
      if (!config) {
        console.log(JSON.stringify({ stage: "ga4_skip", tenant: tenantId, reason: "no_config" }));
      } else {
        try {
          await syncTenantGa4(db, config, dateStr, productLookup);
          console.log(JSON.stringify({ stage: "ga4_done", tenant: tenantId }));
          ga4Ok = true;
        } catch (err) {
          const msg = normalizeSyncError(err instanceof Error ? err.message : String(err));
          errors.push(`ga4:${tenantId}:${msg}`);
          console.log(JSON.stringify({ stage: "ga4_error", tenant: tenantId, error: msg }));
        }
      }
    }

    if (part === "all" || part === "meta") {
      const products = listProductsWithMeta(catalog, tenantId);
      for (const productCode of products) {
        const config = resolveProductMetaConfig(catalog, env as Record<string, unknown>, tenantId, productCode);
        if (!config) {
          console.log(JSON.stringify({ stage: "meta_skip", tenant: tenantId, product: productCode, reason: "no_config" }));
          continue;
        }
        try {
          await syncTenantProductMeta(db, config, dateStr);
          console.log(JSON.stringify({ stage: "meta_done", tenant: tenantId, product: productCode }));
          metaOk = true;
        } catch (err) {
          const msg = normalizeSyncError(err instanceof Error ? err.message : String(err));
          errors.push(`meta:${tenantId}:${productCode}:${msg}`);
          console.log(JSON.stringify({ stage: "meta_error", tenant: tenantId, product: productCode, error: msg }));
        }
      }
    }
  }

  return { ga4Ok, metaOk, errors };
}
