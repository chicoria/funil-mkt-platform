import { describe, expect, it } from "vitest";
import {
  resolveTenantGa4Config,
  resolveProductMetaConfig,
  buildProductLookup,
  listTenantsWithGa4,
  listProductsWithMeta,
} from "../../src/catalog";

const miniCatalog = {
  tenants: {
    decole: {
      dashboard: {
        ga4: {
          propertyIdEnv: "GA4_PROPERTY_ID_DECOLE",
          serviceAccountKeyEnv: "GA4_SERVICE_ACCOUNT_KEY_DECOLE",
        },
        metaAds: {
          accessTokenEnv: "META_ACCESS_TOKEN_DECOLE",
        },
      },
      products: {
        DECOLE_ESG_MENTORIA: {
          dashboard: {
            metaAds: { adAccountIdEnv: "META_AD_ACCOUNT_ID_DECOLE_ESG" },
          },
        },
        DECOLE_PLANOVOO: {
          dashboard: {
            metaAds: { adAccountIdEnv: "META_AD_ACCOUNT_ID_DECOLE_PLANOVOO" },
          },
        },
      },
    },
    acme: {
      // sem dashboard config — tenant sem integração de métricas
      products: {},
    },
  },
};

describe("resolveTenantGa4Config", () => {
  it("retorna config quando env vars estão presentes", () => {
    const env = {
      GA4_PROPERTY_ID_DECOLE: "properties/12345",
      GA4_SERVICE_ACCOUNT_KEY_DECOLE: '{"client_email":"sa@x.com","private_key":"---"}',
    };
    const config = resolveTenantGa4Config(miniCatalog, env, "decole");
    expect(config).not.toBeNull();
    expect(config?.tenantId).toBe("decole");
    expect(config?.propertyId).toBe("properties/12345");
    expect(config?.serviceAccountKey).toContain("client_email");
  });

  it("retorna null quando tenant nao tem dashboard.ga4", () => {
    const env = { GA4_PROPERTY_ID_DECOLE: "properties/12345" };
    expect(resolveTenantGa4Config(miniCatalog, env, "acme")).toBeNull();
  });

  it("retorna null quando tenant nao existe no catalogo", () => {
    const env = { GA4_PROPERTY_ID_DECOLE: "properties/12345" };
    expect(resolveTenantGa4Config(miniCatalog, env, "unknown")).toBeNull();
  });

  it("retorna null quando propertyId esta ausente do env", () => {
    const env = { GA4_SERVICE_ACCOUNT_KEY_DECOLE: '{"private_key":"---"}' };
    expect(resolveTenantGa4Config(miniCatalog, env, "decole")).toBeNull();
  });

  it("retorna null quando serviceAccountKey esta ausente do env", () => {
    const env = { GA4_PROPERTY_ID_DECOLE: "properties/12345" };
    expect(resolveTenantGa4Config(miniCatalog, env, "decole")).toBeNull();
  });
});

describe("resolveProductMetaConfig", () => {
  it("retorna config quando env vars estão presentes", () => {
    const env = {
      META_ACCESS_TOKEN_DECOLE: "EAAabc123",
      META_AD_ACCOUNT_ID_DECOLE_ESG: "act_111",
    };
    const config = resolveProductMetaConfig(miniCatalog, env, "decole", "DECOLE_ESG_MENTORIA");
    expect(config).not.toBeNull();
    expect(config?.tenantId).toBe("decole");
    expect(config?.productCode).toBe("DECOLE_ESG_MENTORIA");
    expect(config?.accessToken).toBe("EAAabc123");
    expect(config?.adAccountId).toBe("act_111");
  });

  it("retorna null quando produto nao tem dashboard.metaAds", () => {
    const catalogSemMeta = {
      tenants: {
        decole: {
          dashboard: { metaAds: { accessTokenEnv: "META_ACCESS_TOKEN_DECOLE" } },
          products: {
            DECOLE_SEM_META: {}, // sem dashboard.metaAds
          },
        },
      },
    };
    const env = { META_ACCESS_TOKEN_DECOLE: "token" };
    expect(resolveProductMetaConfig(catalogSemMeta as never, env, "decole", "DECOLE_SEM_META")).toBeNull();
  });

  it("retorna null quando tenant nao tem dashboard.metaAds", () => {
    const env = { META_ACCESS_TOKEN_DECOLE: "token", META_AD_ACCOUNT_ID_DECOLE_ESG: "act_111" };
    expect(resolveProductMetaConfig(miniCatalog, env, "acme", "DECOLE_ESG_MENTORIA")).toBeNull();
  });

  it("retorna null quando accessToken esta ausente", () => {
    const env = { META_AD_ACCOUNT_ID_DECOLE_ESG: "act_111" };
    expect(resolveProductMetaConfig(miniCatalog, env, "decole", "DECOLE_ESG_MENTORIA")).toBeNull();
  });

  it("retorna null quando adAccountId esta ausente", () => {
    const env = { META_ACCESS_TOKEN_DECOLE: "EAAabc123" };
    expect(resolveProductMetaConfig(miniCatalog, env, "decole", "DECOLE_ESG_MENTORIA")).toBeNull();
  });
});

describe("buildProductLookup", () => {
  it("mapeia productCode lowercase para productCode canonical", () => {
    const lookup = buildProductLookup(miniCatalog);
    expect(lookup["decole_esg_mentoria"]).toBe("DECOLE_ESG_MENTORIA");
    expect(lookup["decole_planovoo"]).toBe("DECOLE_PLANOVOO");
  });

  it("lookup e case-insensitive (chaves sao sempre lowercase)", () => {
    const lookup = buildProductLookup(miniCatalog);
    expect(lookup["DECOLE_ESG_MENTORIA".toLowerCase()]).toBe("DECOLE_ESG_MENTORIA");
  });
});

describe("listTenantsWithGa4", () => {
  it("retorna apenas tenants com dashboard.ga4 configurado", () => {
    const tenants = listTenantsWithGa4(miniCatalog);
    expect(tenants).toContain("decole");
    expect(tenants).not.toContain("acme");
  });
});

describe("listProductsWithMeta", () => {
  it("retorna apenas produtos com dashboard.metaAds configurado", () => {
    const products = listProductsWithMeta(miniCatalog, "decole");
    expect(products).toContain("DECOLE_ESG_MENTORIA");
    expect(products).toContain("DECOLE_PLANOVOO");
    expect(products).toHaveLength(2);
  });

  it("retorna lista vazia para tenant sem produtos com metaAds", () => {
    expect(listProductsWithMeta(miniCatalog, "acme")).toHaveLength(0);
  });
});
