import { describe, expect, it } from "vitest";
import {
  getTenantTracking,
  getProductTracking,
  getProductHotmartUrlSlugs,
  getTenantIntegration,
  getTenantAllowedOrigins,
  findProductByHotmartSlug,
  type CatalogV5,
} from "../../src/catalog-v5";

// ─── fixtures ────────────────────────────────────────────────────────────────

/** Catálogo v5 completo com todos os campos novos */
const v5Catalog: CatalogV5 = {
  schemaVersion: 5,
  tenants: {
    decole: {
      domains: ["api.decolesuacarreiraesg.com.br"],
      credentials: { brevo_api_key_env: "BREVO_API_KEY_DECOLE" },
      tracking: {
        sgtm: { endpointEnvVar: "SGTM_ENDPOINT_URL_DECOLE" },
        ga4: { measurementIdEnvVar: "GA4_MEASUREMENT_ID_DECOLE", apiSecretEnvVar: "GA4_API_SECRET_DECOLE" },
        metaCapi: { accessTokenEnv: "META_CAPI_ACCESS_TOKEN_DECOLE" },
      },
      allowedOrigins: ["https://decolesuacarreiraesg.com.br"],
      integrations: {
        n8n: { webhookUrlEnv: "N8N_WEBHOOK_URL_DECOLE" },
        planovoo: {
          baseUrlEnv: "PLANOVOO_API_BASE_URL_DECOLE",
          hookSecretEnv: "PLANOVOO_HOOK_SECRET_DECOLE",
          scope: ["DECOLE_PLANOVOO"],
          appWebhooks: [
            { path: "/webhooks/v1/planovoo/app/event", productCode: "DECOLE_PLANOVOO", requiresHmac: true },
          ],
        },
      },
      products: {
        DECOLE_ESG_MENTORIA: {
          aliases: ["ESG"],
          hotmart: { productId: "123", urlSlugs: ["decole-esg"] },
          tracking: {
            metaPixel: { pixelIdEnvVar: "META_PIXEL_ID_DECOLE_ESG", pixelId: "111" },
          },
        },
        DECOLE_PLANOVOO: {
          aliases: ["PLANOVOO"],
          hotmart: { productId: "456", urlSlugs: ["planodevoo", "planovoo", "plano-de-voo"] },
          tracking: {
            metaPixel: { pixelIdEnvVar: "META_PIXEL_ID_DECOLE_PLANOVOO", pixelId: "222" },
          },
          n8nForward: { enrichPayload: true },
        },
      },
    },
  },
};

/** Catálogo v4 (sem campos novos) — fallback deve funcionar */
const v4Catalog: CatalogV5 = {
  schemaVersion: 4,
  tenants: {
    decole: {
      domains: ["api.decolesuacarreiraesg.com.br"],
      credentials: { brevo_api_key_env: "BREVO_API_KEY" },
      products: {
        DECOLE_ESG_MENTORIA: {
          tracking: {
            sgtm: { endpointEnvVar: "SGTM_ENDPOINT_URL_DECOLE_ESG" },
            ga4: { measurementIdEnvVar: "GA4_MEASUREMENT_ID", apiSecretEnvVar: "GA4_API_SECRET" },
            metaPixel: { pixelIdEnvVar: "META_PIXEL_ID_DECOLE_ESG", pixelId: "111" },
          },
        },
      },
    },
  },
};

// ─── getTenantTracking ────────────────────────────────────────────────────────

describe("getTenantTracking", () => {
  it("returns v5 tenant-level tracking when present", () => {
    const tracking = getTenantTracking(v5Catalog, "decole");
    expect(tracking?.sgtm?.endpointEnvVar).toBe("SGTM_ENDPOINT_URL_DECOLE");
    expect(tracking?.ga4?.measurementIdEnvVar).toBe("GA4_MEASUREMENT_ID_DECOLE");
    expect(tracking?.metaCapi?.accessTokenEnv).toBe("META_CAPI_ACCESS_TOKEN_DECOLE");
  });

  it("returns undefined when tenant has no v5 tracking (v4 catalog)", () => {
    const tracking = getTenantTracking(v4Catalog, "decole");
    expect(tracking).toBeUndefined();
  });

  it("returns undefined for unknown tenant", () => {
    expect(getTenantTracking(v5Catalog, "superare")).toBeUndefined();
  });
});

