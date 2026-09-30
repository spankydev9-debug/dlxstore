const PLACEHOLDER = "/globe.svg";
const SUPABASE_PUBLIC_IMAGE_PATH = "/storage/v1/object/public/product-images/";

export type ImageUrlValidationReason =
  | "missing"
  | "invalid_url"
  | "unsupported_protocol"
  | "unsupported_host"
  | "unsafe_local_path";

export type ImageUrlValidation =
  | { isAllowed: true; url: string }
  | { isAllowed: false; url: string; reason: ImageUrlValidationReason };

/**
 * Validates the same image sources accepted by Next's configured image pipeline.
 * Keep this as the sole allowlist for both render-time resolution and admin input.
 */
export function validateProductImageUrl(url?: string | null): ImageUrlValidation {
  const candidate = url?.trim() ?? "";
  if (!candidate) return { isAllowed: false, url: "", reason: "missing" };

  if (candidate.startsWith("/")) {
    if (candidate.startsWith("//") || candidate.includes("\\")) {
      return { isAllowed: false, url: candidate, reason: "unsafe_local_path" };
    }
    return { isAllowed: true, url: candidate };
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { isAllowed: false, url: candidate, reason: "invalid_url" };
  }

  if (parsed.protocol !== "https:") {
    return { isAllowed: false, url: candidate, reason: "unsupported_protocol" };
  }

  const isUnsplash = parsed.hostname === "images.unsplash.com";
  const isPublicSupabaseImage = parsed.hostname.endsWith(".supabase.co")
    && parsed.pathname.startsWith(SUPABASE_PUBLIC_IMAGE_PATH);

  return isUnsplash || isPublicSupabaseImage
    ? { isAllowed: true, url: candidate }
    : { isAllowed: false, url: candidate, reason: "unsupported_host" };
}

/** Returns a safe image URL for rendering, with a detectable placeholder fallback. */
export function resolveProductImageUrl(url?: string | null): string {
  const validation = validateProductImageUrl(url);
  return validation.isAllowed ? validation.url : PLACEHOLDER;
}

/** Whether the URL is accepted by the shared renderer/admin-source allowlist. */
export function isOptimizableImageUrl(url: string): boolean {
  return validateProductImageUrl(url).isAllowed;
}

export function getProductImageFallback(): string {
  return PLACEHOLDER;
}
