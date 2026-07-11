import type { SocialCommentEvent } from "../../../../packages/shared/src/social-comment-event";
import { resolveReplyText, type CommentAutomationRule } from "../../../../packages/shared/src/comment-automation";
import type { SocialCommentResponder } from "../../../../packages/shared/src/social-respond";

export async function replyToCommentHandler(
  event: SocialCommentEvent,
  rule: CommentAutomationRule,
  responder: SocialCommentResponder,
  accountId: string
): Promise<void> {
  await responder.replyToComment({
    platform: event.platform,
    postId: event.post_id,
    commentId: event.comment_id,
    accountId,
    message: rule.publicReply ? resolveReplyText(rule.publicReply, event.platform) : "",
  });
}

export async function sendPrivateReplyHandler(
  event: SocialCommentEvent,
  rule: CommentAutomationRule,
  responder: SocialCommentResponder,
  accountId: string
): Promise<void> {
  await responder.sendPrivateReply({
    platform: event.platform,
    postId: event.post_id,
    commentId: event.comment_id,
    accountId,
    message: rule.privateReply ? resolveReplyText(rule.privateReply, event.platform) : "",
  });
}
