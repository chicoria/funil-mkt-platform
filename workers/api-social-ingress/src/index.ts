import { fromMetaWebhookPayload, type ResolveProductCode } from "../../../packages/shared/src/meta-webhook-normalizer";
import { resolveProductCodeForSocialAccount, type CommentAutomationCatalog } from "../../../packages/shared/src/comment-automation";
import { resolveSecret, type SecretValue } from "../../../packages/shared/src/secrets-store-wrapper";
import { tryResolveTenantIdFromHostname } from "../../../packages/shared/src/tenant-from-hostname";
import { type CatalogV5 } from "../../../packages/shared/src/catalog-v5";
import bundledCatalog from "../../../config/products.catalog.json";

interface QueueBinding {
  send(message: unknown): Promise<void>;
}

interface Env {
  SOCIAL_EVENTS?: QueueBinding;
  CATALOG_JSON?: string;
  [key: string]: unknown;
}

interface TenantSocialCredentialsConfig {
  meta_app_secret_env?: string;
  meta_webhook_verify_token_env?: string;
}

interface TenantWithSocialCredentials {
  credentials?: TenantSocialCredentialsConfig;
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

function logIngress(data: Record<string, unknown>): void {
  console.log(JSON.stringify({ worker: "api-social-ingress", ...data }));
}

function getCatalog(env: Env): CatalogV5 {
  const raw = asString(env.CATALOG_JSON);
  if (!raw) return bundledCatalog as CatalogV5;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as CatalogV5;
    }
  } catch {
    logIngress({ stage: "warn", error: "catalog_json_invalid" });
  }
  return bundledCatalog as CatalogV5;
}

async function resolveTenantSocialSecret(
  env: Env,
  catalog: CatalogV5,
  tenantId: string,
  field: "meta_app_secret_env" | "meta_webhook_verify_token_env"
): Promise<string> {
  const tenant = catalog.tenants?.[tenantId] as TenantWithSocialCredentials | undefined;
  const envName = asString(tenant?.credentials?.[field]);
  if (!envName) {
    throw new Error(`missing tenant.credentials.${field} for tenant ${tenantId}`);
  }
  return resolveSecret(env[envName] as SecretValue, envName);
}

async function verifyMetaSignature(rawBody: string, secret: string, header: string): Promise<boolean> {
  if (!header.startsWith("sha256=")) return false;
  const expectedHex = header.slice("sha256=".length).toLowerCase();
  if (!expectedHex || !/^[0-9a-f]+$/.test(expectedHex)) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const computedHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return computedHex === expectedHex;
}

function handleSecretError(err: unknown, pathname: string, hostname: string, tenantId: string): Response {
  logIngress({
    stage: "error",
    pathname,
    hostname,
    tenant_id: tenantId,
    error: "secret_misconfigured",
    detail: err instanceof Error ? err.message : String(err),
    status: 500,
  });
  return jsonResponse({ ok: false, error: "secret_misconfigured" }, 500);
}

async function handleHandshake(request: Request, env: Env, catalog: CatalogV5, hostname: string, pathname: string): Promise<Response> {
  const url = new URL(request.url);
  const mode = asString(url.searchParams.get("hub.mode"));
  const verifyToken = asString(url.searchParams.get("hub.verify_token"));
  const challenge = asString(url.searchParams.get("hub.challenge"));

  const tenantId = tryResolveTenantIdFromHostname(hostname, catalog);
  if (!tenantId) {
    logIngress({ stage: "blocked", pathname, hostname, error: "forbidden", status: 403 });
    return jsonResponse({ ok: false, error: "forbidden" }, 403);
  }

  let requiredToken: string;
  try {
    requiredToken = await resolveTenantSocialSecret(env, catalog, tenantId, "meta_webhook_verify_token_env");
  } catch (err) {
    return handleSecretError(err, pathname, hostname, tenantId);
  }

  if (mode !== "subscribe" || verifyToken !== requiredToken) {
    logIngress({ stage: "blocked", pathname, hostname, tenant_id: tenantId, error: "forbidden", status: 403 });
    return jsonResponse({ ok: false, error: "forbidden" }, 403);
  }

  logIngress({ stage: "handshake_ok", pathname, hostname, tenant_id: tenantId, status: 200 });
  return textResponse(challenge, 200);
}

async function handleIncomingEvents(
  request: Request,
  env: Env,
  catalog: CatalogV5,
  hostname: string,
  pathname: string
): Promise<Response> {
  const tenantId = tryResolveTenantIdFromHostname(hostname, catalog);
  if (!tenantId) {
    logIngress({ stage: "blocked", pathname, hostname, error: "unknown_tenant", status: 400 });
    return jsonResponse({ ok: false, error: "unknown_tenant" }, 400);
  }

  let appSecret: string;
  try {
    appSecret = await resolveTenantSocialSecret(env, catalog, tenantId, "meta_app_secret_env");
  } catch (err) {
    return handleSecretError(err, pathname, hostname, tenantId);
  }

  const rawBody = await request.text();
  const signatureHeader = asString(request.headers.get("x-hub-signature-256"));
  const signatureValid = signatureHeader ? await verifyMetaSignature(rawBody, appSecret, signatureHeader) : false;
  if (!signatureValid) {
    logIngress({ stage: "blocked", pathname, hostname, tenant_id: tenantId, error: "invalid_signature", status: 401 });
    return jsonResponse({ ok: false, error: "invalid_signature" }, 401);
  }

  if (!env.SOCIAL_EVENTS) {
    logIngress({ stage: "error", pathname, hostname, tenant_id: tenantId, error: "queue_not_configured", status: 500 });
    return jsonResponse({ ok: false, error: "queue_not_configured" }, 500);
  }

  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = null;
  }

  const resolveProductCode: ResolveProductCode = (platform, accountId) => {
    const resolutions = resolveProductCodeForSocialAccount(
      catalog as unknown as CommentAutomationCatalog,
      platform,
      accountId
    );
    // Escopa ao tenant já autenticado por hostname+HMAC. resolveProductCodeForSocialAccount
    // varre todos os tenants do catalog (decisão do Slice 2) — sem este check, um account_id
    // duplicado/mal-cadastrado em outro tenant atribuiria o evento ao tenant errado mesmo com
    // a assinatura validada corretamente para o tenant autenticado (achado do Code Quality Review).
    return resolutions.filter((r) => r.tenantId === tenantId);
  };

  const events = fromMetaWebhookPayload(payload, resolveProductCode);

  for (const event of events) {
    await env.SOCIAL_EVENTS.send(event);
  }

  logIngress({
    stage: "queued",
    pathname,
    hostname,
    tenant_id: tenantId,
    status: 200,
    enqueued: events.length,
  });

  return jsonResponse({ ok: true, enqueued: events.length }, 200);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname, hostname } = new URL(request.url);

    if (pathname === "/health") {
      return jsonResponse({ ok: true, worker: "api-social-ingress" }, 200);
    }

    if (pathname !== "/webhooks/v1/meta") {
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }

    const catalog = getCatalog(env);

    if (request.method === "GET") {
      return handleHandshake(request, env, catalog, hostname, pathname);
    }

    if (request.method !== "POST") {
      logIngress({ stage: "error", pathname, hostname, error: "method_not_allowed", status: 405 });
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
    }

    return handleIncomingEvents(request, env, catalog, hostname, pathname);
  },
};
