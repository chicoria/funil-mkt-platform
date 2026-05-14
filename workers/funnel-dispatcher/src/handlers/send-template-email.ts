import { HandlerContext } from "../handler-context";
import { mapValue, interpolate } from "../payload-mapper";
import {
  BrevoTransactionalEmailSender,
} from "../../../../packages/shared/transactional-email/index";

export interface TemplateEmailConfig {
  templateId: number;
  to_email: string;
  params_mapping: Record<string, string>;
}

function mapEventValue(ctx: HandlerContext, expr: string): unknown {
  const value = mapValue(ctx.event.payload, expr);
  if (value !== null) return value;
  return mapValue(ctx.event, expr);
}

export async function sendTemplateEmail(
  ctx: HandlerContext,
  config: TemplateEmailConfig,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const apiKey = ctx.credentials.brevoApiKey;
  if (!apiKey) {
    throw new Error("send_template_email: Brevo API key not configured for tenant " + ctx.tenant_id);
  }

  const toEmail = mapEventValue(ctx, config.to_email);
  if (!toEmail || typeof toEmail !== "string") {
    console.log(
      JSON.stringify({
        stage: "handler_skip",
        handler: "send_template_email",
        reason: "no_to_email",
        event_id: ctx.event.event_id,
      })
    );
    return;
  }

  const raw = ctx.get("api_response");
  const apiResponse =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const interpolationContext = { response: apiResponse };

  const params: Record<string, unknown> = {};
  for (const [key, expr] of Object.entries(config.params_mapping)) {
    if (expr.includes("{{") && !expr.startsWith("$.")) {
      params[key] = interpolate(expr, interpolationContext);
    } else {
      const value = mapEventValue(ctx, expr);
      if (value !== null) {
        params[key] = value;
      }
    }
  }

  const timeoutMs = Number(ctx.env.BREVO_TIMEOUT_MS);
  const baseUrl = typeof ctx.env.BREVO_BASE_URL === "string" ? ctx.env.BREVO_BASE_URL : "";
  const sender = new BrevoTransactionalEmailSender(apiKey, fetchImpl, {
    ...(baseUrl ? { baseUrl } : {}),
    ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
  });
  await sender.send({
    to: { email: toEmail },
    ...(ctx.credentials.replyToEmail
      ? { replyTo: { email: ctx.credentials.replyToEmail } }
      : {}),
    templateId: config.templateId,
    params,
  });

  console.log(
    JSON.stringify({
      stage: "handler_ok",
      handler: "send_template_email",
      event_id: ctx.event.event_id,
      tenant: ctx.tenant_id,
      templateId: config.templateId,
    })
  );
}
