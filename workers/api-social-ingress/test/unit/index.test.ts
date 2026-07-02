import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index";
import { clearSecretCache } from "../../../../packages/shared/src/secrets-store-wrapper";

const TEST_CATALOG = JSON.stringify({
  schemaVersion: 5,
  tenants: {
    decole: {
      domains: ["api.decolesuacarreiraesg.com.br"],
      credentials: {
        meta_app_secret_env: "META_APP_SECRET_DECOLE",
        meta_webhook_verify_token_env: "META_WEBHOOK_VERIFY_TOKEN_DECOLE",
      },
      socialAccounts: {
        facebookPages: { "483391978198375": { productCodes: ["DECOLE_PLANOVOO"] } },
        instagramBusinessAccounts: { "17841401638634396": { productCodes: ["DECOLE_PLANOVOO"] } },
      },
    },
    superare: {
      domains: ["api.superare.test"],
      credentials: {
        meta_app_secret_env: "META_APP_SECRET_SUPERARE",
        meta_webhook_verify_token_env: "META_WEBHOOK_VERIFY_TOKEN_SUPERARE",
      },
      socialAccounts: {
        facebookPages: { "999000111": { productCodes: ["SUPERARE_CURSO_X"] } },
      },
    },
  },
});

const DECOLE_HOST = "api.decolesuacarreiraesg.com.br";
const APP_SECRET = "app-secret-decole";
const VERIFY_TOKEN = "verify-token-decole";
const FB_PAGE_ID = "483391978198375";
const IG_ACCOUNT_ID = "17841401638634396";

function makeEnv(overrides: Record<string, unknown> = {}): any {
  return {
    SOCIAL_EVENTS: { send: vi.fn(async () => undefined) },
    CATALOG_JSON: TEST_CATALOG,
    META_APP_SECRET_DECOLE: APP_SECRET,
    META_WEBHOOK_VERIFY_TOKEN_DECOLE: VERIFY_TOKEN,
    ...overrides,
  };
}

async function signBody(body: string, secret = APP_SECRET): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

function facebookCommentPayload(opts: { commentId?: string; verb?: string; pageId?: string } = {}): unknown {
  return {
    object: "page",
    entry: [
      {
        id: opts.pageId ?? FB_PAGE_ID,
        changes: [
          {
            field: "feed",
            value: {
              item: "comment",
              verb: opts.verb ?? "add",
              comment_id: opts.commentId ?? "fb_comment_1",
              post_id: "post_1",
              message: "tradução",
              from: { id: "user_1", name: "Lead Teste" },
              created_time: 1750000000,
            },
          },
        ],
      },
    ],
  };
}

function instagramCommentPayload(opts: { commentId?: string; accountId?: string } = {}): unknown {
  return {
    object: "instagram",
    entry: [
      {
        id: opts.accountId ?? IG_ACCOUNT_ID,
        changes: [
          {
            field: "comments",
            value: {
              id: opts.commentId ?? "ig_comment_1",
              text: "tradução",
              from: { id: "user_2", username: "lead_ig" },
              media: { id: "media_1" },
            },
          },
        ],
      },
    ],
  };
}

async function responseJson(res: Response): Promise<{ error?: string; enqueued?: number }> {
  return (await res.json()) as { error?: string; enqueued?: number };
}

