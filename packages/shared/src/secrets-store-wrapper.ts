/**
 * Cloudflare Secrets Store binding wrapper.
 *
 * Suporta dois modos de leitura de secret, com fallback transparente para
 * compatibilidade durante a janela de coexistência (Fase 1→4 do Slice 2.11A):
 *
 * 1. **Cloudflare Secrets Store binding** (alvo final): `await env.X.get()`.
 *    Account-level, account scoped; um secret existe 1× e é binding em N workers.
 * 2. **Worker secret legado** (string direta): `env.X` no wrangler.toml ou
 *    `wrangler secret put`. Removido na Fase 4 (slice 2.11A.9).
 *
 * Princípio fail-fast: ausência de ambos lança erro explícito em vez de
 * cair em `undefined`/`""` silencioso (causa comum de "tenant errado
 * processado como DECOLE silenciosamente"). Ver PLANO-MASTER seção G.1.
 *
 * Ver: plans/PLANO-MULTI-TENANT-SECRETS-CONFIG.md (seção 8.2 — onde os
 * secrets vivem) e plans/slices/2.11A/0-secrets-store-setup.md.
 */

export interface SecretsStoreBinding {
  get(): Promise<string>;
}

export type SecretValue = string | SecretsStoreBinding | undefined;

const cache = new Map<string, string>();

/**
 * Resolve secret value supporting both Secrets Store binding and legacy
 * worker secret string. Fail-fast on missing/empty values.
 *
 * @param binding - Either a Secrets Store binding object (preferred) or a
 *   string from a legacy worker secret. `undefined` triggers fail-fast.
 * @param name - Logical secret name (e.g. `BREVO_API_KEY_DECOLE`) used in
 *   cache keys and error messages.
 * @throws if neither binding nor non-empty string provided, or if binding
 *   returns empty value.
 */
export async function resolveSecret(
  binding: SecretValue,
  name: string,
): Promise<string> {
  // Legacy worker secret: string non-empty.
  if (typeof binding === "string" && binding.length > 0) {
    return binding;
  }

  // Secrets Store binding: cache + fetch.
  if (binding && typeof binding === "object" && "get" in binding) {
    const cached = cache.get(name);
    if (cached !== undefined) return cached;

    const value = await binding.get();
    if (!value) {
      throw new Error(
        `SecretsStore: ${name} returned empty value (binding misconfigured?)`,
      );
    }
    cache.set(name, value);
    return value;
  }

  // Fail-fast: nem string válida nem binding.
  throw new Error(
    `SecretsStore: ${name} not found (no binding, no legacy string value)`,
  );
}

/**
 * Esvazia o cache local de secrets. Útil em testes e em fluxos de rotação
 * (não usado em runtime normal de worker — Cloudflare Workers reinstanciam
 * o isolate ao redeploy, que já invalida cache).
 */
export function clearSecretCache(): void {
  cache.clear();
}
