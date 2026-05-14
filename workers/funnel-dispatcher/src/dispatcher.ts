import { FunnelEvent } from "../../../packages/shared/src/funnel-event";
import bundledCatalogJson from "../../../config/products.catalog.json";
import {
  isConfiguredCatalog,
  parseCatalog,
  resolveCatalogEvent,
  resolveCatalogProduct,
  type CatalogEventConfig,
  type ParsedCatalog,
} from "./catalog-adapter";
import { resolveEventTenantId } from "./tenant-scope";

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete?(key: string): Promise<void>;
}

export interface DispatcherEnv {
  [key: string]: unknown;
  DEDUPE_KV?: KVNamespaceLike;
  IDENTITY_KV?: KVNamespaceLike;
  IDENTITY_DB?: unknown;
  EVENT_STORE_DB?: unknown;
  CATALOG_JSON?: string;
  BREVO_API_KEY?: string;
  BREVO_BASE_URL?: string;
  BREVO_TIMEOUT_MS?: string;
  BREVO_SANDBOX?: string;
  BREVO_DOI_TEMPLATE_ID?: string;
  BREVO_DOI_REDIRECT_URL?: string;
  BREVO_CART_ABANDON_TEMPLATE_ID?: string;
  BREVO_CART_ABANDONMENT_TEMPLATE_ID?: string;
  N8N_WEBHOOK_URL?: string;
  N8N_DISABLE_FORWARD?: string;
  GA4_MEASUREMENT_ID?: string;
  GA4_API_SECRET?: string;
  META_PIXEL_ID?: string;
  META_CAPI_ACCESS_TOKEN?: string;
  META_TEST_EVENT_CODE?: string;
  SGTM_ENDPOINT_URL?: string;
  PLANOVOO_API_BASE_URL?: string;
  PLANOVOO_HOOK_SECRET?: string;
}

export type HandlerFn = (event: FunnelEvent, env: DispatcherEnv) => Promise<void>;

export const HANDLER_RESULT_PAYLOAD_KEY = "__handler_results";

type HandlerResultMap = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getHandlerResultMap(event: FunnelEvent): HandlerResultMap {
  const current = event.payload[HANDLER_RESULT_PAYLOAD_KEY];
  if (isRecord(current)) return current;
  const next: HandlerResultMap = {};
  event.payload[HANDLER_RESULT_PAYLOAD_KEY] = next;
  return next;
}

export function setHandlerResult(event: FunnelEvent, handlerName: string, result: unknown): void {
  getHandlerResultMap(event)[handlerName] = result;
}

export function getHandlerResult<T = unknown>(event: FunnelEvent, handlerName: string): T | undefined {
  const current = event.payload[HANDLER_RESULT_PAYLOAD_KEY];
  if (!isRecord(current)) return undefined;
  return current[handlerName] as T | undefined;
}

