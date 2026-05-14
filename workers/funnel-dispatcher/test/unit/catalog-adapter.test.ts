import { describe, expect, it } from "vitest";
import {
  isConfiguredCatalog,
  parseCatalog,
  resolveCatalogEvent,
  resolveCatalogProduct,
  type ParsedCatalog,
} from "../../src/catalog-adapter";

const catalog: ParsedCatalog = {
  products: {
    DECOLE_ESG_MENTORIA: {
      aliases: ["MENTORIA"],
      funnelEventArchitecture: {
        events: [{ eventType: "GENERATE_LEAD", chain: ["legacy_handler"] }],
      },
    },
  },
  tenants: {
    decole: {
      name: "DECOLE",
      domains: ["api.decolesuacarreiraesg.com.br"],
      products: {
        PLANOVOO: {
          aliases: ["DECOLE_PLANOVOO"],
          funnelEventArchitecture: {
            events: [{ eventType: "PURCHASE_APPROVED", chain: ["tenant_handler"] }],
          },
        },
      },
    },
    superare: {
      name: "SUPERARE",
      domains: ["api.superare.com.br"],
      products: {
        PLANOVOO: {
          aliases: ["SUPERARE_PLANOVOO"],
          funnelEventArchitecture: {
            events: [{ eventType: "PURCHASE_APPROVED", chain: ["superare_handler"] }],
          },
        },
      },
    },
  },
};

describe("catalog-adapter", () => {
  it("parses configured legacy products catalogs", () => {
    const parsed = parseCatalog(JSON.stringify({ products: { X: {} } }));
    expect(isConfiguredCatalog(parsed)).toBe(true);
  });

  it("parses configured multi-tenant catalogs", () => {
    const parsed = parseCatalog(JSON.stringify({ tenants: { decole: { products: {} } } }));
    expect(isConfiguredCatalog(parsed)).toBe(true);
  });

  it("returns empty catalog for invalid JSON", () => {
    const parsed = parseCatalog("{not-json");
    expect(isConfiguredCatalog(parsed)).toBe(false);
  });

  it("resolves legacy top-level product by direct code and alias", () => {
    expect(resolveCatalogProduct(catalog, { product_code: "DECOLE_ESG_MENTORIA" })?.source).toBe("products");
    const byAlias = resolveCatalogProduct(catalog, { product_code: "MENTORIA" });
    expect(byAlias?.product_code).toBe("DECOLE_ESG_MENTORIA");
    expect(byAlias?.tenant_id).toBeUndefined();
  });

  it("resolves tenant product by explicit tenant_id", () => {
    const resolved = resolveCatalogProduct(catalog, {
      tenant_id: "superare",
      product_code: "PLANOVOO",
    });
    expect(resolved?.source).toBe("tenants");
    expect(resolved?.tenant_id).toBe("superare");
    expect(resolved?.product_code).toBe("PLANOVOO");
  });

  it("does not fall through to another tenant when explicit tenant has products", () => {
    const resolved = resolveCatalogProduct(catalog, {
      tenant_id: "superare",
      product_code: "DECOLE_PLANOVOO",
    });
    expect(resolved).toBeUndefined();
  });

  it("does not fall through to legacy products when explicit tenant has no products", () => {
    const resolved = resolveCatalogProduct(
      {
        products: {
          DECOLE_PLANOVOO: { aliases: ["PLANOVOO"] },
        },
        tenants: {
          superare: {
            name: "SUPERARE",
            domains: [],
            products: {},
          },
        },
      },
      {
        tenant_id: "superare",
        product_code: "DECOLE_PLANOVOO",
      }
    );
    expect(resolved).toBeUndefined();
  });

  it("does not fall through to another tenant when explicit tenant is unknown", () => {
    const resolved = resolveCatalogProduct(catalog, {
      tenant_id: "unknown",
      product_code: "DECOLE_PLANOVOO",
    });
    expect(resolved).toBeUndefined();
  });

  it("keeps legacy product fallback when catalog has no tenants block", () => {
    const resolved = resolveCatalogProduct(
      {
        products: {
          DECOLE_PLANOVOO: { aliases: ["PLANOVOO"] },
        },
      },
      {
        tenant_id: "decole",
        product_code: "DECOLE_PLANOVOO",
      }
    );
    expect(resolved?.source).toBe("products");
    expect(resolved?.product_code).toBe("DECOLE_PLANOVOO");
  });

  it("falls back to tenant alias for legacy events without tenant_id", () => {
    const resolved = resolveCatalogProduct(catalog, { product_code: "DECOLE_PLANOVOO" });
    expect(resolved?.source).toBe("tenants");
    expect(resolved?.tenant_id).toBe("decole");
    expect(resolved?.product_code).toBe("PLANOVOO");
  });

  it("resolves event config from tenant product", () => {
    const eventConfig = resolveCatalogEvent(
      catalog,
      { tenant_id: "decole", product_code: "PLANOVOO" },
      "PURCHASE_APPROVED"
    );
    expect(eventConfig?.chain).toEqual(["tenant_handler"]);
  });
});
