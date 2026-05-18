/**
 * Catálogo v5 — Interfaces TypeScript e helpers de leitura.
 *
 * Estratégia: **aditivo** — campos v4 permanecem no catálogo e nas interfaces.
 * Helpers lêem campos novos (v5) e retornam `undefined` quando ausentes,
 * permitindo fallback explícito nos callers durante a janela de coexistência.
 *
 * Ver: plans/PLANO-MULTI-TENANT-SECRETS-CONFIG.md (seção 4 — schema v5)
 * Ver: plans/slices/2.11A/1-catalog-v5-additive.md
 */

// ─── interfaces v5 ────────────────────────────────────────────────────────────

export interface CatalogV5TenantTracking {
  gtm?: { containerPublicId?: string };
  sgtm?: { endpointEnvVar?: string };
  ga4?: { measurementId?: string; measurementIdEnvVar?: string; apiSecretEnvVar?: string };
  metaCapi?: { accessTokenEnv?: string };
}

export interface CatalogV5AppWebhook {
  path: string;
  productCode: string;
  requiresHmac?: boolean;
}

export interface CatalogV5Integration {
  webhookUrlEnv?: string;
  disableForwardEnv?: string;
  baseUrlEnv?: string;
  hookSecretEnv?: string;
  scope?: string[];
  appWebhooks?: CatalogV5AppWebhook[];
  // Note: no index signature — all expected fields are declared above.
  // Add new fields explicitly to preserve TypeScript's ability to catch typos.
}

export interface CatalogV5TenantDashboard {
  ga4?: { propertyIdEnv?: string; serviceAccountKeyEnv?: string };
  metaAds?: { accessTokenEnv?: string };
}

export interface CatalogV5LinksRoute {
  path: string;
  type: string;
  productCode: string;
  legacy?: boolean;
  deprecated?: boolean;
}

export interface CatalogV5LinksContact {
  type: string;
  number?: string;
  numberEnv?: string;
  defaultText?: string;
}

export interface CatalogV5TenantLinks {
  linksDomain?: string;
  routes?: CatalogV5LinksRoute[];
  contacts?: Record<string, CatalogV5LinksContact>;
}

/** Tracking por produto (v4 + v5): sgtm/ga4 ficam em produto no v4 e sobem para tenant no v5 */
export interface CatalogV5ProductTracking {
  sgtm?: { endpointEnvVar?: string };
  gtm?: { containerPublicId?: string };
  ga4?: { measurementId?: string; measurementIdEnvVar?: string; apiSecretEnvVar?: string };
  metaPixel?: { pixelIdEnvVar?: string; pixelId?: string };
  differentiation?: Record<string, string>;
  [key: string]: unknown;
}

export interface CatalogV5ProductHotmart {
  productId?: string;
  productName?: string;
  checkoutCode?: string;
  defaultOfferCode?: string;
  urlSlugs?: string[];               // v5 novo — substitui switch hardcoded em api-hotmart-ingress
  [key: string]: unknown;
}

export interface CatalogV5ProductDashboard {
  metaAds?: { adAccountIdEnv?: string };
}

/**
 * Links v5 declarados em `tenants.{id}.products.{code}.links`.
 * Distintos dos campos v4 legados (`checkoutPath`, `checkoutOfferPathTemplate`)
 * que existem em `tenants.{id}.products.{code}.links` no catálogo real mas
 * não são declarados aqui por serem v4 (lidos via `[key: string]: unknown` em
 * `CatalogV5Product`). Fase 2 remove os campos v4 do catálogo.
 */
export interface CatalogV5ProductLinks {
  checkoutBaseUrl?: string;
  offerPathTemplate?: string;
}

export interface CatalogV5Product {
  aliases?: string[];
  hotmart?: CatalogV5ProductHotmart;
  tracking?: CatalogV5ProductTracking;
  dashboard?: CatalogV5ProductDashboard;
  links?: CatalogV5ProductLinks;
  n8nForward?: { enrichPayload?: boolean };
  [key: string]: unknown;
}

