import "server-only";

/**
 * Provider-neutral boundary for AI catalog automation (ROADMAP Phase 5).
 *
 * This is a *different capability* from the Visual Studio image generator in
 * `../visual-studio/provider.ts`: that one creates imagery, this one reads an
 * image and returns structured catalogue metadata. The contracts do not overlap,
 * so they are kept as separate, independently configurable adapters — but they
 * follow identical rules:
 *
 *   - no provider SDK is imported;
 *   - no key ever reaches the browser;
 *   - `getCatalogAnalysisProvider()` throws rather than returning a stub, so no
 *     code path can mistake a placeholder for a working model;
 *   - capability is reported as configuration facts, never as a result.
 */

export type CatalogSuggestionSource = "ai" | "rule_based" | "manual";

export type CatalogAnalysisRequest = {
  /** A real, already-validated product image URL. */
  sourceImageUrl: string;
  /** Existing product context, so a suggestion can improve a live listing. */
  context?: {
    productId?: string;
    name?: string | null;
    brand?: string | null;
    categoryName?: string | null;
  };
  /** The real, active catalogue categories the model may choose from. */
  candidateCategories: { id: string; name: string }[];
};

export type CatalogSuggestion = {
  name?: string;
  description?: string;
  slug?: string;
  categoryId?: string | null;
  categoryLabel?: string;
  brand?: string;
  colors: string[];
  sizes: string[];
  tags: string[];
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  altText?: string;
  attributes: Record<string, string>;
  /** 0..1 per field, so a reviewer can see where the model was unsure. */
  confidence: Record<string, number>;
  rationale?: string;
  source: CatalogSuggestionSource;
};

export interface CatalogAnalysisProvider {
  analyze(request: CatalogAnalysisRequest): Promise<CatalogSuggestion>;
}

export class CatalogProviderNotConfiguredError extends Error {
  constructor() {
    super("DLX catalog automation is not configured with an AI provider.");
    this.name = "CatalogProviderNotConfiguredError";
  }
}

export type CatalogProviderCapability = {
  available: boolean;
  providerNamePresent: boolean;
  credentialPresent: boolean;
  /** True when the deterministic, clearly-labelled local fallback is usable. */
  ruleBasedFallbackAvailable: boolean;
  reason:
    | "ready"
    | "provider_not_configured"
    | "provider_not_implemented"
    | "provider_unavailable";
};

const PROVIDER_NAME = process.env.DLX_CATALOG_AI_PROVIDER?.trim();
const PROVIDER_KEY = process.env.DLX_CATALOG_AI_API_KEY?.trim();

/**
 * No reviewed adapter is compiled in. A configured provider name is still
 * reported as unavailable, because a name without an adapter does nothing.
 */
export function describeCatalogProviderCapability(): CatalogProviderCapability {
  const providerNamePresent = Boolean(PROVIDER_NAME);
  const credentialPresent = Boolean(PROVIDER_KEY);
  const available = false;

  return {
    available,
    providerNamePresent,
    credentialPresent,
    // The rule-based helper is local, deterministic and always available, so the
    // review workflow never depends on a provider.
    ruleBasedFallbackAvailable: true,
    reason: available
      ? "ready"
      : providerNamePresent || credentialPresent
        ? "provider_not_implemented"
        : "provider_not_configured",
  };
}

/**
 * The eventual adapter must build the prompt itself, return only catalog
 * metadata, and never set price, stock or availability.
 */
export function getCatalogAnalysisProvider(): CatalogAnalysisProvider {
  throw new CatalogProviderNotConfiguredError();
}

export const AI_CATALOG_REQUIRED_ENV = ["DLX_CATALOG_AI_PROVIDER", "DLX_CATALOG_AI_API_KEY"] as const;
