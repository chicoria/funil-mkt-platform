import type { SocialPlatform } from "./social-comment-event";

export type SocialResponderProvider = "meta" | "zernio";

/**
 * Override opcional por produto (vem de
 * `commentAutomation.responderProvider` no catálogo). Permite migrar um
 * tenant/produto de volta pra `meta` (quando a app própria for aprovada)
 * sem mudança de código.
 */
export interface SocialResponderProviderOverrides {
  facebook?: SocialResponderProvider;
  instagram?: SocialResponderProvider;
}

/**
 * Default: Zernio para as duas plataformas. A app Meta própria só funciona
 * hoje para admins/testers do Business Manager (modo de desenvolvimento) —
 * não é confiável para usuários reais comentando no anúncio. Zernio, como
 * Meta Marketing Partner, não depende desse status.
 */
const DEFAULT_PROVIDER_BY_PLATFORM: Record<SocialPlatform, SocialResponderProvider> = {
  facebook: "zernio",
  instagram: "zernio",
};

export function resolveSocialResponderProvider(
  platform: SocialPlatform,
  overrides?: SocialResponderProviderOverrides
): SocialResponderProvider {
  return overrides?.[platform] ?? DEFAULT_PROVIDER_BY_PLATFORM[platform];
}
