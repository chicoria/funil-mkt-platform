import type { TenantDashboardCatalog, TenantGa4Config, ProductMetaConfig } from "./types";

// Reads a string value from the Env map. Handles plain strings (worker secrets,
// test mocks) and gracefully returns "" for missing or non-string bindings.
function readEnvString(env: Record<string, unknown>, key: string): string {
  const val = env[key];
  return typeof val === "string" ? val.trim() : "";
}

// Returns GA4 credentials for a tenant, or null if the tenant has no GA4 config
// or if the required env vars are missing.
export function resolveTenantGa4Config(
  catalog: TenantDashboardCatalog,
  env: Record<string, unknown>,
  tenantId: string
): TenantGa4Config | null {
  const ga4 = catalog.tenants[tenantId]?.dashboard?.ga4;
  if (!ga4) return null;

  const propertyId = readEnvString(env, ga4.propertyIdEnv);
  const serviceAccountKey = readEnvString(env, ga4.serviceAccountKeyEnv);
  if (!propertyId || !serviceAccountKey) return null;

  return { tenantId, propertyId, serviceAccountKey };
}

// Returns Meta credentials for a tenant+product pair, or null if either the
// tenant-level token or the product-level ad account is not configured.
export function resolveProductMetaConfig(
  catalog: TenantDashboardCatalog,
  env: Record<string, unknown>,
  tenantId: string,
  productCode: string
): ProductMetaConfig | null {
  const tenantMetaAds = catalog.tenants[tenantId]?.dashboard?.metaAds;
  const productMetaAds = catalog.tenants[tenantId]?.products?.[productCode]?.dashboard?.metaAds;
  if (!tenantMetaAds || !productMetaAds) return null;

  const accessToken = readEnvString(env, tenantMetaAds.accessTokenEnv);
  const adAccountId = readEnvString(env, productMetaAds.adAccountIdEnv);
  if (!accessToken || !adAccountId) return null;

  return { tenantId, productCode, accessToken, adAccountId };
}

// Builds a case-insensitive reverse lookup from raw GA4 dimension values to
// canonical product codes. GA4 may return the product code in any casing.
export function buildProductLookup(
  catalog: TenantDashboardCatalog
): Record<string, string> {
  const lookup: Record<string, string> = {};
  for (const tenant of Object.values(catalog.tenants)) {
    for (const [productCode] of Object.entries(tenant.products ?? {})) {
      lookup[productCode.toLowerCase()] = productCode;
    }
  }
  return lookup;
}

// Returns the tenant IDs that have a GA4 dashboard config defined.
export function listTenantsWithGa4(catalog: TenantDashboardCatalog): string[] {
  return Object.entries(catalog.tenants)
    .filter(([, tenant]) => !!tenant.dashboard?.ga4)
    .map(([id]) => id);
}

// Returns the product codes for a tenant that have a Meta Ads dashboard config.
export function listProductsWithMeta(
  catalog: TenantDashboardCatalog,
  tenantId: string
): string[] {
  const products = catalog.tenants[tenantId]?.products ?? {};
  return Object.entries(products)
    .filter(([, product]) => !!product.dashboard?.metaAds)
    .map(([code]) => code);
}
