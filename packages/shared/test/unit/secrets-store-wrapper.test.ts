import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSecretCache,
  resolveSecret,
  type SecretsStoreBinding,
} from "../../src/secrets-store-wrapper";

describe("resolveSecret", () => {
  afterEach(() => {
    clearSecretCache();
  });

  // ─── legacy worker secret (string) ───────────────────────────────────────

  it("returns string value directly when binding is a legacy worker secret (string)", async () => {
    const result = await resolveSecret("legacy-value", "BREVO_API_KEY_DECOLE");
    expect(result).toBe("legacy-value");
  });

  it("treats empty string as missing — fail-fast (empty string is not a valid secret)", async () => {
    // Empty string cannot be a valid secret value — treat as undefined.
    await expect(resolveSecret("", "EMPTY_STRING_SECRET")).rejects.toThrow(
      /EMPTY_STRING_SECRET not found/,
    );
  });

  // ─── Secrets Store binding ────────────────────────────────────────────────

  it("returns value from Secrets Store binding via await get()", async () => {
    const binding: SecretsStoreBinding = {
      get: vi.fn().mockResolvedValue("store-value"),
    };
    const result = await resolveSecret(binding, "BREVO_API_KEY_DECOLE");
    expect(result).toBe("store-value");
    expect(binding.get).toHaveBeenCalledTimes(1);
  });

  it("throws when binding returns null — secret not present in store", async () => {
    // Cloudflare Secrets Store API returns null (not throw) when secret missing.
    const binding: SecretsStoreBinding = {
      get: vi.fn().mockResolvedValue(null),
    };
    await expect(resolveSecret(binding, "MISSING_IN_STORE")).rejects.toThrow(
      /MISSING_IN_STORE returned empty\/null value/,
    );
  });

  it("throws when binding returns empty string — misconfigured binding", async () => {
    const binding: SecretsStoreBinding = {
      get: vi.fn().mockResolvedValue(""),
    };
    await expect(resolveSecret(binding, "EMPTY_SECRET")).rejects.toThrow(
      /EMPTY_SECRET returned empty\/null value/,
    );
  });

  it("throws with contextual message when binding.get() rejects (network/API error)", async () => {
    const binding: SecretsStoreBinding = {
      get: vi.fn().mockRejectedValue(new Error("Secrets Store unavailable")),
    };
    await expect(resolveSecret(binding, "NETWORK_ERROR_SECRET")).rejects.toThrow(
      /NETWORK_ERROR_SECRET fetch failed — Secrets Store unavailable/,
    );
  });

  // ─── undefined (fail-fast) ────────────────────────────────────────────────

  it("throws explicit error when neither binding nor string is provided (fail-fast)", async () => {
    await expect(resolveSecret(undefined, "MISSING_SECRET")).rejects.toThrow(
      /MISSING_SECRET not found/,
    );
  });

  // ─── cache behaviour ─────────────────────────────────────────────────────

  it("caches binding result — subsequent calls do not re-fetch from store", async () => {
    const binding: SecretsStoreBinding = {
      get: vi.fn().mockResolvedValue("cached-value"),
    };
    const first = await resolveSecret(binding, "HOTMART_WEBHOOK_TOKEN_DECOLE");
    const second = await resolveSecret(binding, "HOTMART_WEBHOOK_TOKEN_DECOLE");
    const third = await resolveSecret(binding, "HOTMART_WEBHOOK_TOKEN_DECOLE");
    expect(first).toBe("cached-value");
    expect(second).toBe("cached-value");
    expect(third).toBe("cached-value");
    // get() called only once — subsequent calls served from cache.
    expect(binding.get).toHaveBeenCalledTimes(1);
  });

  it("caches secrets independently by name — different names do not share cache", async () => {
    const bindingA: SecretsStoreBinding = {
      get: vi.fn().mockResolvedValue("value-a"),
    };
    const bindingB: SecretsStoreBinding = {
      get: vi.fn().mockResolvedValue("value-b"),
    };
    const a = await resolveSecret(bindingA, "SECRET_A");
    const b = await resolveSecret(bindingB, "SECRET_B");
    // Second call to each — should hit cache independently.
    const a2 = await resolveSecret(bindingA, "SECRET_A");
    const b2 = await resolveSecret(bindingB, "SECRET_B");
    expect(a).toBe("value-a");
    expect(b).toBe("value-b");
    expect(a2).toBe("value-a");
    expect(b2).toBe("value-b");
    expect(bindingA.get).toHaveBeenCalledTimes(1);
    expect(bindingB.get).toHaveBeenCalledTimes(1);
  });

  it("clearSecretCache forces next call to re-fetch from binding (secret rotation support)", async () => {
    const binding: SecretsStoreBinding = {
      get: vi.fn().mockResolvedValue("first-fetch"),
    };
    await resolveSecret(binding, "ROTATABLE_SECRET");
    expect(binding.get).toHaveBeenCalledTimes(1);

    clearSecretCache();

    await resolveSecret(binding, "ROTATABLE_SECRET");
    expect(binding.get).toHaveBeenCalledTimes(2);
  });

  it("clearSecretCache clears ALL cached secrets at once", async () => {
    const bindingX: SecretsStoreBinding = { get: vi.fn().mockResolvedValue("x") };
    const bindingY: SecretsStoreBinding = { get: vi.fn().mockResolvedValue("y") };
    await resolveSecret(bindingX, "SECRET_X");
    await resolveSecret(bindingY, "SECRET_Y");
    expect(bindingX.get).toHaveBeenCalledTimes(1);
    expect(bindingY.get).toHaveBeenCalledTimes(1);

    clearSecretCache();

    // Both must re-fetch after full clear.
    await resolveSecret(bindingX, "SECRET_X");
    await resolveSecret(bindingY, "SECRET_Y");
    expect(bindingX.get).toHaveBeenCalledTimes(2);
    expect(bindingY.get).toHaveBeenCalledTimes(2);
  });

  // ─── concurrency (known limitation — documentation test) ─────────────────

  it("concurrent calls for the same uncached secret result in multiple get() calls (known limitation without coalescing)", async () => {
    // Cloudflare Workers are single-threaded but cooperative: concurrent
    // awaits can both miss the cache before either populates it. This results
    // in a double-fetch — acceptable at current volume, documented here as a
    // known behaviour. If coalescing is added later, this count will drop to 1.
    const binding: SecretsStoreBinding = {
      get: vi.fn().mockResolvedValue("concurrent-value"),
    };
    const [a, b] = await Promise.all([
      resolveSecret(binding, "CONCURRENT_SECRET"),
      resolveSecret(binding, "CONCURRENT_SECRET"),
    ]);
    expect(a).toBe("concurrent-value");
    expect(b).toBe("concurrent-value");
    // Both calls fetch — no coalescing implemented yet.
    expect(binding.get).toHaveBeenCalledTimes(2);
  });
});
