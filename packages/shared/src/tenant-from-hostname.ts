export interface TenantHostnameCatalog {
  tenants?: Record<string, { domains?: string[] }>;
}

export function tryResolveTenantIdFromHostname(
  hostname: string,
  catalog: TenantHostnameCatalog
): string | undefined {
  const lower = hostname.toLowerCase();
  for (const [tenantId, tenant] of Object.entries(catalog.tenants || {})) {
    if (tenant.domains?.some((d) => d.toLowerCase() === lower)) return tenantId;
  }
  return undefined;
}

export function resolveTenantIdFromHostname(
  hostname: string,
  catalog: TenantHostnameCatalog,
  fallback = "decole"
): string {
  return tryResolveTenantIdFromHostname(hostname, catalog) ?? fallback;
}