describe("api-social-ingress", () => {
  afterEach(() => {
    clearSecretCache();
    vi.clearAllMocks();
  });

  it("1. retorna health", async () => {
    const res = await worker.fetch(new Request("https://x/health", { method: "GET" }), makeEnv());
    expect(res.status).toBe(200);
  });

  it("2. handshake correto retorna o hub.challenge", async () => {
    const url = `https://${DECOLE_HOST}/webhooks/v1/meta?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=challenge-123`;
    const res = await worker.fetch(new Request(url, { method: "GET" }), makeEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("challenge-123");
  });

  it("3. handshake com verify_token errado retorna 403", async () => {
    const url = `https://${DECOLE_HOST}/webhooks/v1/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123`;
    const res = await worker.fetch(new Request(url, { method: "GET" }), makeEnv());
    expect(res.status).toBe(403);
  });

  it("4. handshake com hub.mode diferente de subscribe retorna 403", async () => {
    const url = `https://${DECOLE_HOST}/webhooks/v1/meta?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=challenge-123`;
    const res = await worker.fetch(new Request(url, { method: "GET" }), makeEnv());
    expect(res.status).toBe(403);
  });

  it("5. handshake em hostname desconhecido retorna 403", async () => {
    const url = `https://unknown.example.com/webhooks/v1/meta?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=challenge-123`;
    const res = await worker.fetch(new Request(url, { method: "GET" }), makeEnv());
    expect(res.status).toBe(403);
  });

  it("6. handshake com secret de verify_token ausente no catalog retorna 500", async () => {
    const url = `https://${DECOLE_HOST}/webhooks/v1/meta?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=challenge-123`;
    const res = await worker.fetch(
      new Request(url, { method: "GET" }),
      makeEnv({ META_WEBHOOK_VERIFY_TOKEN_DECOLE: undefined })
    );
    expect(res.status).toBe(500);
    expect(await responseJson(res)).toMatchObject({ error: "secret_misconfigured" });
  });

  it("7. POST com assinatura válida (Facebook) enfileira 1 evento", async () => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const body = JSON.stringify(facebookCommentPayload());
    const signature = await signBody(body);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: { send } }));
    expect(res.status).toBe(200);
    expect(await responseJson(res)).toMatchObject({ ok: true, enqueued: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    const event = send.mock.calls[0]?.[0] as { platform?: string; product_code?: string } | undefined;
    expect(event?.platform).toBe("facebook");
    expect(event?.product_code).toBe("DECOLE_PLANOVOO");
  });

  it("8. POST com assinatura válida (Instagram) enfileira 1 evento", async () => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const body = JSON.stringify(instagramCommentPayload());
    const signature = await signBody(body);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: { send } }));
    expect(res.status).toBe(200);
    expect(await responseJson(res)).toMatchObject({ ok: true, enqueued: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    const event = send.mock.calls[0]?.[0] as { platform?: string } | undefined;
    expect(event?.platform).toBe("instagram");
  });

  it("9. POST multi-entry enfileira 2 eventos", async () => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const payload = facebookCommentPayload({ commentId: "fb_comment_1" }) as { entry: unknown[] };
    const secondEntry = (facebookCommentPayload({ commentId: "fb_comment_2" }) as { entry: unknown[] }).entry[0];
    payload.entry.push(secondEntry);
    const body = JSON.stringify(payload);
    const signature = await signBody(body);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: { send } }));
    expect(res.status).toBe(200);
    expect(await responseJson(res)).toMatchObject({ ok: true, enqueued: 2 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("10. POST sem header de assinatura retorna 401", async () => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const body = JSON.stringify(facebookCommentPayload());
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, { method: "POST", body });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: { send } }));
    expect(res.status).toBe(401);
    expect(await responseJson(res)).toMatchObject({ error: "invalid_signature" });
    expect(send).not.toHaveBeenCalled();
  });

  it("11. POST com assinatura calculada com secret errado retorna 401", async () => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const body = JSON.stringify(facebookCommentPayload());
    const signature = await signBody(body, "wrong-secret");
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: { send } }));
    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it("12. POST em hostname desconhecido retorna 400 unknown_tenant", async () => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const body = JSON.stringify(facebookCommentPayload());
    const signature = await signBody(body);
    const req = new Request("https://unknown.example.com/webhooks/v1/meta", {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: { send } }));
    expect(res.status).toBe(400);
    expect(await responseJson(res)).toMatchObject({ error: "unknown_tenant" });
    expect(send).not.toHaveBeenCalled();
  });

  it("13. POST com app secret ausente no catalog retorna 500", async () => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const body = JSON.stringify(facebookCommentPayload());
    const signature = await signBody(body);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const res = await worker.fetch(
      req,
      makeEnv({ SOCIAL_EVENTS: { send }, META_APP_SECRET_DECOLE: undefined })
    );
    expect(res.status).toBe(500);
    expect(await responseJson(res)).toMatchObject({ error: "secret_misconfigured" });
    expect(send).not.toHaveBeenCalled();
  });

  it("14. POST com assinatura válida mas queue ausente retorna 500", async () => {
    const body = JSON.stringify(facebookCommentPayload());
    const signature = await signBody(body);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: undefined }));
    expect(res.status).toBe(500);
    expect(await responseJson(res)).toMatchObject({ error: "queue_not_configured" });
  });

  it("15. POST com verb=remove não enfileira nada", async () => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const body = JSON.stringify(facebookCommentPayload({ verb: "remove" }));
    const signature = await signBody(body);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: { send } }));
    expect(res.status).toBe(200);
    expect(await responseJson(res)).toMatchObject({ ok: true, enqueued: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("16. POST com account_id desconhecido não enfileira nada", async () => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const body = JSON.stringify(facebookCommentPayload({ pageId: "unknown_page_id" }));
    const signature = await signBody(body);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: { send } }));
    expect(res.status).toBe(200);
    expect(await responseJson(res)).toMatchObject({ ok: true, enqueued: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("16b. POST autenticado como decole com account_id cadastrado em outro tenant (superare) não enfileira nada — isolamento cruzado", async () => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const body = JSON.stringify(facebookCommentPayload({ pageId: "999000111" }));
    const signature = await signBody(body);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: { send } }));
    expect(res.status).toBe(200);
    expect(await responseJson(res)).toMatchObject({ ok: true, enqueued: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("17. método não suportado na rota do webhook retorna 405", async () => {
    const res = await worker.fetch(
      new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, { method: "PUT" }),
      makeEnv()
    );
    expect(res.status).toBe(405);
  });

  it("18. rota desconhecida retorna 404", async () => {
    const res = await worker.fetch(
      new Request(`https://${DECOLE_HOST}/webhooks/v1/outra-coisa`, { method: "POST" }),
      makeEnv()
    );
    expect(res.status).toBe(404);
  });

  it.each([
    ["sem prefixo sha256=", "not-a-valid-signature"],
    ["prefixo presente com hex inválido", "sha256=zzz-not-hex"],
    ["prefixo presente com valor vazio", "sha256="],
  ])("19. POST com assinatura malformada (%s) retorna 401 sem lançar exceção", async (_label, header) => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const body = JSON.stringify(facebookCommentPayload());
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, {
      method: "POST",
      headers: { "x-hub-signature-256": header },
      body,
    });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: { send } }));
    expect(res.status).toBe(401);
    expect(await responseJson(res)).toMatchObject({ error: "invalid_signature" });
    expect(send).not.toHaveBeenCalled();
  });

  it("20. POST com múltiplos changes no mesmo entry enfileira 2 eventos", async () => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const payload = facebookCommentPayload({ commentId: "fb_comment_1" }) as {
      entry: { changes: unknown[] }[];
    };
    const secondChange = (facebookCommentPayload({ commentId: "fb_comment_2" }) as {
      entry: { changes: unknown[] }[];
    }).entry[0].changes[0];
    payload.entry[0].changes.push(secondChange);
    const body = JSON.stringify(payload);
    const signature = await signBody(body);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: { send } }));
    expect(res.status).toBe(200);
    expect(await responseJson(res)).toMatchObject({ ok: true, enqueued: 2 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("21. POST com corpo vazio e assinatura válida retorna 200 enqueued:0", async () => {
    const send = vi.fn(async (_message: unknown) => undefined);
    const body = "";
    const signature = await signBody(body);
    const req = new Request(`https://${DECOLE_HOST}/webhooks/v1/meta`, {
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body,
    });

    const res = await worker.fetch(req, makeEnv({ SOCIAL_EVENTS: { send } }));
    expect(res.status).toBe(200);
    expect(await responseJson(res)).toMatchObject({ ok: true, enqueued: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("22. handshake correto com hub.challenge ausente retorna 200 corpo vazio", async () => {
    const url = `https://${DECOLE_HOST}/webhooks/v1/meta?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}`;
    const res = await worker.fetch(new Request(url, { method: "GET" }), makeEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});
