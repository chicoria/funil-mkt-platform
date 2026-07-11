import type { SocialPlatform } from "./social-comment-event";

/**
 * Requisição para responder a um comentário (reply público ou DM privada).
 * `postId` é opcional aqui (nem toda implementação precisa dele — Meta
 * Graph API só usa `commentId`), mas é obrigatório para implementações
 * que operam por post (ex.: Zernio) — essas devem validar/lançar erro
 * explícito se ausente.
 */
export interface SocialResponderRequest {
  platform: SocialPlatform;
  postId?: string;
  commentId: string;
  accountId: string;
  message: string;
}

/**
 * Abstrai o envio de reply público e DM privado em resposta a um
 * comentário, independente do provider (Meta Graph API direta, Zernio,
 * etc.). Duas implementações concretas: MetaGraphSocialResponder e
 * ZernioSocialResponder.
 */
export interface SocialCommentResponder {
  replyToComment(request: SocialResponderRequest): Promise<void>;
  sendPrivateReply(request: SocialResponderRequest): Promise<void>;
}
