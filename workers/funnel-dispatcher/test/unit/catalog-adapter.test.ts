import { describe, expect, it } from "vitest";
import {
  isConfiguredCatalog,
  parseCatalog,
  resolveCatalogEvent,
  resolveCatalogProduct,
  type ParsedCatalog,
} from "../../src/catalog-adapter";
import bundledCatalogJson from "../../../../config/products.catalog.json";

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

describe("bundled products.catalog.json (multi-tenant shape — Slice 2.6B)", () => {
  const bundled = bundledCatalogJson as ParsedCatalog & {
    tenants?: Record<string, { domains?: string[]; credentials?: Record<string, unknown>; products?: Record<string, unknown> }>;
  };

  it("uses tenants.* top-level shape, not legacy products.*", () => {
    expect(bundled.tenants).toBeDefined();
    expect(bundled.products).toBeUndefined();
  });

  it("declares the decole tenant with domains and credentials", () => {
    const decole = bundled.tenants?.decole;
    expect(decole).toBeDefined();
    expect(decole?.domains).toContain("api.decolesuacarreiraesg.com.br");
    expect(decole?.credentials?.brevo_api_key_env).toBe("BREVO_API_KEY_DECOLE");
  });

  it("keeps DECOLE_PLANOVOO and DECOLE_ESG_MENTORIA under decole tenant", () => {
    const products = bundled.tenants?.decole?.products || {};
    expect(Object.keys(products)).toEqual(
      expect.arrayContaining(["DECOLE_PLANOVOO", "DECOLE_ESG_MENTORIA"])
    );
  });

  it("resolves legacy product_code (without tenant_id) through tenant alias fallback", () => {
    const resolved = resolveCatalogProduct(bundled, { product_code: "PLANOVOO" });
    expect(resolved?.tenant_id).toBe("decole");
    expect(resolved?.product_code).toBe("DECOLE_PLANOVOO");
    expect(resolved?.source).toBe("tenants");
  });

  it("resolves PURCHASE_APPROVED event from bundled tenant catalog", () => {
    const eventConfig = resolveCatalogEvent(
      bundled,
      { product_code: "DECOLE_PLANOVOO" },
      "PURCHASE_APPROVED"
    );
    expect(eventConfig?.chain).toContain("call_product_api");
    expect(eventConfig?.chain).toContain("send_template_email");
  });
});

// ─── schema v5 — novos campos ──────────────────────────────────────────────────
// Helper local: o catálogo bundled é ParsedCatalog (tipagem do adapter) mas
// os campos v5 novos não estão na interface ainda (Fase 2). Acessamos via
// cast direto para validar que o JSON foi bumped corretamente para v5.

const v5Raw = bundledCatalogJson as Record<string, unknown>;
const v5Tenants = v5Raw.tenants as Record<string, Record<string, unknown>>;
const v5Decole = v5Tenants?.decole ?? {};
const v5Products = v5Decole.products as Record<string, Record<string, unknown>> ?? {};

describe("catalog-adapter bundled catalog — schema v5 fields (Slice 2.11T.1)", () => {
  it("schemaVersion is 5", () => {
    expect(v5Raw.schemaVersion).toBe(5);
  });

  it("decole tenant has allowedOrigins (v5)", () => {
    const origins = v5Decole.allowedOrigins as string[];
    expect(Array.isArray(origins)).toBe(true);
    expect(origins).toContain("https://decolesuacarreiraesg.com.br");
  });

  it("decole tenant has tenant-level tracking: sgtm, ga4, metaCapi (v5)", () => {
    const tracking = v5Decole.tracking as Record<string, Record<string, string>>;
    expect(tracking?.sgtm?.endpointEnvVar).toBe("SGTM_ENDPOINT_URL_DECOLE");
    expect(tracking?.ga4?.measurementIdEnvVar).toBe("GA4_MEASUREMENT_ID_DECOLE");
    expect(tracking?.ga4?.apiSecretEnvVar).toBe("GA4_API_SECRET_DECOLE");
    expect(tracking?.metaCapi?.accessTokenEnv).toBe("META_CAPI_ACCESS_TOKEN_DECOLE");
  });

  it("decole tenant has integrations.planovoo.appWebhooks (v5)", () => {
    const integrations = v5Decole.integrations as Record<string, Record<string, unknown>>;
    const webhooks = integrations?.planovoo?.appWebhooks as Array<Record<string, unknown>>;
    expect(Array.isArray(webhooks)).toBe(true);
    expect(webhooks[0]?.path).toBe("/webhooks/v1/planovoo/app/event");
    expect(webhooks[0]?.requiresHmac).toBe(true);
  });

  it("DECOLE_ESG_MENTORIA has hotmart.urlSlugs (v5)", () => {
    const esg = v5Products.DECOLE_ESG_MENTORIA;
    const slugs = (esg?.hotmart as Record<string, string[]>)?.urlSlugs;
    expect(Array.isArray(slugs)).toBe(true);
    expect(slugs).toContain("decole-esg");
  });

  it("DECOLE_PLANOVOO has hotmart.urlSlugs with all legacy slug variants (v5)", () => {
    const plano = v5Products.DECOLE_PLANOVOO;
    const slugs = (plano?.hotmart as Record<string, string[]>)?.urlSlugs;
    expect(slugs).toContain("planodevoo");
    expect(slugs).toContain("planovoo");
    expect(slugs).toContain("plano-de-voo");
  });

  it("DECOLE_PLANOVOO has n8nForward.enrichPayload (v5)", () => {
    const plano = v5Products.DECOLE_PLANOVOO;
    const n8nForward = plano?.n8nForward as Record<string, unknown>;
    expect(n8nForward?.enrichPayload).toBe(true);
  });

  it("v4 fields still present after v5 additions (backward compat)", () => {
    const credentials = v5Decole.credentials as Record<string, string>;
    expect(credentials?.brevo_api_key_env).toBe("BREVO_API_KEY_DECOLE");
    const esgTracking = v5Products.DECOLE_ESG_MENTORIA?.tracking as Record<string, Record<string, string>>;
    expect(esgTracking?.sgtm?.endpointEnvVar).toBeDefined();
    expect(esgTracking?.ga4?.measurementIdEnvVar).toBeDefined();
  });
});
