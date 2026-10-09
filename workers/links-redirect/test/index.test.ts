import { describe, expect, it } from "vitest";
import worker from "../src/index";

type Env = {
  FUNNEL_EVENTS?: { send(body: unknown): Promise<void> };
  IDENTITY_KV?: { get(key: string): Promise<string | null> };
};

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { ...overrides };
}

function makeRequest(path: string, options: { method?: string } = {}): Request {
  return new Request(`https://links.decolesuacarreiraesg.com.br/${path}`, {
    method: options.method || "GET",
  });
}

describe("links-redirect worker", () => {
  it("retorna healthcheck", async () => {
    const res = await worker.fetch(makeRequest("health"), makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; worker?: string };
    expect(json.ok).toBe(true);
    expect(json.worker).toBe("links-redirect");
  });

  it("retorna 404 quando rota nao existe", async () => {
    const res = await worker.fetch(makeRequest("rota-invalida"), makeEnv());
    expect(res.status).toBe(404);
  });

  it("retorna 404 quando hostname nao e de tenant conhecido", async () => {
    const req = new Request("https://links.tenant-desconhecido.com.br/elizete-wp");
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("tenant_not_configured");
  });

  it("retorna 500 quando contato nao esta configurado para o tenant", async () => {
    // elizete-wp existe para decole; se colocarmos um slug que não existe → 404
    const res = await worker.fetch(makeRequest("contato-sem-config"), makeEnv());
    expect(res.status).toBe(404);
  });

  it("redireciona para WhatsApp com texto default e numero sanitizado", async () => {
    const res = await worker.fetch(makeRequest("elizete-wp"), makeEnv());
    expect(res.status).toBe(302);
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe("/351915787081");
    expect(url.searchParams.get("text")).toContain("Elizete");
  });

  it("repassa parametros recebidos para o WhatsApp", async () => {
    const res = await worker.fetch(makeRequest("elizete-wp?text=Oi&t=Ola&foo=bar"), makeEnv());
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.searchParams.get("text")).toBe("Oi");
    expect(url.searchParams.get("t")).toBe("Ola");
    expect(url.searchParams.get("foo")).toBe("bar");
  });

  it("retorna 404 para checkout legado sem prefixo de produto", async () => {
    const res = await worker.fetch(makeRequest("checkout?utm_source=ig"), makeEnv());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe("not_found");
  });

  it("enfileira BEGIN_CHECKOUT antes de redirecionar para checkout", async () => {
    const sent: unknown[] = [];
    const res = await worker.fetch(
      makeRequest("plano-de-voo/checkout?utm_source=ig&anonymous_id=anon-123&fbp=fb.1.123&event_id=evt-begin-1"),
      makeEnv({
        FUNNEL_EVENTS: {
          send: async (body: unknown) => {
            sent.push(body);
          },
        },
      })
    );

    expect(res.status).toBe(302);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      event_id: "evt-begin-1",
      event_type: "BEGIN_CHECKOUT",
      product_code: "DECOLE_PLANOVOO",
      source: "site",
      identity: { anonymous_id: "anon-123" },
      attribution: { fbp: "fb.1.123", utm_source: "ig" },
      payload: {
        checkout_path: "plano-de-voo/checkout",
        offer_code: "f3yweqek",
      },
    });
  });

  it("captura test_event_code no payload do BEGIN_CHECKOUT (checkout de teste sem poluir relatorios)", async () => {
    const sent: unknown[] = [];
    const res = await worker.fetch(
      makeRequest("plano-de-voo/checkout?event_id=evt-begin-test&test_event_code=TEST12345"),
      makeEnv({
        FUNNEL_EVENTS: {
          send: async (body: unknown) => {
            sent.push(body);
          },
        },
      })
    );

    expect(res.status).toBe(302);
    expect(sent[0]).toMatchObject({
      event_id: "evt-begin-test",
      payload: { test_event_code: "TEST12345" },
    });
  });

  it("padroniza oferta via parametro offer", async () => {
    const res = await worker.fetch(makeRequest("plano-de-voo/checkout?offer=n82b9jqz&utm_source=ig"), makeEnv());
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.searchParams.get("off")).toBe("n82b9jqz");
    expect(url.searchParams.get("offer")).toBe("n82b9jqz");
    expect(url.searchParams.get("utm_source")).toBe("ig");
  });

  it("redireciona plano de voo com parametros recebidos", async () => {
    const res = await worker.fetch(makeRequest("plano-de-voo/checkout?utm_source=ig"), makeEnv());
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.origin).toBe("https://pay.hotmart.com");
    expect(url.pathname).toBe("/R105463680A");
    expect(url.searchParams.get("off")).toBe("f3yweqek");
    expect(url.searchParams.get("utm_source")).toBe("ig");
  });

  it("expande token de recuperacao antes de redirecionar para Hotmart", async () => {
    const sent: unknown[] = [];
    const res = await worker.fetch(
      makeRequest("plano-de-voo/checkout?rid=rec-123&utm_medium=manual"),
      makeEnv({
        IDENTITY_KV: {
          get: async (key: string) =>
            key === "checkout_recovery:rec-123"
              ? JSON.stringify({
                  params: {
                    email: "ana@example.com",
                    name: "Ana Silva",
                    phoneac: "11",
                    phonenumber: "999999999",
                    fbp: "fb.1.123",
                    utm_source: "brevo",
                    utm_medium: "email",
                    ignored: "nope",
                  },
                })
              : null,
        },
        FUNNEL_EVENTS: {
          send: async (body: unknown) => {
            sent.push(body);
          },
        },
      })
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.origin).toBe("https://pay.hotmart.com");
    expect(url.searchParams.get("rid")).toBeNull();
    expect(url.searchParams.get("email")).toBe("ana@example.com");
    expect(url.searchParams.get("name")).toBe("Ana Silva");
    expect(url.searchParams.get("phoneac")).toBe("11");
    expect(url.searchParams.get("phonenumber")).toBe("999999999");
    expect(url.searchParams.get("fbp")).toBe("fb.1.123");
    expect(url.searchParams.get("utm_source")).toBe("brevo");
    expect(url.searchParams.get("utm_medium")).toBe("manual");
    expect(url.searchParams.get("ignored")).toBeNull();
    expect(sent[0]).toMatchObject({
      event_type: "BEGIN_CHECKOUT",
      lead: { email: "ana@example.com" },
      attribution: { fbp: "fb.1.123", utm_source: "brevo", utm_medium: "manual" },
    });
  });

  it("expande token de recuperacao escopado por tenant", async () => {
    const requestedKeys: string[] = [];
    const res = await worker.fetch(
      makeRequest("plano-de-voo/checkout?rid=rec-scoped"),
      makeEnv({
        IDENTITY_KV: {
          get: async (key: string) => {
            requestedKeys.push(key);
            return key === "decole:checkout_recovery:rec-scoped"
              ? JSON.stringify({
                  params: {
                    email: "scoped@example.com",
                    name: "Scoped Lead",
                    fbp: "fb.2.scoped",
                  },
                })
              : null;
          },
        },
      })
    );

    expect(res.status).toBe(302);
    expect(requestedKeys[0]).toBe("decole:checkout_recovery:rec-scoped");
    const url = new URL(res.headers.get("location") || "");
    expect(url.searchParams.get("email")).toBe("scoped@example.com");
    expect(url.searchParams.get("name")).toBe("Scoped Lead");
    expect(url.searchParams.get("fbp")).toBe("fb.2.scoped");
  });

  it("redireciona confirmacao DOI ESG via links worker", async () => {
    const res = await worker.fetch(makeRequest("decole-esg/signup?utm_source=brevo"), makeEnv());
    expect(res.status).toBe(302);
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.origin).toBe("https://decolesuacarreiraesg.com.br");
    expect(url.pathname).toBe("/confirmacao.html");
    expect(url.searchParams.get("utm_source")).toBe("brevo");
  });

  it("enfileira SIGN_UP ao confirmar DOI com rid", async () => {
    const sent: unknown[] = [];
    const res = await worker.fetch(
      makeRequest("plano-de-voo/signup?rid=doi-rec-1&utm_campaign=doi"),
      makeEnv({
        IDENTITY_KV: {
          get: async (key: string) =>
            key === "decole:checkout_recovery:doi-rec-1"
              ? JSON.stringify({
                  params: {
                    email: "lead@exemplo.com",
                    phonenumber: "11999999999",
                    anonymous_id: "anon-doi-1",
                    fbp: "fb.1.doi",
                  },
                })
              : null,
        },
        FUNNEL_EVENTS: {
          send: async (body: unknown) => {
            sent.push(body);
          },
        },
      })
    );

    expect(res.status).toBe(302);
    expect(sent).toHaveLength(1);
    // Contrato alterado (RUNBOOK-ONBOARDING-LISTA, M1/S-g): o event_id não deriva mais do
    // e-mail (sem lead_id no registro, usa o rid) e o recovery_id passa a ser preservado.
    expect(sent[0]).toMatchObject({
      event_id: "sign_up:DECOLE_PLANOVOO:doi-rec-1",
      event_type: "SIGN_UP",
      product_code: "DECOLE_PLANOVOO",
      source: "site",
      lead: {
        email: "lead@exemplo.com",
        phone: "11999999999",
      },
      identity: {
        anonymous_id: "anon-doi-1",
      },
      attribution: {
        fbp: "fb.1.doi",
        utm_campaign: "doi",
      },
      payload: {
        confirmation_path: "plano-de-voo/signup",
        recovery_id: "doi-rec-1",
      },
    });
  });

  describe("tenant product-engineer: host e rota de confirmação (passa após a L3)", () => {
    function peRequest(path: string): Request {
      return new Request(`https://links.theproductengineer.net/${path}`);
    }

    function queueEnv(sent: unknown[]): Env {
      return makeEnv({
        FUNNEL_EVENTS: {
          send: async (body: unknown) => {
            sent.push(body);
          },
        },
      });
    }

    it("/product-engineer/signup redireciona (302) para a página de confirmação", async () => {
      const res = await worker.fetch(peRequest("product-engineer/signup"), queueEnv([]));
      expect(res.status).toBe(302);
      const url = new URL(res.headers.get("location") || "");
      expect(`${url.origin}${url.pathname}`).toBe("https://theproductengineer.net/field-notes/confirmed/");
    });

    it("enfileira exatamente 1 SIGN_UP com o product_code do PE", async () => {
      const sent: unknown[] = [];
      await worker.fetch(peRequest("product-engineer/signup"), queueEnv(sent));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ event_type: "SIGN_UP", product_code: "PRODUCT_ENGINEER_NEWSLETTER" });
    });

    it("rota inexistente no host do PE não enfileira nada", async () => {
      const sent: unknown[] = [];
      const res = await worker.fetch(peRequest("rota-inexistente"), queueEnv(sent));
      expect(res.status).toBe(404);
      expect(sent).toHaveLength(0);
    });

    it("regressão: rota da DECOLE continua indo para a confirmação da DECOLE", async () => {
      const res = await worker.fetch(makeRequest("decole-esg/signup"), queueEnv([]));
      expect(res.status).toBe(302);
      expect(new URL(res.headers.get("location") || "").pathname).toBe("/confirmacao.html");
    });
  });

  describe("identidade do SIGN_UP na confirmação de DOI", () => {
    const DOI_RECORD = {
      params: {
        email: "lead@exemplo.com",
        name: "Lead",
        lead_id: "lead-123",
        anonymous_id: "1234567890.1700000000",
      },
      kind: "doi_confirmation",
    };

    function doiEnv(sent: unknown[], records: Record<string, unknown> = {}, kvError = false): Env {
      return makeEnv({
        IDENTITY_KV: {
          get: async (key: string) => {
            if (kvError) throw new Error("kv down");
            return key in records ? JSON.stringify(records[key]) : null;
          },
        },
        FUNNEL_EVENTS: {
          send: async (body: unknown) => {
            sent.push(body);
          },
        },
      });
    }

    type SignUp = {
      event_id: string;
      lead: { email?: string; lead_id?: string };
      identity: { anonymous_id?: string; lead_id?: string };
      payload: Record<string, unknown>;
    };

    it("rid válido: SIGN_UP com identidade do KV e event_id derivado do lead_id", async () => {
      const sent: unknown[] = [];
      const res = await worker.fetch(
        makeRequest("decole-esg/signup?rid=doi-ok"),
        doiEnv(sent, { "decole:checkout_recovery:doi-ok": DOI_RECORD })
      );
      expect(res.status).toBe(302);
      expect(sent).toHaveLength(1);
      const ev = sent[0] as SignUp;
      expect(ev.event_id).toBe("sign_up:DECOLE_ESG_MENTORIA:lead-123");
      expect(ev.lead.email).toBe("lead@exemplo.com");
      expect(ev.identity.anonymous_id).toBe("1234567890.1700000000");
      expect(ev.identity.lead_id).toBe("lead-123");
    });

    it("MF1: nenhum e-mail ou valor do KV no event_id nem no payload", async () => {
      const sent: unknown[] = [];
      await worker.fetch(
        makeRequest("decole-esg/signup?rid=doi-ok"),
        doiEnv(sent, { "decole:checkout_recovery:doi-ok": DOI_RECORD })
      );
      const ev = sent[0] as SignUp;
      expect(ev.event_id).not.toContain("@");
      const payload = JSON.stringify(ev.payload);
      expect(payload).not.toContain("@");
      expect(payload).not.toContain("lead-123");
      expect(payload).not.toContain("1234567890.1700000000");
      expect(String(ev.payload.link_url)).not.toContain("email");
    });

    it("Location não carrega rid, e-mail nem valores do KV", async () => {
      const sent: unknown[] = [];
      const res = await worker.fetch(
        makeRequest("decole-esg/signup?rid=doi-ok&email=forjado@exemplo.com"),
        doiEnv(sent, { "decole:checkout_recovery:doi-ok": DOI_RECORD })
      );
      const location = res.headers.get("location") || "";
      expect(location).not.toContain("rid=");
      expect(location).not.toContain("@");
      expect(location).not.toContain("%40");
      expect(location).not.toContain("lead-123");
      expect(new URL(location).pathname).toBe("/confirmacao.html");
    });

    it("rid desconhecido: falha aberta com event_id derivado do rid (idempotente)", async () => {
      const sent: unknown[] = [];
      const res = await worker.fetch(makeRequest("decole-esg/signup?rid=doi-expirado"), doiEnv(sent));
      expect(res.status).toBe(302);
      expect(sent).toHaveLength(1);
      const ev = sent[0] as SignUp;
      expect(ev.event_id).toBe("sign_up:DECOLE_ESG_MENTORIA:doi-expirado");
      expect(ev.lead.email).toBeUndefined();
    });

    it("KV com erro: 302 e SIGN_UP sem identidade, sem 5xx", async () => {
      const sent: unknown[] = [];
      const res = await worker.fetch(
        makeRequest("decole-esg/signup?rid=doi-ok"),
        doiEnv(sent, { "decole:checkout_recovery:doi-ok": DOI_RECORD }, true)
      );
      expect(res.status).toBe(302);
      const ev = sent[0] as SignUp;
      expect(ev.lead.email).toBeUndefined();
      expect(ev.event_id).toBe("sign_up:DECOLE_ESG_MENTORIA:doi-ok");
    });

    it("?email= em claro sem rid é ignorado", async () => {
      const sent: unknown[] = [];
      const res = await worker.fetch(makeRequest("decole-esg/signup?email=forjado@exemplo.com"), doiEnv(sent));
      expect(res.status).toBe(302);
      const ev = sent[0] as SignUp;
      expect(ev.lead.email).toBeUndefined();
      expect(ev.event_id).not.toContain("@");
      expect(res.headers.get("location") || "").not.toContain("forjado");
    });

    it("S-b: identidade e event_id vindos da query não sobrescrevem o KV", async () => {
      const sent: unknown[] = [];
      await worker.fetch(
        makeRequest("decole-esg/signup?rid=doi-ok&event_id=forjado&anonymous_id=999.999&lead_id=forjado"),
        doiEnv(sent, { "decole:checkout_recovery:doi-ok": DOI_RECORD })
      );
      const ev = sent[0] as SignUp;
      expect(ev.event_id).toBe("sign_up:DECOLE_ESG_MENTORIA:lead-123");
      expect(ev.identity.anonymous_id).toBe("1234567890.1700000000");
      expect(ev.identity.lead_id).toBe("lead-123");
    });

    it("telefone e nome na query não entram no evento nem no Location", async () => {
      const sent: unknown[] = [];
      const res = await worker.fetch(makeRequest("decole-esg/signup?phone=11999999999&name=Forjado"), doiEnv(sent));
      const ev = sent[0] as SignUp & { lead: { phone?: string } };
      expect(ev.lead.phone).toBeUndefined();
      const location = res.headers.get("location") || "";
      expect(location).not.toContain("11999999999");
      expect(location).not.toContain("Forjado");
    });

    it("tenant product-engineer: host de links resolve o rid na chave do próprio tenant", async () => {
      const sent: unknown[] = [];
      const res = await worker.fetch(
        new Request("https://links.theproductengineer.net/product-engineer/signup?rid=pe-rid"),
        doiEnv(sent, { "product-engineer:checkout_recovery:pe-rid": DOI_RECORD })
      );
      expect(res.status).toBe(302);
      const ev = sent[0] as SignUp & { product_code: string };
      expect(ev.product_code).toBe("PRODUCT_ENGINEER_NEWSLETTER");
      expect(ev.lead.email).toBe("lead@exemplo.com");
      expect(ev.identity.anonymous_id).toBe("1234567890.1700000000");
      expect(ev.event_id).toBe("sign_up:PRODUCT_ENGINEER_NEWSLETTER:lead-123");
      expect(res.headers.get("location") || "").not.toContain("pe-rid");
    });

    it("rid de outro tenant não resolve", async () => {
      const sent: unknown[] = [];
      await worker.fetch(
        makeRequest("decole-esg/signup?rid=doi-ok"),
        doiEnv(sent, { "product-engineer:checkout_recovery:doi-ok": DOI_RECORD })
      );
      const ev = sent[0] as SignUp;
      expect(ev.lead.email).toBeUndefined();
    });

    it("HEAD não enfileira SIGN_UP", async () => {
      const sent: unknown[] = [];
      const res = await worker.fetch(makeRequest("decole-esg/signup?rid=doi-ok", { method: "HEAD" }), doiEnv(sent));
      expect(res.status).toBe(302);
      expect(sent).toHaveLength(0);
    });
  });

  describe("channel referral routes", () => {
    it("aplica UTMs padrao do canal quando ausentes", async () => {
      const res = await worker.fetch(makeRequest("planodevoo/ref/cecilia"), makeEnv());
      expect(res.status).toBe(302);
      const location = res.headers.get("location") || "";
      const url = new URL(location);
      expect(url.origin).toBe("https://decolesuacarreiraesg.com.br");
      expect(url.pathname).toBe("/planodevoo");
      expect(url.searchParams.get("utm_source")).toBe("indicacao");
      expect(url.searchParams.get("utm_medium")).toBe("referral");
      expect(url.searchParams.get("utm_campaign")).toBe("cecilia");
    });

    it.each([
      ["deise", "deise"],
      ["efazza", "efazza"],
      ["carreira-esg", "carreira-esg"],
    ])("aplica UTMs padrao do canal %s", async (slug, expectedCampaign) => {
      const res = await worker.fetch(makeRequest(`planodevoo/ref/${slug}`), makeEnv());
      expect(res.status).toBe(302);
      const location = res.headers.get("location") || "";
      const url = new URL(location);
      expect(url.origin).toBe("https://decolesuacarreiraesg.com.br");
      expect(url.pathname).toBe("/planodevoo");
      expect(url.searchParams.get("utm_source")).toBe("indicacao");
      expect(url.searchParams.get("utm_medium")).toBe("referral");
      expect(url.searchParams.get("utm_campaign")).toBe(expectedCampaign);
    });

    it.each([
      ["cecilia", "cecilia"],
      ["deise", "deise"],
      ["efazza", "efazza"],
      ["carreira-esg", "carreira-esg"],
    ])("aplica UTMs padrao do canal %s para Decole ESG via /ref", async (slug, expectedCampaign) => {
      const res = await worker.fetch(makeRequest(`ref/${slug}`), makeEnv());
      expect(res.status).toBe(302);
      const location = res.headers.get("location") || "";
      const url = new URL(location);
      expect(url.origin).toBe("https://decolesuacarreiraesg.com.br");
      expect(url.pathname).toBe("/");
      expect(url.searchParams.get("utm_source")).toBe("indicacao");
      expect(url.searchParams.get("utm_medium")).toBe("referral");
      expect(url.searchParams.get("utm_campaign")).toBe(expectedCampaign);
    });

    it("UTMs recebidos tem precedencia sobre os defaults do canal", async () => {
      const res = await worker.fetch(
        makeRequest("planodevoo/ref/cecilia?utm_source=facebook&utm_medium=paid&foo=bar"),
        makeEnv()
      );
      expect(res.status).toBe(302);
      const location = res.headers.get("location") || "";
      const url = new URL(location);
      expect(url.searchParams.get("utm_source")).toBe("facebook");
      expect(url.searchParams.get("utm_medium")).toBe("paid");
      expect(url.searchParams.get("utm_campaign")).toBe("cecilia");
      expect(url.searchParams.get("foo")).toBe("bar");
    });

    it("nao enfileira evento de funil para referral de canal", async () => {
      const sent: unknown[] = [];
      const res = await worker.fetch(
        makeRequest("planodevoo/ref/cecilia"),
        makeEnv({
          FUNNEL_EVENTS: {
            send: async (body: unknown) => {
              sent.push(body);
            },
          },
        })
      );
      expect(res.status).toBe(302);
      expect(sent).toHaveLength(0);
    });

    it("retorna 404 para slug de canal inexistente", async () => {
      const res = await worker.fetch(makeRequest("planodevoo/ref/inexistente"), makeEnv());
      expect(res.status).toBe(404);
    });
  });

  it("redireciona /plano-de-voo/checkout/offer/:codigo com oferta da rota", async () => {
    const res = await worker.fetch(makeRequest("plano-de-voo/checkout/offer/novo123?utm_source=ig"), makeEnv());
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.pathname).toBe("/R105463680A");
    expect(url.searchParams.get("off")).toBe("novo123");
    expect(url.searchParams.get("offer")).toBe("novo123");
    expect(url.searchParams.get("utm_source")).toBe("ig");
  });

  it("retorna 404 quando /decole-esg/checkout/offer nao tem codigo", async () => {
    const res = await worker.fetch(makeRequest("decole-esg/checkout/offer?utm_source=ig"), makeEnv());
    expect(res.status).toBe(404);
  });

  it("redireciona /decole-esg/checkout/offer/:codigo com oferta da rota", async () => {
    const res = await worker.fetch(makeRequest("decole-esg/checkout/offer/3j6lto4t?utm_source=ig"), makeEnv());
    const location = res.headers.get("location") || "";
    const url = new URL(location);
    expect(url.searchParams.get("off")).toBe("3j6lto4t");
    expect(url.searchParams.get("offer")).toBe("3j6lto4t");
    expect(url.searchParams.get("utm_source")).toBe("ig");
  });

  it("captura CF-Connecting-IP e inclui client_ip na attribution do BEGIN_CHECKOUT", async () => {
    const sent: unknown[] = [];
    const req = new Request("https://links.decolesuacarreiraesg.com.br/plano-de-voo/checkout?anonymous_id=anon-ip", {
      method: "GET",
      headers: { "cf-connecting-ip": "9.8.7.6" },
    });
    await worker.fetch(req, makeEnv({ FUNNEL_EVENTS: { send: async (b: unknown) => { sent.push(b); } } }));
    expect(sent).toHaveLength(1);
    const evt = sent[0] as { attribution?: { client_ip?: string } };
    expect(evt?.attribution?.client_ip).toBe("9.8.7.6");
  });

  it("recusa metodos nao permitidos", async () => {
    const res = await worker.fetch(makeRequest("health", { method: "POST" }), makeEnv());
    expect(res.status).toBe(405);
  });
});
