import { HandlerContext } from "../handler-context";
import { mapPayload } from "../payload-mapper";

export interface ProductApiConfig {
  url: string;
  method: string;
  hmac_secret_env: string;
  request_mapping: Record<string, string>;
  response_key?: string;
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

export async function callProductApi(
  ctx: HandlerContext,
  config: ProductApiConfig,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const secret = ctx.env[config.hmac_secret_env];
  if (typeof secret !== "string" || !secret) {
    throw new Error(`call_product_api: missing env var ${config.hmac_secret_env}`);
  }

  const mapped = mapPayload(ctx.event.payload, config.request_mapping);
  const body = JSON.stringify(mapped);
  const signature = await signHmac(body, secret);

  const response = await fetchImpl(config.url, {
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
