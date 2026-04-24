import { FunnelEvent } from "../../../packages/shared/src/funnel-event";
import bundledCatalogJson from "../../../config/products.catalog.json";

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
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
}

export type HandlerFn = (event: FunnelEvent, env: DispatcherEnv) => Promise<void>;

export interface CatalogEvent {
  eventType?: string;
  id?: string;
  chain?: string[];
}

interface CatalogProduct {
  aliases?: string[];
  funnelEventArchitecture?: { events?: CatalogEvent[] };
}

export interface ParsedCatalog {
  products?: Record<string, CatalogProduct>;
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
  PURCHASE_APPROVED: ["resolve_identity", "upsert_event_store", "update_brevo_funnel", "emit_tracking", "forward_n8n"],
};

export function parseCatalog(raw: string | undefined): ParsedCatalog {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as ParsedCatalog;
    return {};
  } catch {
    return {};
  }
}

function getCatalog(raw: string | undefined): ParsedCatalog {
  const parsed = parseCatalog(raw);
  if (parsed.products) return parsed;
  return bundledCatalog;
}

function getCatalogProduct(catalog: ParsedCatalog, productCode: string): CatalogProduct | undefined {
  const products = catalog.products || {};
  const direct = products[productCode];
  if (direct) return direct;

  const normalizedProductCode = productCode.toUpperCase();
  return Object.values(products).find((product) =>
    (product.aliases || []).some((alias) => alias.toUpperCase() === normalizedProductCode)
  );
}

export function resolveChain(event: FunnelEvent, catalog: ParsedCatalog): string[] {
  const product = getCatalogProduct(catalog, event.product_code);
  const events = product?.funnelEventArchitecture?.events || [];

  const matched = events.find((entry) => {
    const candidate = (entry.eventType || entry.id || "").toUpperCase();
    return candidate === event.event_type.toUpperCase();
  });

  if (matched?.chain?.length) return matched.chain;
  return DEFAULT_CHAIN_MAP[event.event_type.toUpperCase()] || [];
}

export async function runChain(
  event: FunnelEvent,
  env: DispatcherEnv,
  handlers: Record<string, HandlerFn>
): Promise<{ executed: string[]; skipped: string[] }> {
  const chain = resolveChain(event, getCatalog(env.CATALOG_JSON));
  const executed: string[] = [];
  const skipped: string[] = [];

  for (const handlerName of chain) {
    const fn = handlers[handlerName];
    if (!fn) {
      throw new Error(`handler_not_implemented:${handlerName}`);
    }

    const dedupeKey = `${event.event_id}:${handlerName}`;
    if (env.DEDUPE_KV) {
      const exists = await env.DEDUPE_KV.get(dedupeKey);
      if (exists) {
        skipped.push(handlerName);
        continue;
      }
    }

    await fn(event, env);

    if (env.DEDUPE_KV) {
      await env.DEDUPE_KV.put(dedupeKey, "1", { expirationTtl: 90 * 24 * 60 * 60 });
    }

    executed.push(handlerName);
  }

  return { executed, skipped };
}
