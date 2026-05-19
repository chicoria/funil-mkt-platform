import type { FunnelEvent } from "../../../packages/shared/src/funnel-event";
import { resolveCatalogProduct, type ParsedCatalog } from "./catalog-adapter";

const FALLBACK_TENANT_ID = "unknown";

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function inferTenantFromProductCode(productCode: string): string {
  const normalized = asString(productCode).toLowerCase();
  if (!normalized) return "";
  const [tenant] = normalized.split("_");
  return asString(tenant);
}

export function resolveEventTenantId(event: FunnelEvent, catalog: ParsedCatalog): string {
  const resolved = resolveCatalogProduct(catalog, event);
  return (
    asString(event.tenant_id) ||
    asString(resolved?.tenant_id) ||
    inferTenantFromProductCode(asString(resolved?.product_code) || asString(event.product_code)) ||
    FALLBACK_TENANT_ID
  );
}

export function tenantScopedKey(tenantId: string, suffix: string): string {
  const normalizedTenant = asString(tenantId) || FALLBACK_TENANT_ID;
  const normalizedSuffix = asString(suffix);
  if (!normalizedSuffix) return normalizedTenant;
  if (normalizedSuffix.startsWith(`${normalizedTenant}:`)) return normalizedSuffix;
  return `${normalizedTenant}:${normalizedSuffix}`;
}
