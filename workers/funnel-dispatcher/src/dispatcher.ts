import { FunnelEvent } from "../../../packages/shared/src/funnel-event";

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface DispatcherEnv {
  DEDUPE_KV?: KVNamespaceLike;
  CATALOG_JSON?: string;
}

export type HandlerFn = (event: FunnelEvent, env: DispatcherEnv) => Promise<void>;

export interface CatalogEvent {
  eventType?: string;
  id?: string;
  chain?: string[];
}

export interface ParsedCatalog {
  products?: Record<string, { funnelEventArchitecture?: { events?: CatalogEvent[] } }>;
}

const DEFAULT_CHAIN_MAP: Record<string, string[]> = {
  GENERATE_LEAD: ["resolve_identity", "upsert_event_store", "send_brevo_doi", "update_brevo_funnel", "emit_tracking"],
  PRECHECKOUT_SUBMIT_SUCCESS: [
    "resolve_identity",
    "upsert_event_store",
    "send_brevo_doi",
    "update_brevo_funnel",
    "emit_tracking",
  ],
  PURCHASE_OUT_OF_SHOPPING_CART: ["update_brevo_funnel", "send_cart_abandonment_email", "emit_tracking"],
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

export function resolveChain(event: FunnelEvent, catalog: ParsedCatalog): string[] {
  const product = catalog.products?.[event.product_code];
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
  const chain = resolveChain(event, parseCatalog(env.CATALOG_JSON));
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
