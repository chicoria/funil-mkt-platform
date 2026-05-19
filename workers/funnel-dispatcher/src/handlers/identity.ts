import type { FunnelEvent } from "../../../../packages/shared/src/funnel-event";

// ── Types ─────────────────────────────────────────────────────────────────────

interface KVBinding {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

// ── Priority rules (industry standard) ───────────────────────────────────────
//
// Deterministic signals (email) always win over probabilistic signals (device).
//
// Rule 1: explicit profile_id in payload     → highest priority, never override
// Rule 2: email present + known profile      → deterministic match, use it
// Rule 3: email present + unknown profile    → new identity (don't inherit device)
// Rule 4: no email + known anonymous_id      → session continuity
// Rule 5: no email + unknown anonymous_id    → new identity

export async function resolveProfileId(opts: {
  explicitProfileId: string;
  profileIdFromEmail: string;
  profileIdFromAnon: string;
  hasEmail: boolean;
}): Promise<string> {
  const { explicitProfileId, profileIdFromEmail, profileIdFromAnon, hasEmail } = opts;

  // Rule 1
  if (explicitProfileId) return explicitProfileId;

  if (hasEmail) {
    // Rule 2: same email = same person (deterministic)
    if (profileIdFromEmail) return profileIdFromEmail;
    // Rule 3: new email on same device → separate identity (do NOT inherit anon)
    return crypto.randomUUID();
  }

  // Rule 4 + 5: anonymous session continuity
  return profileIdFromAnon || crypto.randomUUID();
}

// ── KV helpers ────────────────────────────────────────────────────────────────

export function tenantScopedKey(tenantId: string, key: string): string {
  return `${tenantId}:${key}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Main exported function (used by tests and by resolveIdentityState) ────────

export async function resolveIdentityForEvent(
  event: FunnelEvent,
  tenantId: string,
  kv: KVBinding | null,
  _db: unknown // D1 — passed through but writes handled by caller
): Promise<void> {
  const rawAnonymousId = (event.identity?.anonymous_id as string) || `anon-${event.event_id}`;
  const email = ((event.lead?.email as string) || "").toLowerCase().trim();
  const computedEmailHash = (event.identity?.email_hash as string) ||
    (email ? await sha256Hex(email) : "");

  const explicitProfileId = (event.payload as Record<string, unknown>)?.profile_id as string || "";

  const anonKey = tenantScopedKey(tenantId, `identity:anon:${rawAnonymousId}`);
  const emailKey = computedEmailHash
    ? tenantScopedKey(tenantId, `identity:email:${computedEmailHash}`)
    : "";

  const profileIdFromAnon = kv ? ((await kv.get(anonKey)) ?? "") : "";
  const profileIdFromEmail = (kv && emailKey) ? ((await kv.get(emailKey)) ?? "") : "";

  const profileId = await resolveProfileId({
    explicitProfileId,
    profileIdFromEmail,
    profileIdFromAnon,
    hasEmail: !!computedEmailHash,
  });

  // Update event in-place
  event.identity = {
    ...(event.identity || {}),
    anonymous_id: rawAnonymousId,
    email_hash: computedEmailHash || undefined,
  } as never;
  (event.payload as Record<string, unknown>) = {
    ...(event.payload || {}),
    profile_id: profileId,
  };

  // Persist to KV (D1 writes handled by the caller via resolveIdentityState)
  if (kv) {
    await kv.put(anonKey, profileId, { expirationTtl: 365 * 24 * 60 * 60 });
    if (emailKey) {
      await kv.put(emailKey, profileId, { expirationTtl: 365 * 24 * 60 * 60 });
    }
  }
}
