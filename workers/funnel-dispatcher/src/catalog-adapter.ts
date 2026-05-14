import type { FunnelEvent } from "../../../packages/shared/src/funnel-event";

export interface CatalogEventConfig {
  eventType?: string;
  id?: string;
  chain?: string[];
  [key: string]: unknown;
}

export interface CatalogProductConfig {
  aliases?: string[];
  funnelEventArchitecture?: { events?: CatalogEventConfig[] };
  [key: string]: unknown;
}

export interface CatalogTenantConfig {
  name?: string;
  domains?: string[];
  credentials?: Record<string, unknown>;
  products?: Record<string, CatalogProductConfig>;
}

export interface ParsedCatalog {
  products?: Record<string, CatalogProductConfig>;
  tenants?: Record<string, CatalogTenantConfig>;
}

export interface CatalogProductSelector {
  product_code: string;
  tenant_id?: string;
}

export interface ResolvedCatalogProduct {
  tenant_id?: string;
  product_code: string;
  product: CatalogProductConfig;
  source: "products" | "tenants";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseCatalog(raw: string | undefined): ParsedCatalog {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) return parsed as ParsedCatalog;
  } catch {
    return {};
  }
  return {};
}

export function isConfiguredCatalog(catalog: ParsedCatalog): boolean {
  return Boolean(
    catalog.products ||
    (catalog.tenants && Object.keys(catalog.tenants).length > 0)
  );
}

function matchProduct(
  products: Record<string, CatalogProductConfig> | undefined,
  productCode: string
): { product_code: string; product: CatalogProductConfig } | undefined {
  if (!products) return undefined;

  const direct = products[productCode];
  if (direct) return { product_code: productCode, product: direct };

  const normalizedProductCode = productCode.toUpperCase();
  const matched = Object.entries(products).find(([, product]) =>
    (product.aliases || []).some((alias) => alias.toUpperCase() === normalizedProductCode)
  );

  if (!matched) return undefined;
  return { product_code: matched[0], product: matched[1] };
}

export function resolveCatalogProduct(
  catalog: ParsedCatalog,
  selector: CatalogProductSelector
): ResolvedCatalogProduct | undefined {
  const productCode = asString(selector.product_code);
  if (!productCode) return undefined;

  const tenantId = asString(selector.tenant_id);
  if (tenantId && catalog.tenants) {
    const tenant = catalog.tenants?.[tenantId];
    const matchedTenantProduct = matchProduct(tenant?.products, productCode);
    if (matchedTenantProduct) {
      return {
        tenant_id: tenantId,
        source: "tenants",
        ...matchedTenantProduct,
      };
    }
    return undefined;
  }

  const matchedLegacyProduct = matchProduct(catalog.products, productCode);
  if (matchedLegacyProduct) {
    return {
      source: "products",
      ...matchedLegacyProduct,
    };
  }

  for (const [candidateTenantId, tenant] of Object.entries(catalog.tenants || {})) {
    const matchedTenantProduct = matchProduct(tenant.products, productCode);
    if (matchedTenantProduct) {
      return {
        tenant_id: candidateTenantId,
        source: "tenants",
        ...matchedTenantProduct,
      };
    }
  }

  return undefined;
}

export function resolveCatalogEvent(
  catalog: ParsedCatalog,
  selector: CatalogProductSelector,
  eventType: string
): CatalogEventConfig | null {
  const product = resolveCatalogProduct(catalog, selector)?.product;
  const target = eventType.toUpperCase();
  const events = product?.funnelEventArchitecture?.events || [];

  return (
    events.find((entry) => {
      const candidate = asString(entry.eventType || entry.id).toUpperCase();
      return candidate === target;
    }) || null
  );
}

export function eventCatalogSelector(event: FunnelEvent): CatalogProductSelector {
  return {
    product_code: event.product_code,
    tenant_id: event.tenant_id,
  };
}
