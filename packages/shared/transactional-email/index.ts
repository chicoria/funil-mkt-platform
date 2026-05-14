export type TransactionalEmailParams = Record<string, unknown>;

export type TransactionalEmailRecipient = {
  email: string;
  name?: string;
};

export type TransactionalEmailReplyTo = {
  email: string;
  name?: string;
};

export type TransactionalEmailRequest = {
  to: TransactionalEmailRecipient;
  replyTo?: TransactionalEmailReplyTo;
  templateId: number;
  params?: TransactionalEmailParams;
};

export interface TransactionalEmailSender {
  send(request: TransactionalEmailRequest): Promise<void>;
}

export interface BrevoTransactionalEmailSenderOptions {
  // URL base da API Brevo. Util para sandbox ou testes de integracao.
  // Padrao: "https://api.brevo.com/v3"
  baseUrl?: string;
  // Timeout em ms para a requisicao HTTP. Padrao: 10000 (10s).
  timeoutMs?: number;
}

const BREVO_DEFAULT_BASE_URL = "https://api.brevo.com/v3";
const BREVO_DEFAULT_TIMEOUT_MS = 10_000;

export class BrevoTransactionalEmailSender implements TransactionalEmailSender {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string,
    fetchImpl: typeof fetch = fetch,
    options?: BrevoTransactionalEmailSenderOptions
  ) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.baseUrl = (options?.baseUrl ?? BREVO_DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options?.timeoutMs ?? BREVO_DEFAULT_TIMEOUT_MS;
  }

  async send(request: TransactionalEmailRequest): Promise<void> {
    const { to, replyTo, templateId, params } = request;
    if (!this.apiKey) {
      throw new Error("BREVO_API_KEY not configured");
    }
    if (!templateId) {
      throw new Error("Brevo templateId not configured");
    }
    if (!to?.email) {
      throw new Error("Recipient email is required");
    }

    const payload = {
      to: [
        {
          email: to.email,
          ...(to.name ? { name: to.name } : {}),
        },
      ],
      ...(replyTo?.email
        ? {
            replyTo: {
              email: replyTo.email,
              ...(replyTo.name ? { name: replyTo.name } : {}),
            },
          }
        : {}),
      templateId,
      params: params ?? {},
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl.call(globalThis, `${this.baseUrl}/smtp/email`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "api-key": this.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `Brevo transactional email failed (${response.status}): ${detail.slice(0, 200)}`
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
