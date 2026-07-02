import type { CommentAutomationRule } from "../../../packages/shared/src/comment-automation";
import bundledCatalog from "../../../config/products.catalog.json";

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface DispatcherEnv {
  SOCIAL_DEDUPE_KV?: KVNamespaceLike;
  CATALOG_JSON?: string;
  [key: string]: unknown;
}

export interface DispatcherCatalogTenant {
  credentials?: { meta_access_token_env?: string };
  products?: Record<string, { commentAutomation?: { rules?: CommentAutomationRule[] } }>;
}

export interface DispatcherCatalog {
  tenants?: Record<string, DispatcherCatalogTenant>;
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function getCatalog(env: DispatcherEnv): DispatcherCatalog {
  const raw = asString(env.CATALOG_JSON);
  if (!raw) return bundledCatalog as DispatcherCatalog;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as DispatcherCatalog;
    }
  } catch {
    console.log(JSON.stringify({ worker: "social-dispatcher", stage: "warn", error: "catalog_json_invalid" }));
  }
  return bundledCatalog as DispatcherCatalog;
}
