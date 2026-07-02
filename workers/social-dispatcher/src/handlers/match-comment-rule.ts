import {
  matchCommentRule,
  resolveCommentAutomationRules,
  type CommentAutomationCatalog,
  type CommentAutomationRule,
} from "../../../../packages/shared/src/comment-automation";
import type { SocialCommentEvent } from "../../../../packages/shared/src/social-comment-event";
import type { DispatcherCatalog } from "../env";

export function matchCommentRuleForEvent(
  event: SocialCommentEvent,
  catalog: DispatcherCatalog
): CommentAutomationRule | null {
  const rules = resolveCommentAutomationRules(
    catalog as unknown as CommentAutomationCatalog,
    event.tenant_id,
    event.product_code
  );
  return matchCommentRule(event, rules);
}
