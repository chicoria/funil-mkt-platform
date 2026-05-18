import { describe, expect, it } from "vitest";
import { resolveCheckoutByCatalog } from "../../src/index";

const miniCatalog = {
  tenants: {
    decole: {
      links: {
        linksDomain: "links.decolesuacarreiraesg.com.br",
        routes: [
          { path: "/decole-esg/checkout", type: "checkout", productCode: "DECOLE_ESG_MENTORIA" },
          { path: "/plano-de-voo/checkout", type: "checkout", productCode: "DECOLE_PLANOVOO" },
          { path: "/checkout", type: "checkout", productCode: "DECOLE_ESG_MENTORIA", legacy: true, deprecated: true },
        ],
      },
      products: {
        DECOLE_ESG_MENTORIA: {
          links: { checkoutBaseUrl: "https://pay.hotmart.com/K98068530F?off=3j6lto4t" },
        },
        DECOLE_PLANOVOO: {
          links: { checkoutBaseUrl: "https://pay.hotmart.com/R105463680A?off=f3yweqek" },
        },
      },
    },
  },
} as const;

describe("resolveCheckoutByCatalog", () => {
  it("resolve /decole-esg/checkout para ESG", () => {
    const result = resolveCheckoutByCatalog(miniCatalog, "decole", "/decole-esg/checkout");
    expect(result).not.toBeNull();
    expect(result?.productCode).toBe("DECOLE_ESG_MENTORIA");
    expect(result?.checkoutBaseUrl).toContain("K98068530F");
    expect(result?.checkoutPath).toBe("decole-esg/checkout");
  });

  it("resolve /plano-de-voo/checkout para PlanoVoo", () => {
    const result = resolveCheckoutByCatalog(miniCatalog, "decole", "/plano-de-voo/checkout");
    expect(result).not.toBeNull();
    expect(result?.productCode).toBe("DECOLE_PLANOVOO");
    expect(result?.checkoutBaseUrl).toContain("R105463680A");
  });

  it("resolve /checkout (rota legacy) para ESG", () => {
    const result = resolveCheckoutByCatalog(miniCatalog, "decole", "/checkout");
    expect(result).not.toBeNull();
    expect(result?.productCode).toBe("DECOLE_ESG_MENTORIA");
  });

  it("retorna null para rota desconhecida", () => {
    const result = resolveCheckoutByCatalog(miniCatalog, "decole", "/rota-desconhecida");
    expect(result).toBeNull();
  });

  it("retorna null para tenant desconhecido (isolamento cross-tenant)", () => {
    const result = resolveCheckoutByCatalog(miniCatalog, "superare-test", "/decole-esg/checkout");
    expect(result).toBeNull();
  });

  it("e case-insensitive no path", () => {
    const result = resolveCheckoutByCatalog(miniCatalog, "decole", "/Decole-ESG/Checkout");
    expect(result).not.toBeNull();
    expect(result?.productCode).toBe("DECOLE_ESG_MENTORIA");
  });

  it("normaliza path sem barra inicial", () => {
    const result = resolveCheckoutByCatalog(miniCatalog, "decole", "decole-esg/checkout");
    expect(result).not.toBeNull();
    expect(result?.productCode).toBe("DECOLE_ESG_MENTORIA");
  });
});
