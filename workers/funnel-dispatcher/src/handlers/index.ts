import { FunnelEvent } from "../../../../packages/shared/src/funnel-event";
import { DispatcherEnv, HandlerFn } from "../dispatcher";

const BREVO_BASE_URL = "https://api.brevo.com/v3";

type HandlerMap = Record<string, HandlerFn>;

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function unixTime(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

async function sha256Hex(value: string): Promise<string> {
  const input = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function eventToGa4Name(eventType: string): string {
  if (eventType === "PURCHASE_APPROVED") return "purchase";
  if (eventType === "GENERATE_LEAD" || eventType === "PRECHECKOUT_SUBMIT_SUCCESS") return "generate_lead";
  return eventType.toLowerCase();
}

function eventToMetaName(eventType: string): string {
  if (eventType === "PURCHASE_APPROVED") return "Purchase";
  if (eventType === "GENERATE_LEAD" || eventType === "PRECHECKOUT_SUBMIT_SUCCESS") return "Lead";
  return eventType;
}

function numberFromPayload(payload: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = payload[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

async function postJson(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`http_error:${response.status}:${body.slice(0, 300)}`);
  }
}

async function sendBrevoEmail(event: FunnelEvent, env: DispatcherEnv, templateIdRaw: string): Promise<void> {
  const apiKey = asString(env.BREVO_API_KEY);
  const email = asString(event.lead?.email);
  const templateId = Number(templateIdRaw);

  if (!apiKey || !email || !Number.isFinite(templateId) || templateId <= 0) {
    console.log(JSON.stringify({ stage: "handler_skip", handler: "brevo_email", reason: "missing_config_or_email" }));
    return;
  }

  const url = `${asString(env.BREVO_BASE_URL) || BREVO_BASE_URL}/smtp/email`;
  await postJson(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      to: [{ email }],
      templateId,
      params: {
        product_code: event.product_code,
        event_type: event.event_type,
      },
    }),
  });
}

async function updateBrevoFunnel(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  const apiKey = asString(env.BREVO_API_KEY);
  const email = asString(event.lead?.email);

  if (!apiKey || !email) {
    console.log(JSON.stringify({ stage: "handler_skip", handler: "update_brevo_funnel", reason: "missing_config_or_email" }));
    return;
  }

  const url = `${asString(env.BREVO_BASE_URL) || BREVO_BASE_URL}/contacts`;
  await postJson(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      email,
      attributes: {
        FUNNEL_LAST_STEP: event.event_type,
        FUNNEL_LAST_STEP_AT: event.occurred_at,
        PRODUCT_CODE: event.product_code,
      },
      updateEnabled: true,
    }),
  });
}

async function emitTracking(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  const payload = event.payload || {};
  const currency =
    asString(payload.currency) ||
    asString(payload.currency_code) ||
    asString(payload.currencyCode) ||
    "BRL";
  const value = numberFromPayload(payload, ["value", "amount", "price", "purchase_value", "total_value"]) ?? 0;

  const ga4MeasurementId = asString(env.GA4_MEASUREMENT_ID);
  const ga4Secret = asString(env.GA4_API_SECRET);

  if (ga4MeasurementId && ga4Secret) {
    const ga4Url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(ga4MeasurementId)}&api_secret=${encodeURIComponent(ga4Secret)}`;
    await postJson(ga4Url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: asString(event.identity?.anonymous_id) || event.event_id,
        events: [
          {
            name: eventToGa4Name(event.event_type),
            params: {
              event_id: event.event_id,
              product_code: event.product_code,
              source: event.source,
              currency,
              value,
            },
          },
        ],
      }),
    });
  }

  const pixelId = asString(env.META_PIXEL_ID);
  const metaToken = asString(env.META_CAPI_ACCESS_TOKEN);

  if (pixelId && metaToken) {
    const email = asString(event.lead?.email).toLowerCase();
    const userData: Record<string, string[]> = {};
    if (email) {
      userData.em = [await sha256Hex(email)];
    }

    const metaUrl = `https://graph.facebook.com/v20.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(metaToken)}`;
    const body: Record<string, unknown> = {
      data: [
        {
          event_name: eventToMetaName(event.event_type),
          event_time: unixTime(event.occurred_at),
          action_source: "website",
          event_id: event.event_id,
          user_data: userData,
          custom_data: {
            product_code: event.product_code,
            currency,
            value,
          },
        },
      ],
    };

    const testCode = asString(env.META_TEST_EVENT_CODE);
    if (testCode) {
      body.test_event_code = testCode;
    }

    await postJson(metaUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  if (!ga4MeasurementId && !pixelId) {
    console.log(JSON.stringify({ stage: "handler_skip", handler: "emit_tracking", reason: "missing_destinations" }));
  }
}

async function forwardN8n(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
  const webhookUrl = asString(env.N8N_WEBHOOK_URL);
  if (!webhookUrl) {
    console.log(JSON.stringify({ stage: "handler_skip", handler: "forward_n8n", reason: "missing_webhook" }));
    return;
  }

  await postJson(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
}

export function createHandlers(): HandlerMap {
  return {
    async resolve_identity(event: FunnelEvent): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "resolve_identity", event_id: event.event_id }));
    },

    async upsert_event_store(event: FunnelEvent): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "upsert_event_store", event_id: event.event_id }));
    },

    async send_brevo_doi(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "send_brevo_doi", event_id: event.event_id }));
      await sendBrevoEmail(event, env, asString(env.BREVO_DOI_TEMPLATE_ID));
    },

    async update_brevo_funnel(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "update_brevo_funnel", event_id: event.event_id }));
      await updateBrevoFunnel(event, env);
    },

    async send_cart_abandonment_email(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "send_cart_abandonment_email", event_id: event.event_id }));
      await sendBrevoEmail(
        event,
        env,
        asString(env.BREVO_CART_ABANDON_TEMPLATE_ID || env.BREVO_CART_ABANDONMENT_TEMPLATE_ID)
      );
    },

    async forward_n8n(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "forward_n8n", event_id: event.event_id }));
      await forwardN8n(event, env);
    },

    async emit_tracking(event: FunnelEvent, env: DispatcherEnv): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "emit_tracking", event_id: event.event_id }));
      await emitTracking(event, env);
    },

    async sync_brevo_segments(event: FunnelEvent): Promise<void> {
      console.log(JSON.stringify({ stage: "handler", handler: "sync_brevo_segments", event_id: event.event_id }));
    },
  };
}
