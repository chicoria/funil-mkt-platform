import type { FunnelEvent } from "../../../packages/shared/src/funnel-event";
import type { DispatcherEnv } from "./dispatcher";
import type { ResolvedCredentials } from "./tenant-resolver";

export class HandlerContext {
  readonly event: FunnelEvent;
  readonly env: DispatcherEnv;
  readonly tenant_id: string;
  readonly credentials: ResolvedCredentials;

  private store = new Map<string, unknown>();

  constructor(
    event: FunnelEvent,
    env: DispatcherEnv,
    tenantId: string,
    credentials: ResolvedCredentials
  ) {
    this.event = event;
    this.env = env;
    this.tenant_id = tenantId;
    this.credentials = credentials;
  }

  get product_code(): string {
    return this.event.product_code;
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  dedupeKey(handlerName: string): string {
    return `${this.tenant_id}:${this.event.event_id}:${handlerName}`;
  }

  kvKey(suffix: string): string {
    return `${this.tenant_id}:${suffix}`;
  }
}
