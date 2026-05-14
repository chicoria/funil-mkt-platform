/**
 * Handlers that call Plano de Voo HTTP APIs and send transactional emails.
 *
 * Responsibilities:
 *   1. Extract Hotmart payload from FunnelEvent
 *   2. Call Plano de Voo API (create token / update status) via HTTP + HMAC
 *   3. Send transactional email via Brevo
 *
 * These handlers are FATAL (no try/catch): errors propagate to the queue for retry.
 * The DEDUPE_KV ensures previously successful handlers don't re-execute.
 */

import type { FunnelEvent } from "../../../../packages/shared/src/funnel-event";
import type { DispatcherEnv } from "../dispatcher";
import {
  BrevoTransactionalEmailSender,
  type TransactionalEmailRequest,
} from "../../../../packages/shared/transactional-email/index";
import bundledCatalogJson from "../../../../config/products.catalog.json";

// ---------------------------------------------------------------------------
// Config — template IDs and URLs read from catalog.
// ---------------------------------------------------------------------------

interface PlanoVooEmailConfig {
  purchaseLinkTemplateId: number;
  refundedTemplateId: number;
  protestTemplateId: number;
  formBaseUrl: string;
  replyToEmail?: string;
  defaultProductName: string;
}

function resolveEmailConfig(env: DispatcherEnv, catalog: Record<string, unknown>): PlanoVooEmailConfig {
  const products = (catalog as any)?.products?.DECOLE_PLANOVOO;
  const tpls = products?.brevo?.templates;

  return {
    purchaseLinkTemplateId: Number(tpls?.purchaseLink?.id) || 12,
    refundedTemplateId:     Number(tpls?.refunded?.id)     || 13,
    protestTemplateId:      Number(tpls?.protest?.id)      || 14,
    formBaseUrl:            products?.app?.url || str(env.PLANOVOO_API_BASE_URL),
    replyToEmail:           (catalog as any)?.global?.brevo?.replyToEmail,
    defaultProductName:     products?.name || "Plano de Voo",
  };
}

// ---------------------------------------------------------------------------
// Helpers — payload extraction from Hotmart webhook
// ---------------------------------------------------------------------------

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function num(v: unknown): number | null { return typeof v === "number" ? v : null; }

/** Formata valor numérico como "R$ 1.234,56" */
function formatBRL(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Formata ISO date como "DD/MM/YYYY" no fuso de São Paulo */
function formatDateBR(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return iso.slice(0, 10);
  }
}

interface HotmartExtracted {
  email: string;
  nome: string;
  primeiroNome: string;
  transacao: string;
  produto: string;
  oferta: string;
  valor: number | null;
  valorFormatado: string;
  pagamento: string;
  dataFormatada: string;
}

/**
 * Extracts purchase data from Hotmart webhook payload.
 * Supports both wrapped ({data:{buyer,purchase,product}}) and flat formats.
 */
function extractHotmartPayload(event: FunnelEvent, defaultProductName: string): HotmartExtracted | null {
  const payload  = event.payload;
  const data     = isRec(payload.data)    ? payload.data    : {};
  const buyer    = isRec(data.buyer)      ? data.buyer      : (isRec(payload.buyer)    ? payload.buyer    : {});
  const purchase = isRec(data.purchase)   ? data.purchase   : (isRec(payload.purchase) ? payload.purchase : {});
  const product  = isRec(data.product)    ? data.product    : (isRec(payload.product)  ? payload.product  : {});

  const email = str(buyer.email) || str(event.lead?.email);
  if (!email) return null;

  const nome         = str(buyer.name);
  const priceRec     = isRec(purchase.price)   ? purchase.price   : {};
  const paymentRec   = isRec(purchase.payment) ? purchase.payment : {};
  const valor        = num(priceRec.value);

  return {
    email,
    nome,
    primeiroNome: nome.split(" ")[0] || "Estudante",
    transacao:    str(purchase.transaction),
    produto:      str(product.name) || defaultProductName,
    oferta:       str(purchase.offer_code),
    valor,
    valorFormatado: formatBRL(valor),
    pagamento:    str(paymentRec.type),
    dataFormatada: formatDateBR(event.occurred_at),
  };
}

