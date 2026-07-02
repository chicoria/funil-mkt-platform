import { SocialPlatform } from "./social-comment-event";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const ERROR_BODY_MAX_LENGTH = 300;

export interface SocialSendRequest {
  platform: SocialPlatform;
  commentId: string;
  message: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export type CommentReplyRequest = SocialSendRequest;
export type DirectMessageRequest = SocialSendRequest;

async function readErrorBody(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return body.slice(0, ERROR_BODY_MAX_LENGTH);
}

async function postToCommentEdge(edge: "comments" | "private_replies", req: SocialSendRequest): Promise<void> {
  const fetchImpl = req.fetchImpl ?? fetch;
  const url = `${GRAPH_API_BASE}/${req.commentId}/${edge}?access_token=${req.accessToken}`;

  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: req.message }),
  });

  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new Error(`Meta Graph API ${edge} failed (${response.status}): ${body}`);
  }

  console.log(
    JSON.stringify({
      stage: "social_send_ok",
      edge,
      platform: req.platform,
      comment_id: req.commentId,
    })
  );
}

/** Resposta pública a um comentário. Facebook: /comments. Instagram: /replies. */
export async function replyToComment(req: CommentReplyRequest): Promise<void> {
  const edge = req.platform === "instagram" ? "replies" : "comments";
  await postToCommentEdge(edge, req);
}

/**
 * DM privada em resposta a um comentário — mesmo endpoint para Facebook e
 * Instagram (achado de pesquisa, ver Slice 3). `platform` é usado só para
 * log/erro, não há switch de implementação por plataforma.
 *
 * WhatsApp (futuro): endpoint e payload diferentes (Cloud API,
 * /{phone_number_id}/messages) — implementar como nova função respeitando
 * o mesmo contrato de SocialSendRequest quando esse canal entrar, sem
 * alterar esta função.
 */
export async function sendDirectMessage(req: DirectMessageRequest): Promise<void> {
  await postToCommentEdge("private_replies", req);
}
