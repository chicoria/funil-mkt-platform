import { replyToComment, sendDirectMessage } from "./social-send";
import type { SocialCommentResponder, SocialResponderRequest } from "./social-respond";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Implementação de SocialCommentResponder via Meta Graph API direta.
 *
 * Comportamento preservado do código anterior (antes vivia inline em
 * reply-handlers.ts): páginas Facebook NPE (New Page Experience) rejeitam
 * o System User Token — precisa trocar por um Page Access Token via
 * `GET /{pageId}?fields=access_token`. Instagram usa o system token
 * diretamente. Cache de page token por instância (não módulo-level como
 * antes) — cada MetaGraphSocialResponder construído tem seu próprio cache.
 */
export class MetaGraphSocialResponder implements SocialCommentResponder {
  private readonly pageTokenCache = new Map<string, string>();

  constructor(
    private readonly systemAccessToken: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async getPageAccessToken(pageId: string): Promise<string> {
    const cacheKey = `${pageId}:${this.systemAccessToken.slice(-8)}`;
    const cached = this.pageTokenCache.get(cacheKey);
    if (cached) return cached;

    const url = `${GRAPH}/${pageId}?fields=access_token&access_token=${this.systemAccessToken}`;
    // Extrair pra variável local antes de chamar — `this.fetchImpl(url)` (method
    // call syntax) quebra o `fetch` nativo do Cloudflare Workers com
    // "Illegal invocation" (perde o `this` binding interno que o runtime exige).
    const fetchImpl = this.fetchImpl;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Failed to get page access token for ${pageId}: ${await res.text()}`);
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) throw new Error(`No page access token returned for page ${pageId}`);
    this.pageTokenCache.set(cacheKey, data.access_token);
    return data.access_token;
  }

  private async resolveAccessToken(request: SocialResponderRequest): Promise<string> {
    // NPE (New Page Experience) pages rejeitam System User Tokens — troca por Page Access Token
    if (request.platform === "facebook" && request.accountId) {
      return this.getPageAccessToken(request.accountId);
    }
    return this.systemAccessToken;
  }

  async replyToComment(request: SocialResponderRequest): Promise<void> {
    const accessToken = await this.resolveAccessToken(request);
    await replyToComment({
      platform: request.platform,
      commentId: request.commentId,
      message: request.message,
      accessToken,
      fetchImpl: this.fetchImpl,
    });
  }

  async sendPrivateReply(request: SocialResponderRequest): Promise<void> {
    const accessToken = await this.resolveAccessToken(request);
    await sendDirectMessage({
      platform: request.platform,
      commentId: request.commentId,
      message: request.message,
      accessToken,
      fetchImpl: this.fetchImpl,
    });
  }
}