// ─── getProductTracking ───────────────────────────────────────────────────────

describe("getProductTracking", () => {
  it("returns product-level tracking (metaPixel) present in both v4 and v5", () => {
    const tracking = getProductTracking(v5Catalog, "decole", "DECOLE_ESG_MENTORIA");
    expect(tracking?.metaPixel?.pixelIdEnvVar).toBe("META_PIXEL_ID_DECOLE_ESG");
  });

  it("returns product tracking from v4 catalog", () => {
    const tracking = getProductTracking(v4Catalog, "decole", "DECOLE_ESG_MENTORIA");
    expect(tracking?.sgtm?.endpointEnvVar).toBe("SGTM_ENDPOINT_URL_DECOLE_ESG");
    expect(tracking?.ga4?.measurementIdEnvVar).toBe("GA4_MEASUREMENT_ID");
  });

  it("returns undefined for unknown product", () => {
    expect(getProductTracking(v5Catalog, "decole", "UNKNOWN_PRODUCT")).toBeUndefined();
  });

  it("returns undefined for unknown tenant", () => {
    expect(getProductTracking(v5Catalog, "superare", "DECOLE_ESG_MENTORIA")).toBeUndefined();
  });
});

// ─── getProductHotmartUrlSlugs ────────────────────────────────────────────────

describe("getProductHotmartUrlSlugs", () => {
  it("returns slugs for product with urlSlugs defined", () => {
    const slugs = getProductHotmartUrlSlugs(v5Catalog, "decole", "DECOLE_ESG_MENTORIA");
    expect(slugs).toEqual(["decole-esg"]);
  });

  it("returns multiple slugs for PLANOVOO (legacy slug variants)", () => {
    const slugs = getProductHotmartUrlSlugs(v5Catalog, "decole", "DECOLE_PLANOVOO");
    expect(slugs).toContain("planodevoo");
    expect(slugs).toContain("planovoo");
    expect(slugs).toContain("plano-de-voo");
  });

  it("returns empty array when urlSlugs not defined (v4 catalog)", () => {
    const slugs = getProductHotmartUrlSlugs(v4Catalog, "decole", "DECOLE_ESG_MENTORIA");
    expect(slugs).toEqual([]);
  });
});

// ─── findProductByHotmartSlug ─────────────────────────────────────────────────

describe("findProductByHotmartSlug", () => {
  it("finds product code by exact hotmart URL slug", () => {
    expect(findProductByHotmartSlug(v5Catalog, "decole", "decole-esg")).toBe("DECOLE_ESG_MENTORIA");
    expect(findProductByHotmartSlug(v5Catalog, "decole", "planovoo")).toBe("DECOLE_PLANOVOO");
    expect(findProductByHotmartSlug(v5Catalog, "decole", "plano-de-voo")).toBe("DECOLE_PLANOVOO");
  });

  it("returns undefined for unknown slug", () => {
    expect(findProductByHotmartSlug(v5Catalog, "decole", "unknown-product")).toBeUndefined();
  });

  it("returns undefined when tenant has no products with urlSlugs (v4 catalog)", () => {
    expect(findProductByHotmartSlug(v4Catalog, "decole", "decole-esg")).toBeUndefined();
  });
});

// ─── getTenantIntegration ─────────────────────────────────────────────────────

describe("getTenantIntegration", () => {
  it("returns integration config when present", () => {
    const n8n = getTenantIntegration(v5Catalog, "decole", "n8n");
    expect(n8n?.webhookUrlEnv).toBe("N8N_WEBHOOK_URL_DECOLE");
  });

  it("returns planovoo integration with appWebhooks", () => {
    const planovoo = getTenantIntegration(v5Catalog, "decole", "planovoo");
    expect(planovoo?.appWebhooks).toHaveLength(1);
    expect(planovoo?.appWebhooks?.[0].path).toBe("/webhooks/v1/planovoo/app/event");
  });

  it("returns undefined when integration not declared (v4 catalog)", () => {
    expect(getTenantIntegration(v4Catalog, "decole", "n8n")).toBeUndefined();
  });

  it("returns undefined for unknown integration name", () => {
    expect(getTenantIntegration(v5Catalog, "decole", "telegram")).toBeUndefined();
  });
});

// ─── getTenantAllowedOrigins ──────────────────────────────────────────────────

