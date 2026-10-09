/**
 * Troca do DOI do product-engineer para o host de links (RUNBOOK-ONBOARDING-LISTA,
 * commit B da L3). Arquivo separado de catalog-list-building.test.ts de propósito: entra no
 * mesmo commit que liga doiRedirectUrl/doiIdentity no catálogo, aplicado só depois de o
 * links-redirect responder em links.theproductengineer.net (passo 2 da L5). Assim cada
 * commit fica verde.
 */
import { describe, expect, it } from "vitest";
import bundledCatalogJson from "../../../../config/products.catalog.json";

type CatalogEvent = { eventType: string; brevoConfig?: { doiRedirectUrl?: string; doiIdentity?: boolean } };

const pe = (
  bundledCatalogJson as unknown as {
    tenants: Record<string, { products?: Record<string, { funnelEventArchitecture?: { events?: CatalogEvent[] } }> }>;
  }
).tenants["product-engineer"];

describe("catálogo: DOI do product-engineer passa pelo links-redirect", () => {
  it("GENERATE_LEAD redireciona o DOI para o host de links com identidade ligada", () => {
    const lead = pe.products?.PRODUCT_ENGINEER_NEWSLETTER?.funnelEventArchitecture?.events?.find(
      (e) => e.eventType === "GENERATE_LEAD"
    );
    expect(lead?.brevoConfig?.doiRedirectUrl).toBe("https://links.theproductengineer.net/product-engineer/signup");
    expect(lead?.brevoConfig?.doiIdentity).toBe(true);
  });
});
