import type { FunnelEvent } from "../../../packages/shared/src/funnel-event";
import { resolveCatalogProduct, type ParsedCatalog } from "./catalog-adapter";

export const DEFAULT_TENANT_ID = "decole";

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function resolveEventTenantId(event: FunnelEvent, catalog: ParsedCatalog): string {
  return resolveCatalogProduct(catalog, event)?.tenant_id || asString(event.tenant_id) || DEFAULT_TENANT_ID;
}

export function tenantScopedKey(tenantId: string, suffix: string): string {
  const normalizedTenant = asString(tenantId) || DEFAULT_TENANT_ID;
  const normalizedSuffix = asString(suffix);
  if (!normalizedSuffix) return normalizedTenant;
  if (normalizedSuffix.startsWith(`${normalizedTenant}:`)) return normalizedSuffix;
  return `${normalizedTenant}:${normalizedSuffix}`;
}
