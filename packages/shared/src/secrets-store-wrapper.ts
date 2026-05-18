/**
 * Cloudflare Secrets Store binding wrapper.
 *
 * Suporta dois modos de leitura de secret, com fallback transparente para
 * compatibilidade durante a janela de coexistência (Fase 1→4 do Slice 2.11A):
 *
 * 1. **Cloudflare Secrets Store binding** (alvo final): `await env.X.get()`.
 *    Account-level, account scoped; um secret existe 1× e é binding em N workers.
 *    A API real retorna `string | null` — `null` indica que o secret não existe
 *    no store (não lança erro). O wrapper trata `null` como erro explícito.
 * 2. **Worker secret legado** (string direta): `env.X` no wrangler.toml ou
 *    `wrangler secret put`. Removido na Fase 4 (slice 2.11A.9).
 *
 * **Assimetria de cache:** binding é cacheado (round-trip ao Secrets Store é
 * evitado em requests subsequentes); string legada é lida diretamente do
 * argumento a cada chamada (não há round-trip — caching seria desnecessário).
 *
 * **Limitação de cache — rotação de secrets:**
 * O cache é invalidado por redeploy do worker (cada deploy recria o isolate).
 * Rotação de secret *sem* redeploy não invalida o cache — o isolate continuará
 * servindo o valor antigo até o próximo cold start ou chamada a
 * `clearSecretCache()`. Para rotação controlada sem redeploy, chame
 * `clearSecretCache()` explicitamente antes do próximo request.
 *
 * **Concorrência:**
 * Requests concorrentes para o mesmo secret (sem cache prévio) resultarão em
 * múltiplas chamadas a `binding.get()` — o isolate é single-threaded mas
 * cooperativo (await cede controle). Em volume normal isso é apenas um
 * double-fetch desnecessário; com rate-limit no Secrets Store pode causar falha
 * esporádica. Caso seja necessário, coalescing de promises pode ser adicionado.
 *
 * Princípio fail-fast: ver PLANO-MASTER seção G.1.
 * Ver: plans/PLANO-MULTI-TENANT-SECRETS-CONFIG.md (seção 8.2)
 * Ver: plans/slices/2.11A/0-secrets-store-setup.md
 */

export interface SecretsStoreBinding {
  /**
   * Fetch the secret value. Returns `null` when the secret does not exist in
   * the store (Cloudflare Secrets Store API behavior). Rejects on network/API
   * errors.
   */
  get(): Promise<string | null>;
}

export type SecretValue = string | SecretsStoreBinding | undefined;

const cache = new Map<string, string>();

/**
 * Resolve secret value supporting both Secrets Store binding and legacy
 * worker secret string. Fail-fast on missing/empty values.
 *
 * Note the cache asymmetry: Secrets Store binding results are cached per-name
 * (one round-trip per isolate lifetime); legacy string values are read directly
 * from the argument on every call (no round-trip needed).
 *
 * @param binding - Either a Secrets Store binding object (preferred) or a
 *   string from a legacy worker secret. `undefined` or empty string triggers
 *   fail-fast.
 * @param name - Logical secret name (e.g. `BREVO_API_KEY_DECOLE`). Used as
 *   cache key and in error messages to identify which secret failed.
 * @throws if binding is missing/undefined, if string is empty, if binding
 *   returns null/empty, or if binding.get() rejects (with contextual message).
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

    let value: string | null;
    try {
      value = await binding.get();
    } catch (err) {
      throw new Error(
        `SecretsStore: ${name} fetch failed — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!value) {
      throw new Error(
        `SecretsStore: ${name} returned empty/null value (secret missing from store or misconfigured binding)`,
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
 * Clear the module-level secret cache.
 *
 * @internal Use in tests (via afterEach) and in controlled secret rotation
 * workflows. Avoid calling in hot paths — the next request will incur
 * Secrets Store round-trips for every cached secret.
 *
 * Note: clears ALL cached secrets, not individual ones. If selective
 * invalidation is needed, consider using name-prefixed caches per tenant.
 */
export function clearSecretCache(): void {
  cache.clear();
}
