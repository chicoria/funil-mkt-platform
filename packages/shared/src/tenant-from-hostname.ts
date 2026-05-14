export interface TenantHostnameCatalog {
  tenants?: Record<string, { domains?: string[] }>;
}

export function resolveTenantIdFromHostname(
  hostname: string,
  catalog: TenantHostnameCatalog,
  fallback = "decole"
): string {
  const lower = hostname.toLowerCase();
  for (const [tenantId, tenant] of Object.entries(catalog.tenants || {})) {
    if (tenant.domains?.some((d) => d.toLowerCase() === lower)) return tenantId;
  }
  return fallback;
}
