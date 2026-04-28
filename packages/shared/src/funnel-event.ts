export type FunnelSource = "site" | "hotmart" | "app";

export interface FunnelIdentity {
  anonymous_id?: string;
  session_id?: string;
  lead_id?: string;
  email_hash?: string;
}

export interface FunnelAttribution {
  fbp?: string;
  fbc?: string;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  client_ip?: string;
}

export interface FunnelLead {
  email?: string;
  phone?: string;
  lead_id?: string;
}

export interface FunnelEvent {
  event_id: string;
  event_type: string;
  product_code: string;
  source: FunnelSource;
  occurred_at: string;
  identity?: FunnelIdentity;
  attribution?: FunnelAttribution;
  lead?: FunnelLead;
  payload: Record<string, unknown>;
}

export function isFunnelEvent(value: unknown): value is FunnelEvent {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.event_id === "string" &&
    typeof data.event_type === "string" &&
    typeof data.product_code === "string" &&
    typeof data.source === "string" &&
    typeof data.occurred_at === "string" &&
    !!data.payload &&
    typeof data.payload === "object"
  );
}
