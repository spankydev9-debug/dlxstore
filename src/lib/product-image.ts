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

/**
 * Next 16 serves `/_next/image` only for widths on its `deviceSizes` +
 * `imageSizes` allowlists; anything else answers **HTTP 400**, not a resized image.
 * Measured against production (2026-10-03): w=400 and w=100 → 400, while
 * w=384 → 200. A non-allowlisted width therefore renders as a broken image with no
 * build-time or type error.
 *
 * Snapping keeps any explicit width on the allowlist instead of silently 400ing.
 * Keep these two lists in sync with `next.config.ts` images settings.
 */
const ALLOWED_IMAGE_WIDTHS = [
  32, 48, 64, 96, 128, 256, 384, // imageSizes
  640, 750, 828, 1080, 1200, 1920, 2048, 3840, // deviceSizes
] as const;

export function snapToAllowedImageWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 384;
  if ((ALLOWED_IMAGE_WIDTHS as readonly number[]).includes(width)) return width;
  // Nearest allowed width, preferring the smaller one on a tie so we never upscale.
  return ALLOWED_IMAGE_WIDTHS.reduce((best, allowed) =>
    Math.abs(allowed - width) < Math.abs(best - width) ? allowed : best
  );
}
