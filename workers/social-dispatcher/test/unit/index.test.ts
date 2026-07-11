import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { clearSecretCache } from "../../../../packages/shared/src/secrets-store-wrapper";
import type { DispatcherEnv } from "../../src/dispatcher";
import type { SocialCommentEvent } from "../../../../packages/shared/src/social-comment-event";

const ACCESS_TOKEN_DECOLE = "graph-token-decole";
const ACCESS_TOKEN_SUPERARE = "graph-token-superare";

// NOTA (Slice 9): default de provider agora é Zernio nas duas plataformas
// (ver social-responder-selection.ts). Estes fixtures forçam `meta` via
// responderProvider pra continuar exercitando o pipeline via Graph API
// (mocks de graph.facebook.com já escritos abaixo) — cobertura do caminho
// Zernio (default real de produção) vive em social-responder-selection.test.ts.
const CATALOG = {
  tenants: {
    decole: {
      credentials: { meta_access_token_env: "META_SYSTEM_USER_ACCESS_TOKEN_DECOLE" },
      products: {
        DECOLE_PLANOVOO: {
          commentAutomation: {
            responderProvider: { facebook: "meta", instagram: "meta" },
            rules: [
              {
                id: "planovoo_traducao",
                keyword: "tradução",
                matchType: "contains",
                caseSensitive: false,
                platforms: ["facebook", "instagram"],
                publicReply: { enabled: true, text: "Resposta pública decole" },
                privateReply: { enabled: true, text: "DM privada decole" },
              },
            ],
          },
        },
      },
    },
    superare: {
      credentials: { meta_access_token_env: "META_SYSTEM_USER_ACCESS_TOKEN_SUPERARE" },
      products: {
        SUPERARE_CURSO_X: {
          commentAutomation: {
            responderProvider: { facebook: "meta", instagram: "meta" },
            rules: [
              {
                id: "superare_curso",
                keyword: "curso",
                matchType: "contains",
                caseSensitive: false,
                platforms: ["facebook", "instagram"],
                publicReply: { enabled: true, text: "Resposta pública superare" },
                privateReply: { enabled: false, text: "" },
              },
            ],
          },
        },
      },
    },
  },
};

function makeKVStub() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

