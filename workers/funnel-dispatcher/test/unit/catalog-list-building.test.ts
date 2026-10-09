/**
 * Catálogo — construção de lista (RUNBOOK-ONBOARDING-LISTA, L1 → passa após a L3).
 *
 * Garante que todo DOI que redireciona para um host de links aponta para um host e uma
 * rota doi_confirmation que o links-redirect realmente atende, e fixa a configuração do
 * tenant product-engineer.
 */
import { describe, expect, it } from "vitest";
import bundledCatalogJson from "../../../../config/products.catalog.json";

type Route = { path: string; type: string; productCode: string; redirectUrl?: string };
type CatalogEvent = {
  eventType: string;
  source?: string;
  chain?: string[];
  trackingRequiresIdentity?: boolean;
  brevoConfig?: { doiRedirectUrl?: string; doiIdentity?: boolean };
};
type Tenant = {
  domains?: string[];
  links?: { linksDomain?: string; routes?: Route[] };
  products?: Record<string, { funnelEventArchitecture?: { events?: CatalogEvent[] } }>;
};

const tenants = (bundledCatalogJson as unknown as { tenants: Record<string, Tenant> }).tenants;

function events(tenant: Tenant, productCode: string): CatalogEvent[] {
  return tenant.products?.[productCode]?.funnelEventArchitecture?.events ?? [];
}

function normalizePath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "").toLowerCase();
}

describe("catálogo: rotas doi_confirmation", () => {
  for (const [tenantId, tenant] of Object.entries(tenants)) {
    const routes = (tenant.links?.routes ?? []).filter((r) => r.type === "doi_confirmation");
    for (const route of routes) {
      it(`${tenantId} ${route.path}: redirectUrl absoluta e productCode do próprio tenant`, () => {
        expect(route.redirectUrl).toMatch(/^https:\/\//);
        expect(Object.keys(tenant.products ?? {})).toContain(route.productCode);
      });
    }
  }
});

describe("catálogo: todo doiRedirectUrl para host de links é atendido pelo links-redirect", () => {
  for (const [tenantId, tenant] of Object.entries(tenants)) {
    for (const productCode of Object.keys(tenant.products ?? {})) {
      for (const event of events(tenant, productCode)) {
        const target = event.brevoConfig?.doiRedirectUrl;
        if (!target || !tenant.links?.linksDomain) continue;
        const url = new URL(target);
        if (url.hostname !== tenant.links.linksDomain) continue;
        it(`${tenantId}/${productCode}: ${url.hostname}${url.pathname}`, () => {
          expect(tenant.domains ?? []).toContain(url.hostname);
          const route = (tenant.links?.routes ?? []).find(
            (r) => normalizePath(r.path) === normalizePath(url.pathname)
          );
          expect(route?.type).toBe("doi_confirmation");
          expect(route?.productCode).toBe(productCode);
        });
      }
    }
  }
});

describe("catálogo: tenant product-engineer (construção de lista)", () => {
  const pe = tenants["product-engineer"];
  const LINKS_HOST = "links.theproductengineer.net";
  const CONFIRM_URL = "https://theproductengineer.net/field-notes/confirmed/";

  it("host de links está em domains e em links.linksDomain", () => {
    expect(pe.domains).toContain(LINKS_HOST);
    expect(pe.links?.linksDomain).toBe(LINKS_HOST);
  });

  it("rota /product-engineer/signup é doi_confirmation para a página de confirmação", () => {
    expect(pe.links?.routes).toContainEqual({
      path: "/product-engineer/signup",
      type: "doi_confirmation",
      productCode: "PRODUCT_ENGINEER_NEWSLETTER",
      redirectUrl: CONFIRM_URL,
    });
  });

  it("SIGN_UP existe, vem do links-redirect, emite tracking e exige identidade", () => {
    const signUp = events(pe, "PRODUCT_ENGINEER_NEWSLETTER").find((e) => e.eventType === "SIGN_UP");
    expect(signUp?.source).toBe("links-redirect");
    expect(signUp?.chain).toContain("emit_tracking");
    expect(signUp?.trackingRequiresIdentity).toBe(true);
  });
});