export interface CatalogV5Tenant {
  name?: string;
  domains?: string[];
  credentials?: Record<string, unknown>;
  allowedOrigins?: string[];                                    // v5 novo
  tracking?: CatalogV5TenantTracking;                          // v5 novo — tracking por tenant
  integrations?: Record<string, CatalogV5Integration>;         // v5 novo
  dashboard?: CatalogV5TenantDashboard;                        // v5 novo
  links?: CatalogV5TenantLinks;                                // v5 novo
  products?: Record<string, CatalogV5Product>;
  [key: string]: unknown;
}

/** Tipo principal do catálogo — compatível com v4 e v5. */
export interface CatalogV5 {
  schemaVersion?: number;
  tenants?: Record<string, CatalogV5Tenant>;
  products?: Record<string, CatalogV5Product>;                 // v4 legado
  [key: string]: unknown;
}

// ─── helpers de leitura ───────────────────────────────────────────────────────

function getTenant(catalog: CatalogV5, tenantId: string): CatalogV5Tenant | undefined {
  return catalog.tenants?.[tenantId];
}

function getProduct(
  catalog: CatalogV5,
  tenantId: string,
  productCode: string,
): CatalogV5Product | undefined {
  return getTenant(catalog, tenantId)?.products?.[productCode];
}

/**
 * Retorna `tracking` do tenant (v5).
 * Retorna `undefined` se catálogo não tem `tenants.{id}.tracking` (ex: v4).
 */
export function getTenantTracking(
  catalog: CatalogV5,
  tenantId: string,
): CatalogV5TenantTracking | undefined {
  return getTenant(catalog, tenantId)?.tracking;
}

/**
 * Retorna `tracking` do produto.
 * Presente em v4 (sgtm, ga4, metaPixel por produto) e v5 (apenas metaPixel por produto).
 */
export function getProductTracking(
  catalog: CatalogV5,
  tenantId: string,
  productCode: string,
): CatalogV5ProductTracking | undefined {
  return getProduct(catalog, tenantId, productCode)?.tracking;
}

/**
 * Retorna `hotmart.urlSlugs` do produto para roteamento em api-hotmart-ingress.
 * Retorna `[]` quando não declarado (v4) — caller faz fallback para heurística.
 */
export function getProductHotmartUrlSlugs(
  catalog: CatalogV5,
  tenantId: string,
  productCode: string,
): string[] {
  return getProduct(catalog, tenantId, productCode)?.hotmart?.urlSlugs ?? [];
}

/**
 * Localiza o produto pelo slug Hotmart da URL.
 * Retorna o `productCode` canonical ou `undefined` quando não encontrado.
 */
export function findProductByHotmartSlug(
  catalog: CatalogV5,
  tenantId: string,
  slug: string,
): string | undefined {
  const products = getTenant(catalog, tenantId)?.products;
  if (!products) return undefined;
  for (const [code, product] of Object.entries(products)) {
    if (product.hotmart?.urlSlugs?.includes(slug)) return code;
  }
  return undefined;
}

/**
 * Retorna a config de uma integração específica do tenant (v5).
 * Retorna `undefined` se `integrations` não existe (v4) ou integração não declarada.
 */
export function getTenantIntegration(
  catalog: CatalogV5,
  tenantId: string,
  integrationName: string,
): CatalogV5Integration | undefined {
  return getTenant(catalog, tenantId)?.integrations?.[integrationName];
}

/**
 * Retorna `allowedOrigins` do tenant (v5).
 * Retorna `[]` quando não declarado (v4) — caller aplica política própria.
 */
export function getTenantAllowedOrigins(
  catalog: CatalogV5,
  tenantId: string,
): string[] {
  return getTenant(catalog, tenantId)?.allowedOrigins ?? [];
}
