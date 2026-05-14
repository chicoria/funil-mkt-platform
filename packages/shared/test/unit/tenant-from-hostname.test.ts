import { describe, expect, it } from "vitest";
import {
  resolveTenantIdFromHostname,
  tryResolveTenantIdFromHostname,
} from "../../src/tenant-from-hostname";

const catalog = {
  tenants: {
    decole: {
      domains: [
        "api.decolesuacarreiraesg.com.br",
        "links.decolesuacarreiraesg.com.br",
        "decolesuacarreiraesg.com.br",
      ],
    },
    superare: {
      domains: ["api.superare.com.br", "superare.com.br"],
    },
  },
};

describe("resolveTenantIdFromHostname", () => {
  it("resolves decole tenant by exact hostname match", () => {
    expect(resolveTenantIdFromHostname("api.decolesuacarreiraesg.com.br", catalog)).toBe("decole");
    expect(resolveTenantIdFromHostname("links.decolesuacarreiraesg.com.br", catalog)).toBe("decole");
    expect(resolveTenantIdFromHostname("decolesuacarreiraesg.com.br", catalog)).toBe("decole");
  });

  it("resolves superare tenant by exact hostname match", () => {
    expect(resolveTenantIdFromHostname("api.superare.com.br", catalog)).toBe("superare");
    expect(resolveTenantIdFromHostname("superare.com.br", catalog)).toBe("superare");
  });

  it("is case-insensitive", () => {
    expect(resolveTenantIdFromHostname("API.DECOLESUACARREIRAESG.COM.BR", catalog)).toBe("decole");
  });

  it("returns default fallback for unknown hostname", () => {
    expect(resolveTenantIdFromHostname("unknown.example.com", catalog)).toBe("decole");
  });

  it("uses custom fallback when provided", () => {
    expect(resolveTenantIdFromHostname("preview.workers.dev", catalog, "superare")).toBe("superare");
  });

  it("returns fallback when catalog has no tenants", () => {
    expect(resolveTenantIdFromHostname("anywhere.com", {})).toBe("decole");
    expect(resolveTenantIdFromHostname("anywhere.com", { tenants: {} })).toBe("decole");
  });

  it("returns fallback when tenant has no domains array", () => {
    const c = { tenants: { decole: {} } };
    expect(resolveTenantIdFromHostname("api.decolesuacarreiraesg.com.br", c)).toBe("decole");
  });
});

describe("tryResolveTenantIdFromHostname (no fallback)", () => {
  it("returns tenant_id when hostname matches", () => {
    expect(tryResolveTenantIdFromHostname("api.superare.com.br", catalog)).toBe("superare");
  });

  it("returns undefined for unknown hostname (no fallback applied)", () => {
    expect(tryResolveTenantIdFromHostname("preview.workers.dev", catalog)).toBeUndefined();
  });

  it("returns undefined when catalog has no tenants", () => {
    expect(tryResolveTenantIdFromHostname("anywhere.com", {})).toBeUndefined();
  });
});
