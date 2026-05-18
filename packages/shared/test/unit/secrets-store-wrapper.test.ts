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

  it("returns string value directly when binding is a legacy worker secret (string)", async () => {
    const result = await resolveSecret("legacy-value", "BREVO_API_KEY_DECOLE");
    expect(result).toBe("legacy-value");
  });

  it("returns value from Secrets Store binding via await get()", async () => {
    const binding: SecretsStoreBinding = {
      get: vi.fn().mockResolvedValue("store-value"),
    };
    const result = await resolveSecret(binding, "BREVO_API_KEY_DECOLE");
    expect(result).toBe("store-value");
    expect(binding.get).toHaveBeenCalledTimes(1);
  });

  it("caches binding result across repeated calls in same isolate", async () => {
    const binding: SecretsStoreBinding = {
      get: vi.fn().mockResolvedValue("cached-value"),
    };
    const first = await resolveSecret(binding, "HOTMART_WEBHOOK_TOKEN_DECOLE");
    const second = await resolveSecret(binding, "HOTMART_WEBHOOK_TOKEN_DECOLE");
    const third = await resolveSecret(binding, "HOTMART_WEBHOOK_TOKEN_DECOLE");
    expect(first).toBe("cached-value");
    expect(second).toBe("cached-value");
    expect(third).toBe("cached-value");
    // get() chamado apenas uma vez — restantes vieram do cache
    expect(binding.get).toHaveBeenCalledTimes(1);
  });

  it("throws explicit error when neither binding nor string is provided (fail-fast)", async () => {
    await expect(resolveSecret(undefined, "MISSING_SECRET")).rejects.toThrow(
      /MISSING_SECRET not found/,
    );
  });

  it("throws explicit error when binding returns empty value (catch silent misconfig)", async () => {
    const binding: SecretsStoreBinding = {
      get: vi.fn().mockResolvedValue(""),
    };
    await expect(resolveSecret(binding, "EMPTY_SECRET")).rejects.toThrow(
      /EMPTY_SECRET returned empty value/,
    );
  });

  it("clearSecretCache forces next call to refetch from binding", async () => {
    const binding: SecretsStoreBinding = {
      get: vi.fn().mockResolvedValue("first-fetch"),
    };
    await resolveSecret(binding, "ROTATABLE_SECRET");
    expect(binding.get).toHaveBeenCalledTimes(1);

    clearSecretCache();

    await resolveSecret(binding, "ROTATABLE_SECRET");
    expect(binding.get).toHaveBeenCalledTimes(2);
  });

  it("treats empty string as missing (fails over to fail-fast path)", async () => {
    // Empty string is NOT a valid worker secret value — treat as undefined.
    await expect(resolveSecret("", "EMPTY_STRING_SECRET")).rejects.toThrow(
      /EMPTY_STRING_SECRET not found/,
    );
  });
});
