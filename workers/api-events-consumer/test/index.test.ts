import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

type Env = {
  BREVO_API_KEY?: string;
  BREVO_LIST_BEGIN_CHECKOUT?: string;
  BREVO_LIST_PURCHASE?: string;
};

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    BREVO_API_KEY: "brevo_key",
    BREVO_LIST_BEGIN_CHECKOUT: "11",
    BREVO_LIST_PURCHASE: "22",
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => "",
      } as unknown as Response;
    })
  );
});

describe("api-events-consumer", () => {
  it("retorna healthcheck", async () => {
    const req = new Request("https://worker.example/health", { method: "GET" });
    const res = await worker.fetch(req);
    expect(res.status).toBe(200);
  });

  it("processa begin_checkout e envia para lista mapeada", async () => {
    await worker.queue(
      {
        messages: [
          {
            body: {
              eventType: "begin_checkout",
              eventId: "evt-1",
              email: "aluna@exemplo.com",
            },
          },
        ],
      },
      makeEnv()
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/contacts");
    const body = JSON.parse(String(options.body || "{}")) as { listIds?: number[]; email?: string };
    expect(body.email).toBe("aluna@exemplo.com");
    expect(body.listIds?.[0]).toBe(11);
  });

  it("processa purchase e extrai email do payload", async () => {
    await worker.queue(
      {
        messages: [
          {
            body: {
              eventType: "purchase",
              payload: {
                buyer: {
                  email: "compradora@exemplo.com",
                },
              },
            },
          },
        ],
      },
      makeEnv()
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body || "{}")) as { email?: string; listIds?: number[] };
    expect(body.email).toBe("compradora@exemplo.com");
    expect(body.listIds?.[0]).toBe(22);
  });

  it("ignora evento nao mapeado", async () => {
    await worker.queue(
      {
        messages: [
          {
            body: {
              eventType: "cart_abandoned",
              email: "lead@exemplo.com",
            },
          },
        ],
      },
      makeEnv()
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falha quando API key nao esta configurada", async () => {
    await expect(
      worker.queue(
        {
          messages: [
            {
              body: {
                eventType: "purchase",
                email: "lead@exemplo.com",
              },
            },
          ],
        },
        makeEnv({ BREVO_API_KEY: "" })
      )
    ).rejects.toThrow(/BREVO_API_KEY/);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
