import { describe, expect, it, vi } from "vitest";
import { BrevoTransactionalEmailSender } from "../../transactional-email/index";

describe("BrevoTransactionalEmailSender", () => {
  it("envia payload correto para o Brevo", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    const sender = new BrevoTransactionalEmailSender("api-key", fetchMock);

    await sender.send({
      to: { email: "lead@exemplo.com", name: "Lead" },
      replyTo: { email: "contato@decolesuacarreiraesg.com.br", name: "DECOLE" },
      templateId: 8,
      params: { productName: "DECOLE" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({
      "content-type": "application/json",
      "api-key": "api-key",
    });
    const body = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
    expect(body).toEqual({
      to: [{ email: "lead@exemplo.com", name: "Lead" }],
      replyTo: { email: "contato@decolesuacarreiraesg.com.br", name: "DECOLE" },
      templateId: 8,
      params: { productName: "DECOLE" },
    });
  });

  it("omite nome do destinatario quando nao informado", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    const sender = new BrevoTransactionalEmailSender("api-key", fetchMock);

    await sender.send({
      to: { email: "lead@exemplo.com" },
      templateId: 8,
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body || "{}")) as Record<string, unknown>;
    expect(body).toEqual({
      to: [{ email: "lead@exemplo.com" }],
      templateId: 8,
      params: {},
    });
  });

  it("falha sem api key", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    const sender = new BrevoTransactionalEmailSender("", fetchMock);

    await expect(
      sender.send({
        to: { email: "lead@exemplo.com" },
        templateId: 8,
      })
    ).rejects.toThrow(/BREVO_API_KEY/);
  });

  it("falha sem templateId", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    const sender = new BrevoTransactionalEmailSender("api-key", fetchMock);

    await expect(
      sender.send({
        to: { email: "lead@exemplo.com" },
        templateId: 0,
      })
    ).rejects.toThrow(/templateId/);
  });

  it("falha sem email do destinatario", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    const sender = new BrevoTransactionalEmailSender("api-key", fetchMock);

    await expect(
      sender.send({
        to: { email: "" },
        templateId: 8,
      })
    ).rejects.toThrow(/Recipient email/);
  });

  it("propaga erro quando Brevo retorna falha", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => "bad_request",
    })) as unknown as typeof fetch;
    const sender = new BrevoTransactionalEmailSender("api-key", fetchMock);

    await expect(
      sender.send({
        to: { email: "lead@exemplo.com" },
        templateId: 8,
      })
    ).rejects.toThrow(/Brevo transactional email failed/);
  });
});