// ---------------------------------------------------------------------------
// HMAC signing (Web Crypto API for Cloudflare Workers)
// ---------------------------------------------------------------------------

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
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

// ---------------------------------------------------------------------------
// API call helper
// ---------------------------------------------------------------------------

async function callPlanoVooApi(
  url: string,
  payload: Record<string, unknown>,
  secret: string,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  const body = JSON.stringify(payload);
  const signature = await signHmac(body, secret);

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": signature,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Plano de Voo API error: ${response.status} ${response.statusText} — ${errorText}`
    );
  }

  return response.json() as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Email helper
// ---------------------------------------------------------------------------

function createEmailSender(env: DispatcherEnv, fetchImpl: typeof fetch = fetch): BrevoTransactionalEmailSender {
  const apiKey = str(env.BREVO_API_KEY);
  const timeoutMs = Number(env.BREVO_TIMEOUT_MS);
  return new BrevoTransactionalEmailSender(apiKey, fetchImpl, {
    ...(str(env.BREVO_BASE_URL) ? { baseUrl: str(env.BREVO_BASE_URL) } : {}),
    ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {}),
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Calls POST /api/hooks/purchase — creates token, sends purchase link email.
 */
export async function callPlanoVooPurchase(
  event: FunnelEvent,
  env: DispatcherEnv,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const baseUrl = str(env.PLANOVOO_API_BASE_URL);
  const secret  = str(env.PLANOVOO_HOOK_SECRET);

  if (!baseUrl) throw new Error("call_plano_voo_purchase: PLANOVOO_API_BASE_URL não configurado");
  if (!secret)  throw new Error("call_plano_voo_purchase: PLANOVOO_HOOK_SECRET não configurado");

  const config = resolveEmailConfig(env, getCatalogForEmail(env));
  const data = extractHotmartPayload(event, config.defaultProductName);
  if (!data) {
    console.log(JSON.stringify({
      stage: "handler_skip", handler: "call_plano_voo_purchase",
      reason: "no_email", event_id: event.event_id,
    }));
    return;
  }

  // 1. Call API to create token
  const url = `${baseUrl.replace(/\/$/, "")}/api/hooks/purchase`;
  const apiPayload = {
    email: data.email,
    nome: data.nome,
    transacao: data.transacao,
    produto: data.produto,
    oferta: data.oferta,
    valor: data.valor,
    pagamento: data.pagamento,
  };
  const result = await callPlanoVooApi(url, apiPayload, secret, fetchImpl);
  const token = str(result.token);

  // Store token in event payload for downstream handlers
  event.payload.plano_voo_token = token;

  // 2. Send purchase link email
  const formUrl = `${config.formBaseUrl.replace(/\/$/, "")}/formulario/${token}`;
  const emailSender = createEmailSender(env, fetchImpl);
  await emailSender.send({
    to: { email: data.email },
    ...(config.replyToEmail ? { replyTo: { email: config.replyToEmail } } : {}),
    templateId: config.purchaseLinkTemplateId,
    params: {
      primeiroNome: data.primeiroNome,
      produto:      data.produto,
      formUrl,
      transacao:    data.transacao,
    },
  });

  console.log(JSON.stringify({
    stage: "handler_ok", handler: "call_plano_voo_purchase",
    event_id: event.event_id, token, email_sent: true,
  }));
}

/**
 * Calls POST /api/hooks/refund — marks tokens as CANCELADO, sends refund email.
 */
export async function callPlanoVooRefund(
  event: FunnelEvent,
  env: DispatcherEnv,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const baseUrl = str(env.PLANOVOO_API_BASE_URL);
  const secret  = str(env.PLANOVOO_HOOK_SECRET);

  if (!baseUrl) throw new Error("call_plano_voo_refund: PLANOVOO_API_BASE_URL não configurado");
  if (!secret)  throw new Error("call_plano_voo_refund: PLANOVOO_HOOK_SECRET não configurado");

  const config = resolveEmailConfig(env, getCatalogForEmail(env));
  const data = extractHotmartPayload(event, config.defaultProductName);
  if (!data) {
    console.log(JSON.stringify({
      stage: "handler_skip", handler: "call_plano_voo_refund",
      reason: "no_email", event_id: event.event_id,
    }));
    return;
  }

  // 1. Call API to mark CANCELADO
  if (data.transacao) {
    const url = `${baseUrl.replace(/\/$/, "")}/api/hooks/refund`;
    const result = await callPlanoVooApi(url, { transacao: data.transacao }, secret, fetchImpl);
    console.log(JSON.stringify({
      stage: "api_ok", handler: "call_plano_voo_refund",
      event_id: event.event_id, transacao: data.transacao, updated: result.updated,
    }));
  } else {
    console.log(JSON.stringify({
      stage: "handler_warn", handler: "call_plano_voo_refund",
      reason: "no_transacao", event_id: event.event_id,
    }));
  }

  // 2. Send refund email
  const emailSender = createEmailSender(env, fetchImpl);
  await emailSender.send({
    to: { email: data.email },
    ...(config.replyToEmail ? { replyTo: { email: config.replyToEmail } } : {}),
    templateId: config.refundedTemplateId,
    params: {
      primeiroNome: data.primeiroNome,
      produto:      data.produto,
      valor:        data.valorFormatado,
      data:         data.dataFormatada,
      transacao:    data.transacao,
    },
  });

  console.log(JSON.stringify({
    stage: "handler_ok", handler: "call_plano_voo_refund",
    event_id: event.event_id, email_sent: true,
  }));
}

/**
 * Calls POST /api/hooks/protest — marks tokens as SUSPENSO, sends protest email.
 */
export async function callPlanoVooProtest(
  event: FunnelEvent,
  env: DispatcherEnv,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const baseUrl = str(env.PLANOVOO_API_BASE_URL);
  const secret  = str(env.PLANOVOO_HOOK_SECRET);

  if (!baseUrl) throw new Error("call_plano_voo_protest: PLANOVOO_API_BASE_URL não configurado");
  if (!secret)  throw new Error("call_plano_voo_protest: PLANOVOO_HOOK_SECRET não configurado");

  const config = resolveEmailConfig(env, getCatalogForEmail(env));
  const data = extractHotmartPayload(event, config.defaultProductName);
  if (!data) {
    console.log(JSON.stringify({
      stage: "handler_skip", handler: "call_plano_voo_protest",
      reason: "no_email", event_id: event.event_id,
    }));
    return;
  }

  // 1. Call API to mark SUSPENSO
  if (data.transacao) {
    const url = `${baseUrl.replace(/\/$/, "")}/api/hooks/protest`;
    const result = await callPlanoVooApi(url, { transacao: data.transacao }, secret, fetchImpl);
    console.log(JSON.stringify({
      stage: "api_ok", handler: "call_plano_voo_protest",
      event_id: event.event_id, transacao: data.transacao, updated: result.updated,
    }));
  } else {
    console.log(JSON.stringify({
      stage: "handler_warn", handler: "call_plano_voo_protest",
      reason: "no_transacao", event_id: event.event_id,
    }));
  }

  // 2. Send protest email
  const emailSender = createEmailSender(env, fetchImpl);
  await emailSender.send({
    to: { email: data.email },
    ...(config.replyToEmail ? { replyTo: { email: config.replyToEmail } } : {}),
    templateId: config.protestTemplateId,
    params: {
      primeiroNome: data.primeiroNome,
      produto:      data.produto,
      valor:        data.valorFormatado,
      data:         data.dataFormatada,
      transacao:    data.transacao,
    },
  });

  console.log(JSON.stringify({
    stage: "handler_ok", handler: "call_plano_voo_protest",
    event_id: event.event_id, email_sent: true,
  }));
}

// ---------------------------------------------------------------------------
// Internal — catalog resolution for email config
// ---------------------------------------------------------------------------

function getCatalogForEmail(env: DispatcherEnv): Record<string, unknown> {
  if (env.CATALOG_JSON && typeof env.CATALOG_JSON === "string") {
    try { return JSON.parse(env.CATALOG_JSON); } catch { /* fall through */ }
  }
  return bundledCatalogJson as Record<string, unknown>;
}