function makeEnv(overrides: Record<string, unknown> = {}): DispatcherEnv {
  return {
    SOCIAL_DEDUPE_KV: makeKVStub(),
    CATALOG_JSON: JSON.stringify(CATALOG),
    META_SYSTEM_USER_ACCESS_TOKEN_DECOLE: ACCESS_TOKEN_DECOLE,
    META_SYSTEM_USER_ACCESS_TOKEN_SUPERARE: ACCESS_TOKEN_SUPERARE,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<SocialCommentEvent> = {}): SocialCommentEvent {
  return {
    event_id: "facebook_comment_1",
    event_type: "SOCIAL_COMMENT_RECEIVED",
    tenant_id: "decole",
    product_code: "DECOLE_PLANOVOO",
    platform: "facebook",
    comment_id: "comment_1",
    text: "tradução",
    from_id: "user_1",
    account_id: "page_1",
    occurred_at: new Date().toISOString(),
    payload: {},
    ...overrides,
  };
}

function okResponse(body: unknown = { access_token: "test_page_tok" }): Response {
  const json = JSON.stringify(body);
  return { ok: true, status: 200, text: async () => json, json: async () => body } as unknown as Response;
}

function errorResponse(): Response {
  return { ok: false, status: 500, text: async () => "graph_api_error" } as unknown as Response;
}

describe("social-dispatcher", () => {
  afterEach(() => {
    clearSecretCache();
    vi.unstubAllGlobals();
  });

  it("9. retorna health", async () => {
    const res = await worker.fetch(new Request("https://x/health"));
    expect(res.status).toBe(200);
  });

  it("10. evento sem rule match não chama fetch", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await worker.queue({ messages: [{ body: makeEvent({ text: "oi, tudo bem?" }) }] }, makeEnv());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("11. publicReply e privateReply habilitados chamam fetch 2x e marcam dedup 2x", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();

    await worker.queue({ messages: [{ body: makeEvent() }] }, env);

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 page token + 1 reply + 1 DM
    expect((env.SOCIAL_DEDUPE_KV as ReturnType<typeof makeKVStub>).put).toHaveBeenCalledTimes(2);
  });

  it("12. dedup real via KV: mesmo evento reenviado 2x não duplica chamadas de fetch", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();
    const event = makeEvent();

    await worker.queue({ messages: [{ body: event }] }, env);
    await worker.queue({ messages: [{ body: event }] }, env);

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 page token + 1 reply + 1 DM; 2nd queue skipped by dedup
  });

  it("13. publicReply desabilitado e privateReply habilitado só chama fetch 1x", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const catalog = structuredClone(CATALOG);
    catalog.tenants.decole.products.DECOLE_PLANOVOO.commentAutomation.rules[0].publicReply.enabled = false;
    const env = makeEnv({ CATALOG_JSON: JSON.stringify(catalog) });

    await worker.queue({ messages: [{ body: makeEvent() }] }, env);

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 page token + 1 DM
    const [url] = fetchMock.mock.calls[1] as [string];
    expect(url).toContain("/private_replies");
  });

  it("14. mensagem inválida no batch é ignorada sem afetar as outras", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();

    await worker.queue(
      {
        messages: [{ body: { not: "a valid event" } }, { body: makeEvent() }],
      },
      env
    );

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 page token + 1 reply + 1 DM (invalid msg skipped)
  });

  it("15. falha em reply_to_comment não impede send_private_reply, mas propaga erro com dedup assimétrico", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/comments")) return errorResponse();
      return okResponse();
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();

    await expect(worker.queue({ messages: [{ body: makeEvent() }] }, env)).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 page token + 1 reply (error) + 1 DM (ok)
    const kv = env.SOCIAL_DEDUPE_KV as ReturnType<typeof makeKVStub>;
    const putKeys = kv.put.mock.calls.map((call) => call[0]);
    expect(putKeys.some((k) => String(k).includes("send_private_reply"))).toBe(true);
    expect(putKeys.some((k) => String(k).includes("reply_to_comment"))).toBe(false);
  });

  it("16. regra casada com publicReply e privateReply ambos desabilitados não chama fetch", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const catalog = structuredClone(CATALOG);
    catalog.tenants.decole.products.DECOLE_PLANOVOO.commentAutomation.rules[0].publicReply.enabled = false;
    catalog.tenants.decole.products.DECOLE_PLANOVOO.commentAutomation.rules[0].privateReply.enabled = false;
    const env = makeEnv({ CATALOG_JSON: JSON.stringify(catalog) });

    await worker.queue({ messages: [{ body: makeEvent() }] }, env);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("17. SOCIAL_DEDUPE_KV ausente lança erro de configuração sem chamar fetch", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv({ SOCIAL_DEDUPE_KV: undefined });

    await expect(worker.queue({ messages: [{ body: makeEvent() }] }, env)).rejects.toThrow(
      /social_dedupe_kv_not_configured/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("18. loga matched/executed/skipped tanto no sucesso quanto no erro, antes de relançar", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const fetchOk = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchOk);
    await worker.queue({ messages: [{ body: makeEvent({ event_id: "evt-ok" }) }] }, makeEnv());
    const successLog = logSpy.mock.calls.find((call) => String(call[0]).includes('"stage":"processed"'));
    expect(successLog).toBeDefined();
    expect(String(successLog?.[0])).toContain('"executed":["reply_to_comment","send_private_reply"]');

    logSpy.mockClear();
    const fetchFail = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("/comments") ? errorResponse() : okResponse()
    );
    vi.stubGlobal("fetch", fetchFail);
    await expect(
      worker.queue({ messages: [{ body: makeEvent({ event_id: "evt-error" }) }] }, makeEnv())
    ).rejects.toThrow();
    const errorLog = logSpy.mock.calls.find((call) => String(call[0]).includes('"stage":"error"'));
    expect(errorLog).toBeDefined();
    expect(String(errorLog?.[0])).toContain('"matched":true');

    logSpy.mockRestore();
  });

  it("19. batch com 2 mensagens válidas de comment_id diferentes deduplica de forma independente", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();

    await worker.queue(
      {
        messages: [
          { body: makeEvent({ event_id: "evt-a", comment_id: "comment_a" }) },
          { body: makeEvent({ event_id: "evt-b", comment_id: "comment_b" }) },
        ],
      },
      env
    );

    // Slice 7: cada evento constrói seu próprio MetaGraphSocialResponder
    // (cache de page token por instância, não mais módulo-level) — evt-b
    // não reaproveita o token buscado por evt-a, mesmo mesma página.
    expect(fetchMock).toHaveBeenCalledTimes(6); // evt-a: 1 page tok + 1 reply + 1 DM; evt-b: 1 page tok + 1 reply + 1 DM
    const kv = env.SOCIAL_DEDUPE_KV as ReturnType<typeof makeKVStub>;
    expect(kv.put).toHaveBeenCalledTimes(4);
  });

  it("21. provider zernio usa o accountId interno da Zernio (socialAccounts.*.zernioAccountId), não o account_id bruto do Meta", async () => {
    const catalog = structuredClone(CATALOG);
    catalog.tenants.decole.products.DECOLE_PLANOVOO.commentAutomation.responderProvider = {
      facebook: "zernio",
      instagram: "zernio",
    };
    (catalog.tenants.decole as Record<string, unknown>).socialAccounts = {
      instagramBusinessAccounts: {
        ig_meta_account_raw: { productCodes: ["DECOLE_PLANOVOO"], zernioAccountId: "zernio_internal_acc_id" },
      },
    };
    (catalog.tenants.decole.credentials as Record<string, unknown>).zernio_api_key_env = "ZERNIO_API_KEY_DECOLE";

    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return okResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    await worker.queue(
      {
        messages: [
          {
            body: makeEvent({
              platform: "instagram",
              account_id: "ig_meta_account_raw",
              post_id: "media_1",
            }),
          },
        ],
      },
      makeEnv({ CATALOG_JSON: JSON.stringify(catalog), ZERNIO_API_KEY_DECOLE: "zernio-key-decole" })
    );

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 reply + 1 DM, sem troca de page token (Zernio não usa)
    for (const body of bodies) {
      const parsed = JSON.parse(body) as { accountId: string };
      expect(parsed.accountId).toBe("zernio_internal_acc_id");
      expect(parsed.accountId).not.toBe("ig_meta_account_raw");
    }
  });

  it("22. provider zernio sem zernioAccountId mapeado falha fail-fast, sem chamar fetch", async () => {
    const catalog = structuredClone(CATALOG);
    catalog.tenants.decole.products.DECOLE_PLANOVOO.commentAutomation.responderProvider = {
      facebook: "zernio",
      instagram: "zernio",
    };
    // socialAccounts ausente de propósito — conta ainda não conectada na Zernio
    (catalog.tenants.decole.credentials as Record<string, unknown>).zernio_api_key_env = "ZERNIO_API_KEY_DECOLE";

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      worker.queue(
        {
          messages: [{ body: makeEvent({ platform: "instagram", account_id: "ig_meta_account_raw" }) }],
        },
        makeEnv({ CATALOG_JSON: JSON.stringify(catalog), ZERNIO_API_KEY_DECOLE: "zernio-key-decole" })
      )
    ).rejects.toThrow(/zernioAccountId/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("20. isolamento entre tenants: cada evento usa o access_token do seu próprio tenant", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv();

    await worker.queue(
      {
        messages: [
          { body: makeEvent({ event_id: "evt-decole", tenant_id: "decole", product_code: "DECOLE_PLANOVOO" }) },
          {
            body: makeEvent({
              event_id: "evt-superare",
              tenant_id: "superare",
              product_code: "SUPERARE_CURSO_X",
              comment_id: "comment_superare",
              text: "curso",
            }),
          },
        ],
      },
      env
    );

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.includes(`access_token=${ACCESS_TOKEN_DECOLE}`))).toBe(true);
    expect(urls.some((u) => u.includes(`access_token=${ACCESS_TOKEN_SUPERARE}`))).toBe(true);
  });
});
