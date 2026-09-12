import { describe, expect, it } from "vitest";
import worker, { resolvePromoByCatalog } from "../../src/index";
// @ts-expect-error — sufixo ?raw do Vite: conteúdo do arquivo como string, sem tipos do Node
import indexSource from "../../src/index.ts?raw";

function makeRequest(path: string, options: { method?: string } = {}): Request {
  return new Request(`https://links.decolesuacarreiraesg.com.br/${path}`, {
    method: options.method || "GET",
  });
}

const miniCatalog = {
  tenants: {
    decole: {
      links: {
        routes: [
          { path: "/planodevoo/ref/cecilia", type: "channel_referral", productCode: "DECOLE_PLANOVOO", redirectUrl: "https://x/planodevoo" },
          { path: "/decole-esg/checkout", type: "checkout", productCode: "DECOLE_ESG_MENTORIA" },
          { path: "/checkout", type: "checkout", productCode: "DECOLE_ESG_MENTORIA", legacy: true, deprecated: true },
        ],
      },
      products: {
        DECOLE_PLANOVOO: {
          links: { promoBaseUrl: "https://plano.decolesuacarreiraesg.com.br" },
        },
        DECOLE_ESG_MENTORIA: {
          links: {},
        },
      },
    },
  },
} as const;

describe("resolvePromoByCatalog", () => {
  it("resolve promoBaseUrl a partir de uma rota channel_referral existente com o mesmo prefixo", () => {
    const result = resolvePromoByCatalog(miniCatalog, "decole", "planodevoo");
    expect(result).toEqual({
      promoBaseUrl: "https://plano.decolesuacarreiraesg.com.br",
      productCode: "DECOLE_PLANOVOO",
    });
  });

  it("retorna null quando o produto nao tem promoBaseUrl configurado no catalogo", () => {
    const result = resolvePromoByCatalog(miniCatalog, "decole", "decole-esg");
    expect(result).toBeNull();
  });

  it("retorna null para prefixo desconhecido", () => {
    const result = resolvePromoByCatalog(miniCatalog, "decole", "inexistente");
    expect(result).toBeNull();
  });

  it("retorna null para tenant desconhecido (isolamento cross-tenant)", () => {
    const result = resolvePromoByCatalog(miniCatalog, "superare-test", "planodevoo");
    expect(result).toBeNull();
  });

  it("ignora rota legacy/deprecated sem prefixo de produto", () => {
    // prefixo "checkout" bateria com a rota legacy "/checkout" por igualdade de string
    // se nao filtrassemos legacy/deprecated — verifica que isso nao acontece
    const result = resolvePromoByCatalog(miniCatalog, "decole", "checkout");
    expect(result).toBeNull();
  });
});

describe("links-redirect worker — /promo/:code", () => {
  it("redireciona /planodevoo/promo/abc123 para promoBaseUrl/promo/abc123", async () => {
    const res = await worker.fetch(makeRequest("planodevoo/promo/abc123"), {});
    expect(res.status).toBe(302);
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.origin).toBe("https://plano.decolesuacarreiraesg.com.br");
    expect(url.pathname).toBe("/promo/abc123");
  });

  it("repassa utm_* mas NUNCA email — achado CRITICAL do G.12: email na query desta rota pulava o gate de DOI", async () => {
    // Esta rota é pública, sem qualquer verificação de confirmação — alguém
    // que soubesse o promo_code e o prefixo do produto (ambos essencialmente
    // públicos) podia bater aqui com ?email=qualquer e resgatar na hora, sem
    // nunca confirmar e-mail. O único caminho legítimo pra email chegar ao
    // app é via /promo-signup?rid=... (KV confirmado, ver promo-signup.test.ts).
    const res = await worker.fetch(
      makeRequest("planodevoo/promo/abc123?email=a%40b.com&EMAIL=a%40b.com&utm_source=whatsapp&utm_campaign=piloto"),
      {}
    );
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.searchParams.get("email")).toBeNull();
    expect(url.searchParams.get("EMAIL")).toBeNull();
    expect(url.searchParams.get("utm_source")).toBe("whatsapp");
    expect(url.searchParams.get("utm_campaign")).toBe("piloto");
  });

  it("usa cache-control: no-store no redirect", async () => {
    const res = await worker.fetch(makeRequest("planodevoo/promo/abc123"), {});
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("nao enfileira nenhum evento de funil (BEGIN_CHECKOUT nao se aplica a promo)", async () => {
    const sent: unknown[] = [];
    const res = await worker.fetch(
      makeRequest("planodevoo/promo/abc123"),
      { FUNNEL_EVENTS: { send: async (b: unknown) => { sent.push(b); } } }
    );
    expect(res.status).toBe(302);
    expect(sent).toHaveLength(0);
  });

  it("produto sem promoBaseUrl no catalogo real -> 404, sem 500", async () => {
    // DECOLE_ESG_MENTORIA nao tem promoBaseUrl no catalogo real; prefixo "decole-esg"
    // resolve via a rota de checkout existente, mas falta promoBaseUrl
    const res = await worker.fetch(makeRequest("decole-esg/promo/xyz"), {});
    expect(res.status).toBe(404);
  });

  it("codigo com barra extra (/promo/a/b) nao casa a rota — apenas um segmento", async () => {
    const res = await worker.fetch(makeRequest("planodevoo/promo/a/b"), {});
    expect(res.status).toBe(404);
  });

  it("prefixo de produto desconhecido -> 404", async () => {
    const res = await worker.fetch(makeRequest("inexistente/promo/x"), {});
    expect(res.status).toBe(404);
  });

  it("nao reaproveita o prefixo de checkout (plano-de-voo) como alias de promo — so channel_referral", async () => {
    // Regressao do achado G.12: /plano-de-voo/promo/... nao pode virar uma
    // segunda URL canonica para o mesmo destino de /planodevoo/promo/...
    const res = await worker.fetch(makeRequest("plano-de-voo/promo/abc123"), {});
    expect(res.status).toBe(404);
  });

  it("mantem o worker agnostico de tenant/produto — nenhum literal hardcoded em src/index.ts", () => {
    const matches = (indexSource as string).match(/DECOLE|PLANOVOO|ESG/g) || [];
    expect(matches).toEqual([]);
  });
});