describe("getTenantAllowedOrigins", () => {
  it("returns origins when v5 allowedOrigins present", () => {
    const origins = getTenantAllowedOrigins(v5Catalog, "decole");
    expect(origins).toEqual(["https://decolesuacarreiraesg.com.br"]);
  });

  it("returns empty array when allowedOrigins not defined (v4 catalog)", () => {
    const origins = getTenantAllowedOrigins(v4Catalog, "decole");
    expect(origins).toEqual([]);
  });

  it("returns empty array for unknown tenant", () => {
    expect(getTenantAllowedOrigins(v5Catalog, "superare")).toEqual([]);
  });
});

// ─── cross-tenant isolation ───────────────────────────────────────────────────

describe("cross-tenant isolation", () => {
  const multiTenantCatalog: CatalogV5 = {
    schemaVersion: 5,
    tenants: {
      decole: {
        domains: ["api.decolesuacarreiraesg.com.br"],
        allowedOrigins: ["https://decolesuacarreiraesg.com.br"],
        tracking: {
          ga4: { measurementIdEnvVar: "GA4_DECOLE" },
        },
        products: {
          DECOLE_ESG_MENTORIA: {
            hotmart: { urlSlugs: ["decole-esg"] },
          },
        },
      },
      superare: {
        domains: ["api.superare.com.br"],
        allowedOrigins: ["https://superare.com.br"],
        tracking: {
          ga4: { measurementIdEnvVar: "GA4_SUPERARE" },
        },
        products: {
          SUPERARE_CURSO_X: {
            hotmart: { urlSlugs: ["superare-x"] },
          },
        },
      },
    },
  };

  it("getTenantTracking returns correct tenant tracking and does not bleed between tenants", () => {
    const decole = getTenantTracking(multiTenantCatalog, "decole");
    const superare = getTenantTracking(multiTenantCatalog, "superare");
    expect(decole?.ga4?.measurementIdEnvVar).toBe("GA4_DECOLE");
    expect(superare?.ga4?.measurementIdEnvVar).toBe("GA4_SUPERARE");
    // Explicit isolation: decole tracking ≠ superare tracking
    expect(decole?.ga4?.measurementIdEnvVar).not.toBe(superare?.ga4?.measurementIdEnvVar);
  });

  it("getTenantAllowedOrigins returns correct origins per tenant without cross-contamination", () => {
    expect(getTenantAllowedOrigins(multiTenantCatalog, "decole"))
      .toEqual(["https://decolesuacarreiraesg.com.br"]);
    expect(getTenantAllowedOrigins(multiTenantCatalog, "superare"))
      .toEqual(["https://superare.com.br"]);
  });

  it("findProductByHotmartSlug scoped to tenant — decole slug not found in superare", () => {
    expect(findProductByHotmartSlug(multiTenantCatalog, "superare", "decole-esg"))
      .toBeUndefined();
    expect(findProductByHotmartSlug(multiTenantCatalog, "decole", "superare-x"))
      .toBeUndefined();
  });

  it("getProductTracking scoped to tenant — product of decole invisible to superare lookup", () => {
    expect(getProductTracking(multiTenantCatalog, "superare", "DECOLE_ESG_MENTORIA"))
      .toBeUndefined();
    expect(getProductTracking(multiTenantCatalog, "decole", "SUPERARE_CURSO_X"))
      .toBeUndefined();
  });
});

// ─── defensive — catalog sem tenants ─────────────────────────────────────────

describe("defensive — catalog without tenants key", () => {
  const emptyCatalog: CatalogV5 = { schemaVersion: 4 };

  it("getTenantTracking returns undefined without throwing", () => {
    expect(getTenantTracking(emptyCatalog, "decole")).toBeUndefined();
  });

  it("getTenantAllowedOrigins returns [] without throwing", () => {
    expect(getTenantAllowedOrigins(emptyCatalog, "decole")).toEqual([]);
  });

  it("getProductHotmartUrlSlugs returns [] without throwing", () => {
    expect(getProductHotmartUrlSlugs(emptyCatalog, "decole", "ANY")).toEqual([]);
  });

  it("findProductByHotmartSlug returns undefined without throwing", () => {
    expect(findProductByHotmartSlug(emptyCatalog, "decole", "any-slug")).toBeUndefined();
  });

  it("getTenantIntegration returns undefined without throwing", () => {
    expect(getTenantIntegration(emptyCatalog, "decole", "n8n")).toBeUndefined();
  });
});
