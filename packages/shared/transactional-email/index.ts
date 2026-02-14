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

export class BrevoTransactionalEmailSender implements TransactionalEmailSender {
  private apiKey: string;
  private fetchImpl: typeof fetch;

  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
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
      params: params || {},
    };

    const response = await this.fetchImpl.call(globalThis, "https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Brevo transactional email failed (${response.status}): ${detail.slice(0, 500)}`);
    }
  }
}
