import type { SocialCommentResponder, SocialResponderRequest } from "./social-respond";

const ZERNIO_API_BASE = "https://api.zernio.com/v1";
const ERROR_BODY_MAX_LENGTH = 300;

async function readErrorBody(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return body.slice(0, ERROR_BODY_MAX_LENGTH);
}

function requirePostId(request: SocialResponderRequest): string {
  if (!request.postId) {
    throw new Error(
      `ZernioSocialResponder: postId is required (comment ${request.commentId}, platform ${request.platform})`
    );
  }
  return request.postId;
}

/**
 * Implementação de SocialCommentResponder via Zernio (Meta Marketing
 * Partner) — não depende do status de revisão da app Meta própria, então
 * funciona igual para qualquer usuário comentando, não só admins do
 * Business Manager (ao contrário do caminho Meta direto, ver
 * MetaGraphSocialResponder). Endpoints confirmados via docs.zernio.com,
 * `Inbox addon` (2026-07-10).
 *
 * Cada tenant deve ter sua própria Zernio API key/conta — a key é
 * resolvida pelo chamador (ver dispatcher.ts), nunca fixa no código.
 */
export class ZernioSocialResponder implements SocialCommentResponder {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async replyToComment(request: SocialResponderRequest): Promise<void> {
    const postId = requirePostId(request);
    const url = `${ZERNIO_API_BASE}/inbox/comments/${postId}`;

    // Extrair pra variável local antes de chamar — `this.fetchImpl(...)` (method
    // call syntax) quebra o `fetch` nativo do Cloudflare Workers com
    // "Illegal invocation" (perde o `this` binding interno que o runtime exige).
    const fetchImpl = this.fetchImpl;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        accountId: request.accountId,
        message: request.message,
        commentId: request.commentId,
      }),
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new Error(`Zernio reply to comment failed (${response.status}): ${body}`);
    }
  }

  async sendPrivateReply(request: SocialResponderRequest): Promise<void> {
    const postId = requirePostId(request);
    const url = `${ZERNIO_API_BASE}/inbox/comments/${postId}/${request.commentId}/private-reply`;

    const fetchImpl = this.fetchImpl;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        accountId: request.accountId,
        message: request.message,
      }),
    });

    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new Error(`Zernio send private reply failed (${response.status}): ${body}`);
    }
  }
}