function parseDedupeHandlerResult(value: string): unknown {
  try {
    const parsed = JSON.parse(value);
    if (isRecord(parsed) && Object.prototype.hasOwnProperty.call(parsed, "handler_result")) {
      return parsed.handler_result;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function dedupeValueFor(event: FunnelEvent, handlerName: string): string {
  const result = getHandlerResult(event, handlerName);
  if (result === undefined) return "1";
  return JSON.stringify({ handler_result: result });
}

function dedupeKeyFor(event: FunnelEvent, catalog: ParsedCatalog, handlerName: string): string {
  const resolvedProduct = resolveCatalogProduct(catalog, event);
  const tenantId = resolveEventTenantId(event, catalog);
  const productCode = resolvedProduct?.product_code || event.product_code;
  return `${tenantId}:${productCode}:${event.event_id}:${handlerName}`;
}

const bundledCatalog = bundledCatalogJson as ParsedCatalog;

const DEFAULT_CHAIN_MAP: Record<string, string[]> = {
  GENERATE_LEAD: ["resolve_identity", "upsert_event_store", "send_brevo_doi", "update_brevo_funnel", "sync_brevo_segments"],
  PRECHECKOUT_SUBMIT_SUCCESS: [
    "resolve_identity",
    "upsert_event_store",
    "send_brevo_doi",
    "update_brevo_funnel",
    "sync_brevo_segments",
  ],
  BEGIN_CHECKOUT: ["resolve_identity", "upsert_event_store", "update_brevo_funnel", "emit_tracking"],
  SIGN_UP: ["resolve_identity", "upsert_event_store", "update_brevo_funnel"],
  PURCHASE_OUT_OF_SHOPPING_CART: [
    "resolve_identity",
    "upsert_event_store",
    "update_brevo_funnel",
    "send_cart_abandonment_email",
    "emit_tracking",
  ],
  PURCHASE_BILLET_PRINTED: ["resolve_identity", "upsert_event_store", "update_brevo_funnel"],
  PURCHASE_DELAYED: ["resolve_identity", "upsert_event_store", "update_brevo_funnel"],
  PURCHASE_APPROVED: [
    "resolve_identity",
    "upsert_event_store",
    "update_brevo_funnel",
    "emit_tracking",
  ],
  PURCHASE_COMPLETE: ["resolve_identity", "upsert_event_store", "update_brevo_funnel"],
  PURCHASE_CANCELED: ["resolve_identity", "upsert_event_store", "invalidate_purchase_token", "update_brevo_funnel"],
  PURCHASE_REFUNDED: ["resolve_identity", "upsert_event_store", "invalidate_purchase_token", "update_brevo_funnel"],
  PURCHASE_CHARGEBACK: ["resolve_identity", "upsert_event_store", "invalidate_purchase_token", "update_brevo_funnel"],
  PURCHASE_PROTEST: ["resolve_identity", "upsert_event_store", "invalidate_purchase_token", "update_brevo_funnel"],
  PURCHASE_EXPIRED: ["resolve_identity", "upsert_event_store", "invalidate_purchase_token", "update_brevo_funnel"],
};

function getCatalog(raw: string | undefined): ParsedCatalog {
  const parsed = parseCatalog(raw);
  if (isConfiguredCatalog(parsed)) return parsed;
  return bundledCatalog;
}

export function resolveChain(event: FunnelEvent, catalog: ParsedCatalog): string[] {
  const matched = resolveCatalogEvent(catalog, event, event.event_type) as CatalogEventConfig | null;

  if (matched?.chain?.length) return matched.chain;
  return DEFAULT_CHAIN_MAP[event.event_type.toUpperCase()] || [];
}

export async function runChain(
  event: FunnelEvent,
  env: DispatcherEnv,
  handlers: Record<string, HandlerFn>
): Promise<{ executed: string[]; skipped: string[] }> {
  const catalog = getCatalog(env.CATALOG_JSON);
  const chain = resolveChain(event, catalog);
  const executed: string[] = [];
  const skipped: string[] = [];

  for (const handlerName of chain) {
    const fn = handlers[handlerName];
    if (!fn) {
      throw new Error(`handler_not_implemented:${handlerName}`);
    }

    const dedupeKey = dedupeKeyFor(event, catalog, handlerName);
    if (env.DEDUPE_KV) {
      const exists = await env.DEDUPE_KV.get(dedupeKey);
      if (exists) {
        const handlerResult = parseDedupeHandlerResult(exists);
        if (handlerResult !== undefined) {
          setHandlerResult(event, handlerName, handlerResult);
        }
        skipped.push(handlerName);
        continue;
      }
    }

    await fn(event, env);

    if (env.DEDUPE_KV) {
      await env.DEDUPE_KV.put(dedupeKey, dedupeValueFor(event, handlerName), { expirationTtl: 90 * 24 * 60 * 60 });
    }

    executed.push(handlerName);
  }

  return { executed, skipped };
}
