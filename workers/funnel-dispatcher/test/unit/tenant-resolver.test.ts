import { describe, expect, it } from "vitest";
import {
  resolveTenantFromHostname,
  resolveTenantFromProductCode,
  getCredentials,
  type MultiTenantCatalog,
} from "../../src/tenant-resolver";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const catalog: MultiTenantCatalog = {
  tenants: {
    decole: {
      name: "DECOLE sua Carreira ESG",
      domains: [
        "api.decolesuacarreiraesg.com.br",
        "links.decolesuacarreiraesg.com.br",
        "decolesuacarreiraesg.com.br",
      ],
      credentials: {
        brevo_api_key_env: "BREVO_API_KEY_DECOLE",
        hotmart_token_env: "HOTMART_TOKEN_DECOLE",
        replyToEmail: "contato@decolesuacarreiraesg.com.br",
      },
      products: {
        PLANOVOO: {
          name: "Plano de Voo",
          aliases: ["DECOLE_PLANOVOO"],
        },
        ESG_MENTORIA: {
          name: "Mentoria ESG",
          aliases: ["DECOLE_ESG_MENTORIA"],
        },
      },
    },
    superare: {
      name: "SUPERARE",
      domains: [
        "api.superare.com.br",
        "links.superare.com.br",
        "superare.com.br",
      ],
      credentials: {
        brevo_api_key_env: "BREVO_API_KEY_SUPERARE",
        hotmart_token_env: "HOTMART_TOKEN_SUPERARE",
        replyToEmail: "contato@superare.com.br",
      },
      products: {},
    },
  },
};

// ---------------------------------------------------------------------------
// resolveTenantFromHostname
// ---------------------------------------------------------------------------

describe("resolveTenantFromHostname", () => {
  it("resolves DECOLE from api hostname", () => {
    const result = resolveTenantFromHostname("api.decolesuacarreiraesg.com.br", catalog);
    expect(result.tenant_id).toBe("decole");
    expect(result.name).toBe("DECOLE sua Carreira ESG");
  });

  it("resolves DECOLE from links hostname", () => {
    const result = resolveTenantFromHostname("links.decolesuacarreiraesg.com.br", catalog);
    expect(result.tenant_id).toBe("decole");
  });

  it("resolves DECOLE from root hostname", () => {
    const result = resolveTenantFromHostname("decolesuacarreiraesg.com.br", catalog);
    expect(result.tenant_id).toBe("decole");
  });

  it("resolves SUPERARE from api hostname", () => {
    const result = resolveTenantFromHostname("api.superare.com.br", catalog);
    expect(result.tenant_id).toBe("superare");
    expect(result.name).toBe("SUPERARE");
  });

  it("resolves SUPERARE from links hostname", () => {
    const result = resolveTenantFromHostname("links.superare.com.br", catalog);
    expect(result.tenant_id).toBe("superare");
  });

  it("throws for unknown hostname", () => {
    expect(() =>
      resolveTenantFromHostname("api.unknown.com", catalog)
    ).toThrow(/unknown hostname/i);
  });

  it("is case-insensitive for hostname matching", () => {
    const result = resolveTenantFromHostname("API.DECOLESUACARREIRAESG.COM.BR", catalog);
    expect(result.tenant_id).toBe("decole");
  });
});

// ---------------------------------------------------------------------------
// resolveTenantFromProductCode — backward compat for events without tenant_id
// ---------------------------------------------------------------------------

describe("resolveTenantFromProductCode", () => {
  it("resolves DECOLE_PLANOVOO to tenant decole + product PLANOVOO", () => {
    const result = resolveTenantFromProductCode("DECOLE_PLANOVOO", catalog);
    expect(result.tenant_id).toBe("decole");
    expect(result.product_code).toBe("PLANOVOO");
  });

  it("resolves DECOLE_ESG_MENTORIA to tenant decole + product ESG_MENTORIA", () => {
    const result = resolveTenantFromProductCode("DECOLE_ESG_MENTORIA", catalog);
    expect(result.tenant_id).toBe("decole");
    expect(result.product_code).toBe("ESG_MENTORIA");
  });

  it("resolves direct product code within a tenant", () => {
    const result = resolveTenantFromProductCode("PLANOVOO", catalog);
    expect(result.tenant_id).toBe("decole");
    expect(result.product_code).toBe("PLANOVOO");
  });

  it("is case-insensitive", () => {
    const result = resolveTenantFromProductCode("decole_planovoo", catalog);
    expect(result.tenant_id).toBe("decole");
    expect(result.product_code).toBe("PLANOVOO");
  });

  it("throws for unknown product code", () => {
    expect(() =>
      resolveTenantFromProductCode("UNKNOWN_PRODUCT", catalog)
    ).toThrow(/unknown product/i);
  });
});

// ---------------------------------------------------------------------------
// getCredentials
// ---------------------------------------------------------------------------

describe("getCredentials", () => {
  const env: Record<string, unknown> = {
    BREVO_API_KEY_DECOLE: "xkeysib-decole-key",
    HOTMART_TOKEN_DECOLE: "hotmart-decole-token",
    BREVO_API_KEY_SUPERARE: "xkeysib-superare-key",
    HOTMART_TOKEN_SUPERARE: "hotmart-superare-token",
  };

  it("returns credentials for DECOLE tenant", () => {
    const creds = getCredentials("decole", catalog, env);
    expect(creds.brevoApiKey).toBe("xkeysib-decole-key");
    expect(creds.hotmartToken).toBe("hotmart-decole-token");
    expect(creds.replyToEmail).toBe("contato@decolesuacarreiraesg.com.br");
  });

  it("returns credentials for SUPERARE tenant", () => {
    const creds = getCredentials("superare", catalog, env);
    expect(creds.brevoApiKey).toBe("xkeysib-superare-key");
    expect(creds.hotmartToken).toBe("hotmart-superare-token");
    expect(creds.replyToEmail).toBe("contato@superare.com.br");
  });

  it("throws when env var for brevo key is missing", () => {
    expect(() =>
      getCredentials("decole", catalog, { HOTMART_TOKEN_DECOLE: "ok" })
    ).toThrow(/Missing env var: BREVO_API_KEY_DECOLE/);
  });

  it("throws when env var for hotmart token is missing", () => {
    expect(() =>
      getCredentials("decole", catalog, { BREVO_API_KEY_DECOLE: "ok" })
    ).toThrow(/Missing env var: HOTMART_TOKEN_DECOLE/);
  });

  it("returns undefined replyToEmail when not in catalog", () => {
    const noCreds: MultiTenantCatalog = {
      tenants: {
        minimal: {
          name: "Minimal",
          domains: [],
          credentials: {
            brevo_api_key_env: "KEY",
            hotmart_token_env: "TOKEN",
          },
          products: {},
        },
      },
    };
    const creds = getCredentials("minimal", noCreds, { KEY: "k", TOKEN: "t" });
    expect(creds.replyToEmail).toBeUndefined();
  });

  it("throws for unknown tenant_id", () => {
    expect(() =>
      getCredentials("unknown", catalog, env)
    ).toThrow(/unknown tenant/i);
  });
});
