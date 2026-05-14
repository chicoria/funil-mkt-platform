export interface TenantCredentialsConfig {
  brevo_api_key_env: string;
  hotmart_token_env: string;
  replyToEmail?: string;
}

export interface TenantProductConfig {
  name: string;
  aliases?: string[];
}

export interface TenantConfig {
  name: string;
  domains: string[];
  credentials: TenantCredentialsConfig;
  products: Record<string, TenantProductConfig>;
}

export interface MultiTenantCatalog {
  tenants: Record<string, TenantConfig>;
}

export interface TenantInfo {
  tenant_id: string;
  name: string;
}

export interface TenantProductInfo {
  tenant_id: string;
  product_code: string;
}

export interface ResolvedCredentials {
  brevoApiKey: string;
  hotmartToken: string;
  replyToEmail?: string;
}

export function resolveTenantFromHostname(hostname: string, catalog: MultiTenantCatalog): TenantInfo {
  const lower = hostname.toLowerCase();
  for (const [id, config] of Object.entries(catalog.tenants)) {
    if (config.domains.some((d) => d.toLowerCase() === lower)) {
      return { tenant_id: id, name: config.name };
    }
  }
  throw new Error(`Unknown hostname: ${hostname}`);
}

export function resolveTenantFromProductCode(productCode: string, catalog: MultiTenantCatalog): TenantProductInfo {
  const upper = productCode.toUpperCase();

  for (const [tenantId, tenantConfig] of Object.entries(catalog.tenants)) {
    for (const [code, product] of Object.entries(tenantConfig.products)) {
      if (code.toUpperCase() === upper) {
        return { tenant_id: tenantId, product_code: code };
      }
      if (product.aliases?.some((a) => a.toUpperCase() === upper)) {
        return { tenant_id: tenantId, product_code: code };
      }
    }
  }

  throw new Error(`Unknown product: ${productCode}`);
}

function requireEnvString(env: Record<string, unknown>, varName: string): string {
  const v = env[varName];
  if (typeof v !== "string" || !v) {
    throw new Error(`Missing env var: ${varName}`);
  }
  return v;
}

export function getCredentials(
  tenantId: string,
  catalog: MultiTenantCatalog,
  env: Record<string, unknown>
): ResolvedCredentials {
  const tenant = catalog.tenants[tenantId];
  if (!tenant) throw new Error(`Unknown tenant: ${tenantId}`);

  const creds = tenant.credentials;
  return {
    brevoApiKey: requireEnvString(env, creds.brevo_api_key_env),
    hotmartToken: requireEnvString(env, creds.hotmart_token_env),
    replyToEmail: creds.replyToEmail,
  };
}
