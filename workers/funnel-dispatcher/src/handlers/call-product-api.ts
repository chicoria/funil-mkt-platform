import { HandlerContext } from "../handler-context";
import { mapValue } from "../payload-mapper";
import { resolveSecret, type SecretValue } from "../../../../packages/shared/src/secrets-store-wrapper";

export interface ProductApiConfig {
  url?: string;
  url_env?: string;
  path?: string;
  method: string;
  hmac_secret_env: string;
  request_mapping: Record<string, string>;
  response_key?: string;
  skip_if_missing?: string[];
}

async function signHmac(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

function mapEventPayload(ctx: HandlerContext, mapping: Record<string, string>): Record<string, unknown> {
  const safeEventFields = { lead: ctx.event.lead };
  const result: Record<string, unknown> = {};
  for (const [key, expr] of Object.entries(mapping)) {
    const payloadValue = mapValue(ctx.event.payload, expr);
    const value = payloadValue !== null ? payloadValue : mapValue(safeEventFields, expr);
    if (value !== null) {
      result[key] = value;
    }
  }
  return result;
}

async function resolveConfiguredEnvString(ctx: HandlerContext, envName: string | undefined, label: string): Promise<string> {
  const fallbackField = label === "url" ? "product_api.url_env" : "product_api.hmac_secret_env";
  if (!envName) {
    throw new Error(`call_product_api: missing ${label} env var ${fallbackField}`);
  }
  try {
    return await resolveSecret(ctx.env[envName] as SecretValue, envName);
  } catch (err) {
    throw new Error(
      `call_product_api: missing ${label} env var ${envName}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function resolveProductApiUrl(ctx: HandlerContext, config: ProductApiConfig): Promise<string> {
  if (config.url) return config.url;

  const baseUrl = (await resolveConfiguredEnvString(ctx, config.url_env, "url")).replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error(
      `call_product_api: missing url or env var ${config.url_env || "product_api.url_env"}`
    );
  }

  const path = config.path || "";
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function callProductApi(
  ctx: HandlerContext,
  config: ProductApiConfig,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const secret = await resolveConfiguredEnvString(ctx, config.hmac_secret_env, "hmac secret");

  const mapped = mapEventPayload(ctx, config.request_mapping);
  const missing = (config.skip_if_missing || []).filter((key) => {
    const value = mapped[key];
    return value === undefined || value === null || value === "";
  });
  if (missing.length) {
    console.log(
      JSON.stringify({
        stage: "handler_skip",
        handler: "call_product_api",
        reason: "missing_required_mapping",
        missing,
        event_id: ctx.event.event_id,
        tenant: ctx.tenant_id,
      })
    );
    return;
  }

  const body = JSON.stringify(mapped);
  const signature = await signHmac(body, secret);
  const url = await resolveProductApiUrl(ctx, config);

  const response = await fetchImpl(url, {
    method: config.method,
    headers: {
      "content-type": "application/json",
      "x-signature": signature,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Product API error: ${response.status} ${response.statusText} — ${errorText}`
    );
  }

  const result = (await response.json()) as Record<string, unknown>;
  ctx.set("api_response", result);

  if (config.response_key) {
    const value = result[config.response_key];
    if (value !== undefined) {
      ctx.set("api_response_key", value);
    }
  }

  console.log(
    JSON.stringify({
      stage: "handler_ok",
      handler: "call_product_api",
      event_id: ctx.event.event_id,
      tenant: ctx.tenant_id,
    })
  );
}
